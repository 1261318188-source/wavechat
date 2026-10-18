const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'wavechat.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_color TEXT DEFAULT '#3390ec',
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'active',
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id),
    UNIQUE(sender_id, receiver_id)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    creator_id INTEGER NOT NULL,
    avatar_color TEXT DEFAULT '#3390ec',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_type TEXT NOT NULL,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER,
    group_id INTEGER,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_direct ON messages(chat_type, sender_id, receiver_id);
  CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
  CREATE INDEX IF NOT EXISTS idx_friend_requests ON friend_requests(sender_id, receiver_id, status);
`);

// Create default admin if not exists
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'WaveChatAdmin2026!';
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUsername);
if (!existingAdmin) {
  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(`INSERT INTO users (username, password_hash, display_name, avatar_color, role, status)
              VALUES (?, ?, ?, ?, 'admin', 'active')`).run(adminUsername, hash, '系统管理员', '#17212b');
  console.log(`[DB] Default admin created: ${adminUsername} / ${adminPassword}`);
}

// Create some demo users for testing (only if no users besides admin)
const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
if (userCount <= 1) {
  const demoUsers = [
    { username: 'alex', name: 'Alex Chen', color: '#4f91d8' },
    { username: 'kexin', name: '林可欣', color: '#e8798f' },
    { username: 'xiaoyu', name: '小宇', color: '#8e79d6' },
    { username: 'mia', name: 'Mia', color: '#e9a34d' },
  ];
  const insertUser = db.prepare(`INSERT INTO users (username, password_hash, display_name, avatar_color, role, status)
                                  VALUES (?, ?, ?, ?, 'user', 'active')`);
  const demoHash = bcrypt.hashSync('demo1234', 10);
  for (const u of demoUsers) {
    try { insertUser.run(u.username, demoHash, u.name, u.color); } catch(e) {}
  }
  console.log('[DB] Demo users created (password: demo1234)');
}

module.exports = db;
