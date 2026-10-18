const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Search users by username
router.get('/search', authRequired, (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ users: [] });

  const users = db.prepare(`
    SELECT id, username, display_name, avatar_color, status
    FROM users
    WHERE username LIKE ? OR display_name LIKE ?
    AND id != ?
    LIMIT 20
  `).all(`%${q}%`, `%${q}%`, req.user.id);

  // Check friendship status for each result
  const results = users.map(u => {
    const friend = db.prepare(`
      SELECT status FROM friend_requests
      WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
    `).get(req.user.id, u.id, u.id, req.user.id);
    return { ...u, friendship: friend ? friend.status : 'none' };
  });
  res.json({ users: results });
});

// Get user by username
router.get('/:username', authRequired, (req, res) => {
  const user = db.prepare('SELECT id, username, display_name, avatar_color, status, last_seen FROM users WHERE username = ?').get(req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ user });
});

module.exports = router;
