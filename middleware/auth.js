const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'wavechat-default-secret';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, display_name, avatar_color, role, status FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (user.status === 'banned') return res.status(403).json({ error: '账号已被封禁' });
    req.user = user;
    db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
  });
}

function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('未授权'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, display_name, avatar_color, role, status FROM users WHERE id = ?').get(decoded.id);
    if (!user) return next(new Error('用户不存在'));
    if (user.status === 'banned') return next(new Error('账号已被封禁'));
    socket.user = user;
    next();
  } catch (e) {
    next(new Error('Token 无效'));
  }
}

module.exports = { generateToken, authRequired, adminRequired, socketAuth, JWT_SECRET };
