const express = require('express');
const pool = require('../db/pool');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/notifications - Get all notifications for current user
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT 
        n.id,
        n.type,
        n.is_read,
        n.created_at,
        u.id AS from_user_id,
        u.username AS from_username,
        u.first_name AS from_first_name,
        u.last_name AS from_last_name,
        (SELECT url FROM images WHERE user_id = u.id AND is_profile_picture = true LIMIT 1) AS from_profile_picture
      FROM notifications n
      JOIN users u ON u.id = n.from_user_id
      WHERE n.user_id = $1
        AND NOT EXISTS(SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = u.id)
      ORDER BY n.created_at DESC
      LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    );

    res.json({ notifications: result.rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/notifications/unread-count - Get unread notification count
router.get('/unread-count', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) 
       FROM notifications n
       WHERE n.user_id = $1 
         AND n.is_read = false
         AND NOT EXISTS(
           SELECT 1 FROM blocks 
           WHERE blocker_id = $1 AND blocked_id = n.from_user_id
         )`,
      [req.userId]
    );

    res.json({ unreadCount: parseInt(result.rows[0].count, 10) });
  } catch (error) {
    next(error);
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ 
      message: 'Notification marked as read',
      notification: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/notifications/mark-all-read - Mark all notifications as read
router.put('/mark-all-read', authMiddleware, async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [req.userId]
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/notifications/:id - Delete a notification
router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
