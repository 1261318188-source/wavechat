require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const db = require('./db');
const { socketAuth } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

// Socket.io with CORS support
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/admin', require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'WaveChat', time: new Date().toISOString() });
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Catch-all for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ Socket.io Real-time ============
const onlineUsers = new Map(); // userId -> Set of socket ids

io.use(socketAuth);

io.on('connection', (socket) => {
  const userId = socket.user.id;

  // Track online users
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);
  socket.join(`user:${userId}`);

  // Join all group rooms the user belongs to
  const groups = db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(userId);
  groups.forEach(g => socket.join(`group:${g.group_id}`));

  // Broadcast online status to friends
  const friends = db.prepare(`
    SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as friend_id
    FROM friend_requests WHERE status = 'accepted' AND (sender_id = ? OR receiver_id = ?)
  `).all(userId, userId, userId);
  friends.forEach(f => {
    io.to(`user:${f.friend_id}`).emit('user_online', { userId, online: true });
  });

  // Send direct message
  socket.on('send_direct', ({ receiver_id, content }, callback) => {
    if (!receiver_id || !content || !content.trim()) {
      return callback?.({ error: '参数不完整' });
    }
    const receiver = db.prepare('SELECT id, status FROM users WHERE id = ?').get(receiver_id);
    if (!receiver) return callback?.({ error: '用户不存在' });
    if (receiver.status === 'banned') return callback?.({ error: '对方账号已被封禁' });

    const result = db.prepare(`INSERT INTO messages (chat_type, sender_id, receiver_id, content) VALUES ('direct', ?, ?, ?)`)
      .run(userId, receiver_id, content.trim());

    const message = db.prepare(`
      SELECT m.id, m.chat_type, m.sender_id, m.content, m.created_at,
             u.username, u.display_name, u.avatar_color
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
    `).get(result.lastInsertRowid);

    // Emit to receiver and sender (for multi-device sync)
    io.to(`user:${receiver_id}`).emit('new_direct_message', message);
    io.to(`user:${userId}`).emit('new_direct_message', message);

    callback?.({ message });
  });

  // Send group message
  socket.on('send_group', ({ group_id, content }, callback) => {
    if (!group_id || !content || !content.trim()) {
      return callback?.({ error: '参数不完整' });
    }
    const isMember = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(group_id, userId);
    if (!isMember) return callback?.({ error: '你不是该群成员' });

    const result = db.prepare(`INSERT INTO messages (chat_type, sender_id, group_id, content) VALUES ('group', ?, ?, ?)`)
      .run(userId, group_id, content.trim());

    const message = db.prepare(`
      SELECT m.id, m.chat_type, m.sender_id, m.group_id, m.content, m.created_at,
             u.username, u.display_name, u.avatar_color
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
    `).get(result.lastInsertRowid);

    io.to(`group:${group_id}`).emit('new_group_message', message);
    callback?.({ message });
  });

  // Typing indicator
  socket.on('typing', ({ chat_type, target_id }) => {
    if (chat_type === 'direct') {
      io.to(`user:${target_id}`).emit('user_typing', { userId, username: socket.user.display_name, chat_type, target_id });
    } else if (chat_type === 'group') {
      socket.to(`group:${target_id}`).emit('user_typing', { userId, username: socket.user.display_name, chat_type, target_id });
    }
  });

  // Friend request notification
  socket.on('friend_request', ({ receiver_id }) => {
    io.to(`user:${receiver_id}`).emit('friend_request_received', {
      from: { id: userId, username: socket.user.username, display_name: socket.user.display_name, avatar_color: socket.user.avatar_color }
    });
  });

  // Group invitation notification
  socket.on('group_invite', ({ group_id, user_ids }) => {
    user_ids?.forEach(uid => {
      io.to(`user:${uid}`).emit('group_invited', { group_id });
    });
  });

  // Join group room (when added to group)
  socket.on('join_group', ({ group_id }) => {
    socket.join(`group:${group_id}`);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
        friends.forEach(f => {
          io.to(`user:${f.friend_id}`).emit('user_online', { userId, online: false });
        });
      }
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  WaveChat server running on http://0.0.0.0:${PORT}`);
  console.log(`  Chat app:    http://localhost:${PORT}`);
  console.log(`  Admin panel: http://localhost:${PORT}/admin`);
  console.log(`  API health:  http://localhost:${PORT}/api/health\n`);
});

module.exports = { app, server, io };
