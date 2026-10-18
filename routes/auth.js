const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateToken, authRequired } = require('../middleware/auth');

const router = express.Router();
const COLORS = ['#e8798f','#4f91d8','#8e79d6','#e9a34d','#36a89b','#6c9a74','#c16eb5','#c16f54'];

// Register
router.post('/register', (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: '用户名需为 3-24 位字母、数字或下划线' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existing) return res.status(409).json({ error: '用户名已被使用' });

  const hash = bcrypt.hashSync(password, 10);
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const name = display_name || username;
  const result = db.prepare(`INSERT INTO users (username, password_hash, display_name, avatar_color, role, status)
                              VALUES (?, ?, ?, ?, 'user', 'active')`).run(username.toLowerCase(), hash, name, color);
  const user = db.prepare('SELECT id, username, display_name, avatar_color, role, status FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = generateToken(user);
  res.json({ token, user });
});

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  if (user.status === 'banned') return res.status(403).json({ error: '账号已被封禁，请联系管理员' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const { password_hash, ...safeUser } = user;
  const token = generateToken(user);
  res.json({ token, user: safeUser });
});

// Get current user profile
router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

// Update profile
router.put('/me', authRequired, (req, res) => {
  const { display_name, avatar_color } = req.body;
  if (display_name && display_name.trim()) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name.trim(), req.user.id);
  }
  if (avatar_color) {
    db.prepare('UPDATE users SET avatar_color = ? WHERE id = ?').run(avatar_color, req.user.id);
  }
  const user = db.prepare('SELECT id, username, display_name, avatar_color, role, status FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

module.exports = router;
