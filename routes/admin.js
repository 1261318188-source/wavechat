const express = require('express');
const db = require('../db');
const { adminRequired } = require('../middleware/auth');

const router = express.Router();

function logAction(adminId, action, targetType, targetId, details, ip) {
  db.prepare(`INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, ip_address)
              VALUES (?, ?, ?, ?, ?, ?)`).run(adminId, action, targetType, targetId, details, ip || '');
}

// Dashboard stats
router.get('/stats', adminRequired, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const activeUsers = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE status = 'active'").get().cnt;
  const bannedUsers = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE status = 'banned'").get().cnt;
  const totalGroups = db.prepare('SELECT COUNT(*) as cnt FROM groups').get().cnt;
  const totalMessages = db.prepare('SELECT COUNT(*) as cnt FROM messages').get().cnt;
  const totalFriendships = db.prepare("SELECT COUNT(*) as cnt FROM friend_requests WHERE status = 'accepted'").get().cnt;
  const todayMessages = db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE DATE(created_at) = DATE('now')").get().cnt;
  const todayNewUsers = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE DATE(created_at) = DATE('now')").get().cnt;

  res.json({
    totalUsers, activeUsers, bannedUsers, totalGroups,
    totalMessages, totalFriendships, todayMessages, todayNewUsers
  });
});

// List all users
router.get('/users', adminRequired, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  let where = '';
  let params = [];
  if (search) {
    where = 'WHERE username LIKE ? OR display_name LIKE ?';
    params = [`%${search}%`, `%${search}%`];
  }

  const users = db.prepare(`
    SELECT id, username, display_name, avatar_color, role, status, last_seen, created_at
    FROM users ${where}
    ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM users ${where}`).get(...params).cnt;
  res.json({ users, total, page, limit });
});

// Ban user
router.post('/users/:id/ban', adminRequired, (req, res) => {
  const { reason } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'admin') return res.status(400).json({ error: '不能封禁管理员账号' });

  db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(user.id);
  logAction(req.user.id, 'ban_user', 'user', user.id, `封禁 @${user.username}，原因：${reason || '未填写'}`, req.ip);
  res.json({ message: `已封禁 @${user.username}` });
});

// Unban user
router.post('/users/:id/unban', adminRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(user.id);
  logAction(req.user.id, 'unban_user', 'user', user.id, `解封 @${user.username}`, req.ip);
  res.json({ message: `已解封 @${user.username}` });
});

// List all groups
router.get('/groups', adminRequired, (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.avatar_color, g.creator_id, g.created_at,
           u.username as creator_username, u.display_name as creator_name,
           (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
           (SELECT COUNT(*) FROM messages m WHERE m.group_id = g.id) as message_count
    FROM groups g
    JOIN users u ON u.id = g.creator_id
    ORDER BY g.created_at DESC
  `).all();
  res.json({ groups });
});

// Delete group
router.delete('/groups/:id', adminRequired, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '群聊不存在' });

  db.prepare('DELETE FROM groups WHERE id = ?').run(group.id);
  logAction(req.user.id, 'delete_group', 'group', group.id, `删除群聊：${group.name}`, req.ip);
  res.json({ message: `已删除群聊：${group.name}` });
});

// Admin logs
router.get('/logs', adminRequired, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const logs = db.prepare(`
    SELECT al.*, u.username as admin_username, u.display_name as admin_name
    FROM admin_logs al
    JOIN users u ON u.id = al.admin_id
    ORDER BY al.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare('SELECT COUNT(*) as cnt FROM admin_logs').get().cnt;
  res.json({ logs, total, page, limit });
});

// View messages (admin audit)
router.get('/messages', adminRequired, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const messages = db.prepare(`
    SELECT m.id, m.chat_type, m.content, m.created_at,
           s.username as sender_username, s.display_name as sender_name,
           r.username as receiver_username,
           g.name as group_name
    FROM messages m
    JOIN users s ON s.id = m.sender_id
    LEFT JOIN users r ON r.id = m.receiver_id
    LEFT JOIN groups g ON g.id = m.group_id
    ORDER BY m.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare('SELECT COUNT(*) as cnt FROM messages').get().cnt;
  res.json({ messages, total, page, limit });
});

module.exports = router;
