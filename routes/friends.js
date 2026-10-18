const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Get friends list
router.get('/', authRequired, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, u.last_seen
    FROM friend_requests fr
    JOIN users u ON (u.id = CASE WHEN fr.sender_id = ? THEN fr.receiver_id ELSE fr.sender_id END)
    WHERE fr.status = 'accepted'
    AND (fr.sender_id = ? OR fr.receiver_id = ?)
    ORDER BY u.display_name
  `).all(req.user.id, req.user.id, req.user.id);
  res.json({ friends });
});

// Get pending friend requests (received)
router.get('/requests', authRequired, (req, res) => {
  const requests = db.prepare(`
    SELECT fr.id, fr.sender_id, fr.created_at,
           u.username, u.display_name, u.avatar_color
    FROM friend_requests fr
    JOIN users u ON u.id = fr.sender_id
    WHERE fr.receiver_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `).all(req.user.id);

  const sent = db.prepare(`
    SELECT fr.id, fr.receiver_id, fr.created_at,
           u.username, u.display_name, u.avatar_color
    FROM friend_requests fr
    JOIN users u ON u.id = fr.receiver_id
    WHERE fr.sender_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `).all(req.user.id);

  res.json({ received: requests, sent });
});

// Send friend request
router.post('/request', authRequired, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '请输入用户名' });

  const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username.toLowerCase());
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.id === req.user.id) return res.status(400).json({ error: '不能添加自己为好友' });

  // Check existing request
  const existing = db.prepare(`
    SELECT * FROM friend_requests
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
  `).get(req.user.id, target.id, target.id, req.user.id);

  if (existing) {
    if (existing.status === 'accepted') return res.status(400).json({ error: '你们已经是好友了' });
    if (existing.status === 'pending') {
      if (existing.sender_id === req.user.id) return res.status(400).json({ error: '已发送过好友申请，等待对方确认' });
      // Auto-accept if they already sent us a request
      db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run('accepted', existing.id);
      return res.json({ message: '已接受对方的好友申请', status: 'accepted' });
    }
    if (existing.status === 'rejected') {
      db.prepare('UPDATE friend_requests SET status = ?, sender_id = ?, receiver_id = ? WHERE id = ?').run('pending', req.user.id, target.id, existing.id);
      return res.json({ message: '好友申请已发送' });
    }
  }

  db.prepare('INSERT INTO friend_requests (sender_id, receiver_id, status) VALUES (?, ?, ?)').run(req.user.id, target.id, 'pending');
  res.json({ message: '好友申请已发送' });
});

// Accept friend request
router.post('/accept/:id', authRequired, (req, res) => {
  const request = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ?').get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: '申请不存在' });
  if (request.status !== 'pending') return res.status(400).json({ error: '申请已处理' });

  db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run('accepted', request.id);
  res.json({ message: '已接受好友申请' });
});

// Reject friend request
router.post('/reject/:id', authRequired, (req, res) => {
  const request = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ?').get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: '申请不存在' });
  db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run('rejected', request.id);
  res.json({ message: '已拒绝好友申请' });
});

// Remove friend
router.delete('/:userId', authRequired, (req, res) => {
  const result = db.prepare(`
    DELETE FROM friend_requests
    WHERE status = 'accepted'
    AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
  `).run(req.user.id, req.params.userId, req.params.userId, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: '好友关系不存在' });
  res.json({ message: '已删除好友' });
});

module.exports = router;
