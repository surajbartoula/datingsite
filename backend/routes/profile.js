const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = process.env.UPLOAD_DIR || 'uploads';
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880 // 5MB
  },
  fileFilter: fileFilter
});

// GET /api/profile
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.username, u.first_name, u.last_name,
              p.gender, p.sexual_preference, p.biography, p.latitude, p.longitude, 
              p.city, p.location_consent, p.fame_rating
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = result.rows[0];

    // Get user tags
    const tagsResult = await pool.query(
      `SELECT t.id, t.name 
       FROM tags t
       JOIN user_tags ut ON ut.tag_id = t.id
       WHERE ut.user_id = $1`,
      [req.userId]
    );

    // Get user images
    const imagesResult = await pool.query(
      'SELECT id, url, is_profile_picture FROM images WHERE user_id = $1 ORDER BY is_profile_picture DESC, id ASC',
      [req.userId]
    );

    profile.tags = tagsResult.rows;
    profile.images = imagesResult.rows;

    res.json({ profile });
  } catch (error) {
    next(error);
  }
});

// PUT /api/profile
router.put('/', authMiddleware, [
  body('gender').optional().isIn(['male', 'female', 'other']),
  body('sexualPreference').optional().isIn(['male', 'female', 'both']),
  body('biography').optional().isLength({ max: 500 }),
  body('city').optional().isLength({ max: 100 }),
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
  body('locationConsent').optional().isBoolean()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { gender, sexualPreference, biography, city, latitude, longitude, locationConsent } = req.body;

    const result = await pool.query(
      `UPDATE profiles 
       SET gender = COALESCE($1, gender),
           sexual_preference = COALESCE($2, sexual_preference),
           biography = COALESCE($3, biography),
           city = COALESCE($4, city),
           latitude = COALESCE($5, latitude),
           longitude = COALESCE($6, longitude),
           location_consent = COALESCE($7, location_consent)
       WHERE user_id = $8
       RETURNING *`,
      [gender, sexualPreference, biography, city, latitude, longitude, locationConsent, req.userId]
    );

    res.json({ 
      message: 'Profile updated successfully',
      profile: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/profile/tags
router.post('/tags', authMiddleware, [
  body('tags').isArray({ min: 1, max: 10 }),
  body('tags.*').isString().trim().isLength({ min: 1, max: 30 })
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tags } = req.body;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Delete existing tags for user
      await client.query('DELETE FROM user_tags WHERE user_id = $1', [req.userId]);

      // Insert or get tags
      for (const tagName of tags) {
        const lowerTagName = tagName.toLowerCase();
        
        // Insert tag if it doesn't exist
        const tagResult = await client.query(
          'INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = $1 RETURNING id',
          [lowerTagName]
        );

        const tagId = tagResult.rows[0].id;

        // Associate tag with user
        await client.query(
          'INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.userId, tagId]
        );
      }

      await client.query('COMMIT');

      // Get updated tags
      const result = await pool.query(
        `SELECT t.id, t.name 
         FROM tags t
         JOIN user_tags ut ON ut.tag_id = t.id
         WHERE ut.user_id = $1`,
        [req.userId]
      );

      res.json({ 
        message: 'Tags updated successfully',
        tags: result.rows
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

// GET /api/profile/tags/search
router.get('/tags/search', authMiddleware, async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 2) {
      return res.json({ tags: [] });
    }

    const result = await pool.query(
      'SELECT id, name FROM tags WHERE name ILIKE $1 LIMIT 10',
      [`%${query}%`]
    );

    res.json({ tags: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/profile/images
router.post('/images', authMiddleware, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Check image count (max 5)
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM images WHERE user_id = $1',
      [req.userId]
    );

    if (parseInt(countResult.rows[0].count, 10) >= 5) {
      // Delete uploaded file asynchronously
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file:', unlinkError);
      }
      return res.status(400).json({ error: 'Maximum 5 images allowed' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    const isProfilePicture = req.body.isProfilePicture === 'true';

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // If setting as profile picture, unset others
      if (isProfilePicture) {
        await client.query(
          'UPDATE images SET is_profile_picture = false WHERE user_id = $1',
          [req.userId]
        );
      }

      // Insert new image
      const result = await client.query(
        'INSERT INTO images (user_id, url, is_profile_picture) VALUES ($1, $2, $3) RETURNING *',
        [req.userId, imageUrl, isProfilePicture]
      );

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Image uploaded successfully',
        image: result.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      // Delete uploaded file asynchronously on error
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file after rollback:', unlinkError);
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

// PUT /api/profile/images/:imageId/profile-picture
router.put('/images/:imageId/profile-picture', authMiddleware, async (req, res, next) => {
  try {
    const { imageId } = req.params;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Verify image belongs to user
      const checkResult = await client.query(
        'SELECT id FROM images WHERE id = $1 AND user_id = $2',
        [imageId, req.userId]
      );

      if (checkResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Image not found' });
      }

      // Unset all profile pictures
      await client.query(
        'UPDATE images SET is_profile_picture = false WHERE user_id = $1',
        [req.userId]
      );

      // Set new profile picture
      await client.query(
        'UPDATE images SET is_profile_picture = true WHERE id = $1',
        [imageId]
      );

      await client.query('COMMIT');

      res.json({ message: 'Profile picture updated successfully' });
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

// DELETE /api/profile/images/:imageId
router.delete('/images/:imageId', authMiddleware, async (req, res, next) => {
  try {
    const { imageId } = req.params;

    const result = await pool.query(
      'DELETE FROM images WHERE id = $1 AND user_id = $2 RETURNING url',
      [imageId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Delete file from disk asynchronously
    const filePath = path.join(__dirname, '..', result.rows[0].url);
    try {
      await fs.unlink(filePath);
    } catch (unlinkError) {
      // Log error but don't fail the request if file doesn't exist
      if (unlinkError.code !== 'ENOENT') {
        console.error('Error deleting file from disk:', unlinkError);
      }
    }

    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
