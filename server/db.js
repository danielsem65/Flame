const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'chat.db');

const fs = require('fs');
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    displayName TEXT NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    status TEXT DEFAULT 'offline',
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    isGroup INTEGER DEFAULT 0,
    avatar TEXT DEFAULT '',
    createdBy TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    lastMessage TEXT DEFAULT '',
    lastMessageAt TEXT DEFAULT (datetime('now')),
    lastMessageSender TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversationId TEXT NOT NULL,
    userId TEXT NOT NULL,
    joinedAt TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (conversationId, userId),
    FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversationId TEXT NOT NULL,
    senderId TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    content TEXT DEFAULT '',
    replyTo TEXT DEFAULT '',
    reactions TEXT DEFAULT '{}',
    edited INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (senderId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message_status (
    messageId TEXT NOT NULL,
    userId TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    readAt TEXT,
    PRIMARY KEY (messageId, userId),
    FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversationId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_message_status_user ON message_status(userId, status);
  CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(userId);
`);

module.exports = db;
