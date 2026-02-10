import pool from '../db/pool.js';

/**
 * Calculate and update fame rating for a user
 * Formula: (total_likes * 3) + (total_visits * 1) - (total_dislikes * 2)
 */
async function updateFameRating(userId) {
  try {
    const query = `
      WITH stats AS (
        SELECT
          COALESCE(COUNT(DISTINCT l.liker_id), 0) AS total_likes,
          COALESCE(COUNT(DISTINCT v.visitor_id), 0) AS total_visits,
          COALESCE(
            (SELECT COUNT(*) 
             FROM likes l2 
             WHERE l2.liked_id = $1 
             AND NOT EXISTS (
               SELECT 1 FROM likes l3 
               WHERE l3.liker_id = l2.liker_id 
               AND l3.liked_id = $1
             )
            ), 0
          ) AS total_dislikes
        FROM profiles p
        LEFT JOIN likes l ON l.liked_id = $1
        LEFT JOIN visits v ON v.visited_id = $1
        WHERE p.user_id = $1
      )
      UPDATE profiles
      SET fame_rating = (
        SELECT (total_likes * 3) + (total_visits * 1) - (total_dislikes * 2)
        FROM stats
      )
      WHERE user_id = $1
      RETURNING fame_rating;
    `;

    const result = await pool.query(query, [userId]);
    
    if (result.rows.length > 0) {
      return result.rows[0].fame_rating;
    }
    
    return 0;
  } catch (error) {
    console.error('Error updating fame rating:', error);
    throw error;
  }
}

/**
 * Get current fame rating for a user
 */
async function getFameRating(userId) {
  try {
    const query = 'SELECT fame_rating FROM profiles WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    
    if (result.rows.length > 0) {
      return result.rows[0].fame_rating;
    }
    
    return 0;
  } catch (error) {
    console.error('Error getting fame rating:', error);
    throw error;
  }
}

export {
  updateFameRating,
  getFameRating,
};
