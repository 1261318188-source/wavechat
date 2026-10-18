const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
const COLORS = ['#e8798f','#4f91d8','#8e79d6','#e9a34d','#36a89b','#6c9a74','#c16eb5','#c16f54'];

// Get my groups
router.get('/', authRequired, (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.avatar_color, g.creator_id, g.created_at,
           (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
           (SELECT content FROM messages m WHERE m.group_id = g.id ORDER BY m.id DESC LIMIT 1) as last_message,
           (SELECT created_at FROM messages m WHERE m.group_id = g.id ORDER BY m.id DESC LIMIT 1) as last_message_time
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
    ORDER BY COALESCE((SELECT MAX(id) FROM messages m WHERE m.group_id = g.id), 0) DESC, g.created_at DESC
  `).all(req.user.id);
  res.json({ groups });
});

// Create group
router.post('/', authRequired, (req, res) => {
  const { name, member_usernames } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '群聊名称不能为空' });

  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const result = db.prepare('INSERT INTO groups (name, creator_id, avatar_color) VALUES (?, ?, ?)').run(name.trim(), req.user.id, color);
  const groupId = result.lastInsertRowid;

  // Add creator as admin
  db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(groupId, req.user.id, 'admin');

  // Add invited members
  if (Array.isArray(member_usernames)) {
    const addMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)');
    for (const uname of member_usernames) {
      const u = db.prepare('SELECT id FROM users WHERE username = ?').get(uname.toLowerCase());
      if (u && u.id !== req.user.id) addMember.run(groupId, u.id, 'member');
    }
  }

  // System message
  db.prepare(`INSERT INTO messages (chat_type, sender_id, group_id, content) VALUES ('group', ?, ?, ?)`)
    .run(req.user.id, groupId, `群聊已创建，欢迎加入 ${name.trim()}！`);

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  res.json({ group, message: '群聊创建成功' });
});

// Get group info
router.get('/:id', authRequired, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '群聊不存在' });

  const isMember = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(group.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: '你不是该群成员' });

  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, gm.role, gm.joined_at
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY gm.role DESC, u.display_name
  `).all(group.id);

  res.json({ group, members, my_role: isMember.role });
});

// Add member to group
router.post('/:id/members', authRequired, (req, res) => {
  const { username } = req.body;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '群聊不存在' });

  const isMember = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(group.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: '你不是该群成员' });

  const target = db.prepare('SELECT id, username, display_name FROM users WHERE username = ?').get(username.toLowerCase());
  if (!target) return res.status(404).json({ error: '用户不存在' });

  const already = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(group.id, target.id);
  if (already) return res.status(400).json({ error: '该用户已在群聊中' });

  db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(group.id, target.id, 'member');
  db.prepare(`INSERT INTO messages (chat_type, sender_id, group_id, content) VALUES ('group', ?, ?, ?)`)
    .run(req.user.id, group.id, `${target.display_name} 加入了群聊`);

  res.json({ message: '已添加成员', user: target });
});

// Remove member from group
router.delete('/:id/members/:userId', authRequired, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '群聊不存在' });

  const myMembership = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(group.id, req.user.id);
  if (!myMembership) return res.status(403).json({ error: '你不是该群成员' });
  if (myMembership.role !== 'admin' && group.creator_id !== req.user.id) {
    return res.status(403).json({ error: '只有群主或管理员可以移除成员' });
  }

  const target = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(group.id, req.params.userId);
  if (!target) return res.status(404).json({ error: '该用户不在群聊中' });
  if (target.role === 'admin' && group.creator_id != req.user.id) {
    return res.status(403).json({ error: '只有群主可以移除管理员' });
  }

  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, req.params.userId);
  const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.params.userId);
  db.prepare(`INSERT INTO messages (chat_type, sender_id, group_id, content) VALUES ('group', ?, ?, ?)`)
    .run(req.user.id, group.id, `${user?.display_name || '用户'} 已被移出群聊`);

  res.json({ message: '已移除成员' });
});

// Leave group
router.post('/:id/leave', authRequired, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '群聊不存在' });
  if (group.creator_id === req.user.id) return res.status(400).json({ error: '群主不能退出群聊，请先转让或解散' });

  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, req.user.id);
  res.json({ message: '已退出群聊' });
});

module.exports = router;
