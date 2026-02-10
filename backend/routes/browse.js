const express = require('express');
const pool = require('../db/pool');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * Calculate proximity score based on distance
 * Closer users get higher scores
 */
const calculateProximityScore = (distance) => {
  if (!distance || distance === 0) return 40; // Same location
  if (distance < 10) return 35;
  if (distance < 50) return 30;
  if (distance < 100) return 20;
  if (distance < 500) return 10;
  return 5;
};

// GET /api/browse/suggestions
router.get('/suggestions', authMiddleware, async (req, res, next) => {
  try {
    const { sortBy = 'score', page = 1, limit = 20 } = req.query;
    
    // Validate numeric inputs
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Get current user's profile
    const currentUserResult = await pool.query(
      'SELECT gender, sexual_preference, latitude, longitude FROM profiles WHERE user_id = $1',
      [req.userId]
    );

    if (currentUserResult.rows.length === 0) {
      return res.status(400).json({ error: 'Please complete your profile first' });
    }

    const currentUser = currentUserResult.rows[0];

    // Validate user data
    if (!currentUser.gender) {
      return res.status(400).json({ error: 'Profile gender is required' });
    }

    // Build the query with sexual compatibility filter using parameterized queries
    let genderFilter = '';
    if (currentUser.sexual_preference === 'male') {
      genderFilter = "AND p.gender = 'male'";
    } else if (currentUser.sexual_preference === 'female') {
      genderFilter = "AND p.gender = 'female'";
    } else {
      genderFilter = "AND p.gender IN ('male', 'female', 'other')";
    }

    // Check if other users' preferences match current user's gender
    // Using $4 parameter for gender to prevent SQL injection
    const preferenceFilter = `
      AND (
        p.sexual_preference = 'both' 
        OR p.sexual_preference = $4
      )
    `;

    let orderByClause = '';
    switch (sortBy) {
      case 'age':
        orderByClause = 'ORDER BY u.created_at DESC';
        break;
      case 'location':
        orderByClause = 'ORDER BY distance ASC';
        break;
      case 'fame':
        orderByClause = 'ORDER BY p.fame_rating DESC';
        break;
      case 'tags':
        orderByClause = 'ORDER BY shared_tags DESC';
        break;
      default:
        orderByClause = 'ORDER BY score DESC';
    }

    const query = `
      WITH user_location AS (
        SELECT latitude, longitude
        FROM profiles
        WHERE user_id = $1
      ),
      candidates AS (
        SELECT 
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.last_online,
          p.gender,
          p.biography,
          p.city,
          p.fame_rating,
          p.latitude,
          p.longitude,
          -- Calculate distance using Haversine formula
          CASE 
            WHEN p.latitude IS NOT NULL AND p.longitude IS NOT NULL 
              AND ul.latitude IS NOT NULL AND ul.longitude IS NOT NULL
            THEN (
              6371 * acos(
                cos(radians(ul.latitude)) * cos(radians(p.latitude)) *
                cos(radians(p.longitude) - radians(ul.longitude)) +
                sin(radians(ul.latitude)) * sin(radians(p.latitude))
              )
            )
            ELSE NULL
          END AS distance,
          -- Count shared tags
          (
            SELECT COUNT(*)
            FROM user_tags ut1
            JOIN user_tags ut2 ON ut1.tag_id = ut2.tag_id
            WHERE ut1.user_id = $1 AND ut2.user_id = u.id
          ) AS shared_tags,
          -- Get profile picture
          (
            SELECT url FROM images 
            WHERE user_id = u.id AND is_profile_picture = true 
            LIMIT 1
          ) AS profile_picture,
          -- Check if already liked
          EXISTS(SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = u.id) AS already_liked,
          -- Check if they liked you
          EXISTS(SELECT 1 FROM likes WHERE liker_id = u.id AND liked_id = $1) AS liked_you
        FROM users u
        JOIN profiles p ON p.user_id = u.id
        CROSS JOIN user_location ul
        WHERE u.id != $1
          ${genderFilter}
          ${preferenceFilter}
          AND NOT EXISTS(SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = u.id)
          AND NOT EXISTS(SELECT 1 FROM blocks WHERE blocker_id = u.id AND blocked_id = $1)
          AND NOT EXISTS(SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = u.id)
      )
      SELECT 
        *,
        -- Calculate matching score
        (
          CASE 
            WHEN distance IS NOT NULL THEN
              CASE 
                WHEN distance = 0 THEN 40
                WHEN distance < 10 THEN 35
                WHEN distance < 50 THEN 30
                WHEN distance < 100 THEN 20
                WHEN distance < 500 THEN 10
                ELSE 5
              END
            ELSE 20
          END * 0.4 +
          (shared_tags * 7) * 0.35 +
          (CASE WHEN fame_rating > 0 THEN LEAST(fame_rating / 10.0, 100) ELSE 0 END) * 0.25
        ) AS score
      FROM candidates
      ${orderByClause}
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [req.userId, limitNum, offset, currentUser.gender]);

    // Get tags for each user
    const userIds = result.rows.map(row => row.id);
    let tagsMap = {};

    if (userIds.length > 0) {
      const tagsResult = await pool.query(
        `SELECT ut.user_id, t.id, t.name
         FROM user_tags ut
         JOIN tags t ON t.id = ut.tag_id
         WHERE ut.user_id = ANY($1)`,
        [userIds]
      );

      tagsResult.rows.forEach(tag => {
        if (!tagsMap[tag.user_id]) {
          tagsMap[tag.user_id] = [];
        }
        tagsMap[tag.user_id].push({ id: tag.id, name: tag.name });
      });
    }

    const suggestions = result.rows.map(row => ({
      ...row,
      tags: tagsMap[row.id] || [],
      distance: row.distance ? Math.round(row.distance * 10) / 10 : null
    }));

    res.json({ suggestions });
  } catch (error) {
    next(error);
  }
});

// GET /api/browse/search
router.get('/search', authMiddleware, async (req, res, next) => {
  try {
    const {
      ageMin,
      ageMax,
      fameMin,
      fameMax,
      city,
      maxDistance,
      tags,
      sortBy = 'score',
      page = 1,
      limit = 20
    } = req.query;

    // Validate numeric inputs
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;
    
    // Validate age parameters
    const ageMinNum = ageMin ? Math.max(18, parseInt(ageMin, 10)) : null;
    const ageMaxNum = ageMax ? Math.max(18, parseInt(ageMax, 10)) : null;
    
    // Validate fame parameters
    const fameMinNum = fameMin ? parseInt(fameMin, 10) : null;
    const fameMaxNum = fameMax ? parseInt(fameMax, 10) : null;
    
    // Validate distance parameter
    const maxDistanceNum = maxDistance ? Math.max(0, parseFloat(maxDistance)) : null;

    // Get current user's profile
    const currentUserResult = await pool.query(
      'SELECT gender, sexual_preference, latitude, longitude FROM profiles WHERE user_id = $1',
      [req.userId]
    );

    if (currentUserResult.rows.length === 0) {
      return res.status(400).json({ error: 'Please complete your profile first' });
    }

    const currentUser = currentUserResult.rows[0];

    // Validate user data
    if (!currentUser.gender) {
      return res.status(400).json({ error: 'Profile gender is required' });
    }

    // Build dynamic WHERE clauses
    const conditions = [];
    const params = [req.userId];
    let paramCount = 1;

    // Sexual compatibility
    let genderFilter = '';
    if (currentUser.sexual_preference === 'male') {
      genderFilter = "AND p.gender = 'male'";
    } else if (currentUser.sexual_preference === 'female') {
      genderFilter = "AND p.gender = 'female'";
    }

    // Add gender parameter for preference filter to prevent SQL injection
    params.push(currentUser.gender);
    paramCount++;
    const preferenceFilter = `
      AND (
        p.sexual_preference = 'both' 
        OR p.sexual_preference = $${paramCount}
      )
    `;

    // Age filter (using created_at as proxy)
    if (ageMinNum) {
      const maxDate = new Date();
      maxDate.setFullYear(maxDate.getFullYear() - ageMinNum);
      params.push(maxDate);
      paramCount++;
      conditions.push(`u.created_at <= $${paramCount}`);
    }

    if (ageMaxNum) {
      const minDate = new Date();
      minDate.setFullYear(minDate.getFullYear() - ageMaxNum);
      params.push(minDate);
      paramCount++;
      conditions.push(`u.created_at >= $${paramCount}`);
    }

    // Fame rating filter
    if (fameMinNum !== null) {
      params.push(fameMinNum);
      paramCount++;
      conditions.push(`p.fame_rating >= $${paramCount}`);
    }

    if (fameMaxNum !== null) {
      params.push(fameMaxNum);
      paramCount++;
      conditions.push(`p.fame_rating <= $${paramCount}`);
    }

    // City filter
    if (city) {
      params.push(`%${city}%`);
      paramCount++;
      conditions.push(`p.city ILIKE $${paramCount}`);
    }

    // Distance filter
    let distanceFilter = '';
    if (maxDistanceNum && currentUser.latitude && currentUser.longitude) {
      params.push(maxDistanceNum);
      paramCount++;
      distanceFilter = `AND distance <= $${paramCount}`;
    }

    // Tags filter
    let tagsFilter = '';
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      params.push(tagArray);
      paramCount++;
      tagsFilter = `
        AND u.id IN (
          SELECT ut.user_id
          FROM user_tags ut
          JOIN tags t ON t.id = ut.tag_id
          WHERE t.name = ANY($${paramCount})
          GROUP BY ut.user_id
          HAVING COUNT(DISTINCT t.id) >= 1
        )
      `;
    }

    const whereClause = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

    let orderByClause = '';
    switch (sortBy) {
      case 'age':
        orderByClause = 'ORDER BY u.created_at DESC';
        break;
      case 'location':
        orderByClause = 'ORDER BY distance ASC';
        break;
      case 'fame':
        orderByClause = 'ORDER BY p.fame_rating DESC';
        break;
      case 'tags':
        orderByClause = 'ORDER BY shared_tags DESC';
        break;
      default:
        orderByClause = 'ORDER BY score DESC';
    }

    params.push(limit);
    params.push(offset);

    const query = `
      WITH user_location AS (
        SELECT latitude, longitude
        FROM profiles
        WHERE user_id = $1
      ),
      candidates AS (
        SELECT 
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.last_online,
          p.gender,
          p.biography,
          p.city,
          p.fame_rating,
          p.latitude,
          p.longitude,
          CASE 
            WHEN p.latitude IS NOT NULL AND p.longitude IS NOT NULL 
              AND ul.latitude IS NOT NULL AND ul.longitude IS NOT NULL
            THEN (
              6371 * acos(
                cos(radians(ul.latitude)) * cos(radians(p.latitude)) *
                cos(radians(p.longitude) - radians(ul.longitude)) +
                sin(radians(ul.latitude)) * sin(radians(p.latitude))
              )
            )
            ELSE NULL
          END AS distance,
          (
            SELECT COUNT(*)
            FROM user_tags ut1
            JOIN user_tags ut2 ON ut1.tag_id = ut2.tag_id
            WHERE ut1.user_id = $1 AND ut2.user_id = u.id
          ) AS shared_tags,
          (
            SELECT url FROM images 
            WHERE user_id = u.id AND is_profile_picture = true 
            LIMIT 1
          ) AS profile_picture,
          EXISTS(SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = u.id) AS already_liked,
          EXISTS(SELECT 1 FROM likes WHERE liker_id = u.id AND liked_id = $1) AS liked_you
        FROM users u
        JOIN profiles p ON p.user_id = u.id
        CROSS JOIN user_location ul
        WHERE u.id != $1
          ${genderFilter}
          ${preferenceFilter}
          AND NOT EXISTS(SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = u.id)
          AND NOT EXISTS(SELECT 1 FROM blocks WHERE blocker_id = u.id AND blocked_id = $1)
          ${whereClause}
          ${tagsFilter}
      )
      SELECT 
        *,
        (
          CASE 
            WHEN distance IS NOT NULL THEN
              CASE 
                WHEN distance = 0 THEN 40
                WHEN distance < 10 THEN 35
                WHEN distance < 50 THEN 30
                WHEN distance < 100 THEN 20
                WHEN distance < 500 THEN 10
                ELSE 5
              END
            ELSE 20
          END * 0.4 +
          (shared_tags * 7) * 0.35 +
          (CASE WHEN fame_rating > 0 THEN LEAST(fame_rating / 10.0, 100) ELSE 0 END) * 0.25
        ) AS score
      FROM candidates
      WHERE 1=1 ${distanceFilter}
      ${orderByClause}
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    const result = await pool.query(query, params);

    // Get tags for each user
    const userIds = result.rows.map(row => row.id);
    let tagsMap = {};

    if (userIds.length > 0) {
      const tagsResult = await pool.query(
        `SELECT ut.user_id, t.id, t.name
         FROM user_tags ut
         JOIN tags t ON t.id = ut.tag_id
         WHERE ut.user_id = ANY($1)`,
        [userIds]
      );

      tagsResult.rows.forEach(tag => {
        if (!tagsMap[tag.user_id]) {
          tagsMap[tag.user_id] = [];
        }
        tagsMap[tag.user_id].push({ id: tag.id, name: tag.name });
      });
    }

    const results = result.rows.map(row => ({
      ...row,
      tags: tagsMap[row.id] || [],
      distance: row.distance ? Math.round(row.distance * 10) / 10 : null
    }));

    res.json({ results });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
