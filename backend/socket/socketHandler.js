import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';

// Store active user sockets
const userSockets = new Map(); // userId -> socketId
function socketHandler(io) {
  // Socket.io authentication middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.cookie?.split('token=')[1]?.split(';')[0];
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.user = decoded;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`User ${userId} connected with socket ${socket.id}`);

    // Store user's socket
    userSockets.set(userId, socket.id);

    // Update user's online status
    pool.query('UPDATE users SET last_online = NOW() WHERE id = $1', [userId])
      .catch(err => console.error('Error updating online status:', err));

    // Emit to user's matches that they're online
    pool.query(
      `SELECT u.id FROM users u
       WHERE EXISTS(SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = u.id)
         AND EXISTS(SELECT 1 FROM likes WHERE liker_id = u.id AND liked_id = $1)`,
      [userId]
    ).then(result => {
      if (result && result.rows) {
        result.rows.forEach(row => {
          const matchSocketId = userSockets.get(row.id);
          if (matchSocketId) {
            io.to(matchSocketId).emit('user_online', { userId });
          }
        });
      }
    }).catch(err => console.error('Error notifying matches:', err));

    // Join user to their personal room
    socket.join(`user_${userId}`);

    // Handle chat messages
    socket.on('send_message', async (data) => {
      try {
        const { receiverId, content } = data;

        if (!receiverId || !content || content.trim() === '') {
          socket.emit('error', { message: 'Invalid message data' });
          return;
        }

        // Check if users are matched
        const matchCheck = await pool.query(
          `SELECT 1 FROM likes l1
           WHERE l1.liker_id = $1 AND l1.liked_id = $2
           AND EXISTS(SELECT 1 FROM likes l2 WHERE l2.liker_id = $2 AND l2.liked_id = $1)`,
          [userId, receiverId]
        );

        if (matchCheck.rows.length === 0) {
          socket.emit('error', { message: 'Can only message matched users' });
          return;
        }

        // Check if blocked
        const blockCheck = await pool.query(
          `SELECT 1 FROM blocks 
           WHERE (blocker_id = $1 AND blocked_id = $2) 
              OR (blocker_id = $2 AND blocked_id = $1)`,
          [userId, receiverId]
        );

        if (blockCheck.rows.length > 0) {
          socket.emit('error', { message: 'Cannot message this user' });
          return;
        }

        // Insert message into database
        const result = await pool.query(
          `INSERT INTO messages (sender_id, receiver_id, content)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [userId, receiverId, content.trim()]
        );

        const message = result.rows[0];

        // Emit to sender (confirmation)
        socket.emit('message_sent', message);

        // Emit to receiver if they're online
        const receiverSocketId = userSockets.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('new_message', message);
        }

        // Create message notification
        await pool.query(
          `INSERT INTO notifications (user_id, type, from_user_id)
           VALUES ($1, 'message', $2)`,
          [receiverId, userId]
        );

        // Emit notification to receiver
        if (receiverSocketId) {
          const notificationData = {
            type: 'message',
            from_user_id: userId,
            created_at: new Date()
          };
          io.to(receiverSocketId).emit('new_notification', notificationData);
        }
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle typing indicators
    socket.on('typing_start', async (data) => {
      try {
        const { receiverId } = data;
        const receiverSocketId = userSockets.get(receiverId);
        
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('user_typing', { userId });
        }
      } catch (error) {
        console.error('Error handling typing start:', error);
      }
    });

    socket.on('typing_stop', async (data) => {
      try {
        const { receiverId } = data;
        const receiverSocketId = userSockets.get(receiverId);
        
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('user_stopped_typing', { userId });
        }
      } catch (error) {
        console.error('Error handling typing stop:', error);
      }
    });

    // Handle message read receipts
    socket.on('mark_messages_read', async (data) => {
      try {
        const { senderId } = data;

        await pool.query(
          `UPDATE messages 
           SET is_read = true 
           WHERE sender_id = $1 AND receiver_id = $2 AND is_read = false`,
          [senderId, userId]
        );

        // Notify sender that messages were read
        const senderSocketId = userSockets.get(senderId);
        if (senderSocketId) {
          io.to(senderSocketId).emit('messages_read', { readBy: userId });
        }
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`User ${userId} disconnected`);
      
      // Remove from active users
      userSockets.delete(userId);

      // Update last online timestamp
      pool.query('UPDATE users SET last_online = NOW() WHERE id = $1', [userId])
        .catch(err => console.error('Error updating last online:', err));

      // Notify matches that user went offline
      pool.query(
        `SELECT u.id FROM users u
         WHERE EXISTS(SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = u.id)
           AND EXISTS(SELECT 1 FROM likes WHERE liker_id = u.id AND liked_id = $1)`,
        [userId]
      ).then(result => {
        if (result && result.rows) {
          result.rows.forEach(row => {
            const matchSocketId = userSockets.get(row.id);
            if (matchSocketId) {
              io.to(matchSocketId).emit('user_offline', { userId });
            }
          });
        }
      }).catch(err => console.error('Error notifying matches of offline:', err));
    });
  });

  // Function to emit notification to a specific user
  io.emitNotification = (userId, notification) => {
    const socketId = userSockets.get(userId);
    if (socketId) {
      io.to(socketId).emit('new_notification', notification);
    }
  };

  return io;
}

export default socketHandler;
