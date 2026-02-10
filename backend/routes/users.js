import express from 'express';
import pool from '../db/pool.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { updateFameRating } from '../utils/fameRating.js';

const router = express.Router();

// GET /api/users/:id - View user profile
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if blocked
    const blockCheck = await pool.query(
      `SELECT 1 FROM blocks 
       WHERE (blocker_id = $1 AND blocked_id = $2) 
          OR (blocker_id = $2 AND blocked_id = $1)`,
      [req.userId, id]
    );

    if (blockCheck.rows.length > 0) {
      return res.status(403).json({ error: 'Profile not accessible' });
    }

    // Get user profile
    const result = await pool.query(
      `SELECT 
        u.id,
        u.username,
        u.first_name,
        u.last_name,
        u.last_online,
        p.gender,
        p.sexual_preference,
        p.biography,
        p.city,
        p.fame_rating,
        p.latitude,
        p.longitude,
        EXISTS(SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = $2) AS you_liked,
        EXISTS(SELECT 1 FROM likes WHERE liker_id = $2 AND liked_id = $1) AS they_liked,
        EXISTS(
          SELECT 1 FROM likes l1 
          WHERE l1.liker_id = $1 AND l1.liked_id = $2
          AND EXISTS(SELECT 1 FROM likes l2 WHERE l2.liker_id = $2 AND l2.liked_id = $1)
        ) AS is_match
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      WHERE u.id = $2`,
      [req.userId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Get images
    const imagesResult = await pool.query(
      'SELECT id, url, is_profile_picture FROM images WHERE user_id = $1 ORDER BY is_profile_picture DESC',
      [id]
    );

    // Get tags
    const tagsResult = await pool.query(
      `SELECT t.id, t.name 
       FROM tags t
       JOIN user_tags ut ON ut.tag_id = t.id
       WHERE ut.user_id = $1`,
      [id]
    );

    // Record visit (only if viewing someone else)
    if (parseInt(id, 10) !== req.userId) {
      await pool.query(
        'INSERT INTO visits (visitor_id, visited_id) VALUES ($1, $2)',
        [req.userId, id]
      );

      // Create visit notification
      await pool.query(
        `INSERT INTO notifications (user_id, type, from_user_id)
         VALUES ($1, 'visit', $2)`,
        [id, req.userId]
      );

      // Update fame rating for visited user
      await updateFameRating(id);
    }

    user.images = imagesResult.rows;
    user.tags = tagsResult.rows;

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// POST /api/users/:id/like - Like a user
router.post('/:id/like', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const likedId = parseInt(id, 10);

    if (likedId === req.userId) {
      return res.status(400).json({ error: 'Cannot like yourself' });
    }

    // Check if user has profile picture
    const profilePicCheck = await pool.query(
      'SELECT 1 FROM images WHERE user_id = $1 AND is_profile_picture = true',
      [req.userId]
    );

    if (profilePicCheck.rows.length === 0) {
      return res.status(400).json({ error: 'You must have a profile picture to like users' });
    }

    // Check if blocked
    const blockCheck = await pool.query(
      `SELECT 1 FROM blocks 
       WHERE (blocker_id = $1 AND blocked_id = $2) 
          OR (blocker_id = $2 AND blocked_id = $1)`,
      [req.userId, likedId]
    );

    if (blockCheck.rows.length > 0) {
      return res.status(403).json({ error: 'Cannot like this user' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Insert like
      await client.query(
        'INSERT INTO likes (liker_id, liked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.userId, likedId]
      );

      // Check if it's a match (they already liked you)
      const matchCheck = await client.query(
        'SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = $2',
        [likedId, req.userId]
      );

      const isMatch = matchCheck.rows.length > 0;

      if (isMatch) {
        // Create match notifications for both users
        await client.query(
          `INSERT INTO notifications (user_id, type, from_user_id)
           VALUES ($1, 'match', $2), ($2, 'match', $1)`,
          [req.userId, likedId]
        );
      } else {
        // Create like notification
        await client.query(
          `INSERT INTO notifications (user_id, type, from_user_id)
           VALUES ($1, 'like', $2)`,
          [likedId, req.userId]
        );
      }

      await client.query('COMMIT');

      // Update fame rating
      await updateFameRating(likedId);

      res.json({
        message: isMatch ? 'It\'s a match!' : 'Like sent',
        isMatch
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

// DELETE /api/users/:id/like - Unlike a user
router.delete('/:id/like', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const likedId = parseInt(id, 10);

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if they were matched
      const matchCheck = await client.query(
        `SELECT 1 FROM likes l1
         WHERE l1.liker_id = $1 AND l1.liked_id = $2
         AND EXISTS(SELECT 1 FROM likes l2 WHERE l2.liker_id = $2 AND l2.liked_id = $1)`,
        [req.userId, likedId]
      );

      const wasMatch = matchCheck.rows.length > 0;

      // Delete the like
      const result = await client.query(
        'DELETE FROM likes WHERE liker_id = $1 AND liked_id = $2',
        [req.userId, likedId]
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Like not found' });
      }

      // Create unlike notification
      await client.query(
        `INSERT INTO notifications (user_id, type, from_user_id)
         VALUES ($1, 'unlike', $2)`,
        [likedId, req.userId]
      );

      await client.query('COMMIT');

      // Update fame rating
      await updateFameRating(likedId);

      res.json({ 
        message: 'Unlike successful',
        wasMatch 
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

// POST /api/users/:id/block - Block a user
router.post('/:id/block', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const blockedId = parseInt(id, 10);

    if (blockedId === req.userId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Insert block
      await client.query(
        'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.userId, blockedId]
      );

      // Remove any likes between the users
      await client.query(
        `DELETE FROM likes 
         WHERE (liker_id = $1 AND liked_id = $2) 
            OR (liker_id = $2 AND liked_id = $1)`,
        [req.userId, blockedId]
      );

      await client.query('COMMIT');

      res.json({ message: 'User blocked successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

// POST /api/users/:id/report - Report a user
router.post('/:id/report', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const reportedId = parseInt(id, 10);

    if (reportedId === req.userId) {
      return res.status(400).json({ error: 'Cannot report yourself' });
    }

    await pool.query(
      'INSERT INTO reports (reporter_id, reported_id) VALUES ($1, $2)',
      [req.userId, reportedId]
    );

    res.json({ message: 'Report submitted successfully' });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/:id/visitors - Get users who visited this profile
router.get('/:id/visitors', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Only allow viewing your own visitors
    if (parseInt(id, 10) !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await pool.query(
      `SELECT 
        u.id,
        u.username,
        u.first_name,
        u.last_name,
        v.visited_at,
        (SELECT url FROM images WHERE user_id = u.id AND is_profile_picture = true LIMIT 1) AS profile_picture
      FROM visits v
      JOIN users u ON u.id = v.visitor_id
      WHERE v.visited_id = $1
        AND NOT EXISTS(SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = u.id)
      ORDER BY v.visited_at DESC
      LIMIT 50`,
      [req.userId]
    );

    res.json({ visitors: result.rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/:id/likers - Get users who liked this profile
router.get('/:id/likers', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Only allow viewing your own likers
    if (parseInt(id, 10) !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await pool.query(
      `SELECT 
        u.id,
        u.username,
        u.first_name,
        u.last_name,
        l.created_at,
        (SELECT url FROM images WHERE user_id = u.id AND is_profile_picture = true LIMIT 1) AS profile_picture,
        EXISTS(SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = u.id) AS you_liked
      FROM likes l
      JOIN users u ON u.id = l.liker_id
      WHERE l.liked_id = $1
        AND NOT EXISTS(SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = u.id)
      ORDER BY l.created_at DESC
      LIMIT 50`,
      [req.userId]
    );

    res.json({ likers: result.rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/matches - Get mutual matches
router.get('/matches', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT 
        u.id,
        u.username,
        u.first_name,
        u.last_name,
        u.last_online,
        (SELECT url FROM images WHERE user_id = u.id AND is_profile_picture = true LIMIT 1) AS profile_picture,
        (SELECT COUNT(*) FROM messages WHERE (sender_id = $1 AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = $1)) AS message_count
      FROM users u
      WHERE EXISTS(SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = u.id)
        AND EXISTS(SELECT 1 FROM likes WHERE liker_id = u.id AND liked_id = $1)
        AND NOT EXISTS(SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = u.id)
        AND NOT EXISTS(SELECT 1 FROM blocks WHERE blocker_id = u.id AND blocked_id = $1)
      ORDER BY u.last_online DESC`,
      [req.userId]
    );

    res.json({ matches: result.rows });
  } catch (error) {
    next(error);
  }
});

export default router;
