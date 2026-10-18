const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Get direct message history with a user
router.get('/direct/:userId', authRequired, (req, res) => {
  const otherId = parseInt(req.params.userId);
  if (!otherId) return res.status(400).json({ error: '无效的用户ID' });

  // Verify they are friends (or at least allow messaging)
  const friend = db.prepare(`
    SELECT id FROM friend_requests
    WHERE status = 'accepted'
    AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
  `).get(req.user.id, otherId, otherId, req.user.id);

  const messages = db.prepare(`
    SELECT m.id, m.chat_type, m.sender_id, m.content, m.created_at,
           u.username, u.display_name, u.avatar_color
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.chat_type = 'direct'
    AND ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
    ORDER BY m.id ASC
  `).all(req.user.id, otherId, otherId, req.user.id);

  const other = db.prepare('SELECT id, username, display_name, avatar_color, status, last_seen FROM users WHERE id = ?').get(otherId);
  res.json({ messages, other, is_friend: !!friend });
});

// Get group message history
router.get('/group/:groupId', authRequired, (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const isMember = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, req.user.id);
  if (!isMember) return res.status(403).json({ error: '你不是该群成员' });

  const messages = db.prepare(`
    SELECT m.id, m.chat_type, m.sender_id, m.content, m.created_at,
           u.username, u.display_name, u.avatar_color
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.group_id = ?
    ORDER BY m.id ASC
  `).all(groupId);

  res.json({ messages });
});

// Send a direct message (REST fallback, real-time uses Socket.io)
router.post('/direct', authRequired, (req, res) => {
  const { receiver_id, content } = req.body;
  if (!receiver_id || !content || !content.trim()) return res.status(400).json({ error: '参数不完整' });

  const receiver = db.prepare('SELECT id, status FROM users WHERE id = ?').get(receiver_id);
  if (!receiver) return res.status(404).json({ error: '用户不存在' });
  if (receiver.status === 'banned') return res.status(403).json({ error: '对方账号已被封禁' });

  const result = db.prepare(`INSERT INTO messages (chat_type, sender_id, receiver_id, content) VALUES ('direct', ?, ?, ?)`)
    .run(req.user.id, receiver_id, content.trim());

  const message = db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar_color
    FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
  `).get(result.lastInsertRowid);

  res.json({ message });
});

// Send a group message (REST fallback)
router.post('/group', authRequired, (req, res) => {
  const { group_id, content } = req.body;
  if (!group_id || !content || !content.trim()) return res.status(400).json({ error: '参数不完整' });

  const isMember = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(group_id, req.user.id);
  if (!isMember) return res.status(403).json({ error: '你不是该群成员' });

  const result = db.prepare(`INSERT INTO messages (chat_type, sender_id, group_id, content) VALUES ('group', ?, ?, ?)`)
    .run(req.user.id, group_id, content.trim());

  const message = db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar_color
    FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
  `).get(result.lastInsertRowid);

  res.json({ message });
});

module.exports = router;
