import express from 'express';
import pool from '../db/pool.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/chat/:userId/messages - Get message history with a user
router.get('/:userId/messages', authMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const otherUserId = parseInt(userId);

    // Check if users are matched
    const matchCheck = await pool.query(
      `SELECT 1 FROM likes l1
       WHERE l1.liker_id = $1 AND l1.liked_id = $2
       AND EXISTS(SELECT 1 FROM likes l2 WHERE l2.liker_id = $2 AND l2.liked_id = $1)`,
      [req.userId, otherUserId]
    );

    if (matchCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You can only chat with matched users' });
    }

    // Check if blocked
    const blockCheck = await pool.query(
      `SELECT 1 FROM blocks 
       WHERE (blocker_id = $1 AND blocked_id = $2) 
          OR (blocker_id = $2 AND blocked_id = $1)`,
      [req.userId, otherUserId]
    );

    if (blockCheck.rows.length > 0) {
      return res.status(403).json({ error: 'Cannot chat with this user' });
    }

    // Get messages
    const result = await pool.query(
      `SELECT 
        id,
        sender_id,
        receiver_id,
        content,
        sent_at,
        is_read
      FROM messages
      WHERE (sender_id = $1 AND receiver_id = $2) 
         OR (sender_id = $2 AND receiver_id = $1)
      ORDER BY sent_at ASC
      LIMIT 100`,
      [req.userId, otherUserId]
    );

    // Mark messages as read
    await pool.query(
      `UPDATE messages 
       SET is_read = true 
       WHERE sender_id = $1 AND receiver_id = $2 AND is_read = false`,
      [otherUserId, req.userId]
    );

    res.json({ messages: result.rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/chat/conversations - Get all conversations with unread counts
router.get('/conversations', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `WITH latest_messages AS (
        SELECT DISTINCT ON (
          CASE 
            WHEN sender_id = $1 THEN receiver_id 
            ELSE sender_id 
          END
        )
          CASE 
            WHEN sender_id = $1 THEN receiver_id 
            ELSE sender_id 
          END AS other_user_id,
          content AS last_message,
          sent_at AS last_message_at,
          sender_id = $1 AS sent_by_me
        FROM messages
        WHERE sender_id = $1 OR receiver_id = $1
        ORDER BY 
          CASE 
            WHEN sender_id = $1 THEN receiver_id 
            ELSE sender_id 
          END,
          sent_at DESC
      )
      SELECT 
        u.id,
        u.username,
        u.first_name,
        u.last_name,
        u.last_online,
        (SELECT url FROM images WHERE user_id = u.id AND is_profile_picture = true LIMIT 1) AS profile_picture,
        lm.last_message,
        lm.last_message_at,
        lm.sent_by_me,
        (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = $1 AND is_read = false) AS unread_count
      FROM latest_messages lm
      JOIN users u ON u.id = lm.other_user_id
      WHERE EXISTS(SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = u.id)
        AND EXISTS(SELECT 1 FROM likes WHERE liker_id = u.id AND liked_id = $1)
        AND NOT EXISTS(SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = u.id) OR (blocker_id = u.id AND blocked_id = $1))
      ORDER BY lm.last_message_at DESC`,
      [req.userId]
    );

    res.json({ conversations: result.rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/chat/unread-count - Get total unread message count
router.get('/unread-count', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND is_read = false',
      [req.userId]
    );

    res.json({ unreadCount: parseInt(result.rows[0].count) });
  } catch (error) {
    next(error);
  }
});

export default router;
