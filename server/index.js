const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e8
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ==================== AUTH ====================
app.post('/api/register', (req, res) => {
  const { username, displayName, password } = req.body;
  if (!username || !displayName || !password) return res.status(400).json({ error: 'All fields required' });
  try {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(400).json({ error: 'Username taken' });
    const id = uuidv4();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, username, displayName, password) VALUES (?,?,?,?)').run(id, username, displayName, hash);
    res.json({ id, username, displayName, avatar: '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'All fields required' });
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
});

app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = '/uploads/' + req.file.filename;
  const { userId } = req.body;
  if (userId) db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(url, userId);
  res.json({ url });
});

// ==================== CONVERSATIONS ====================
app.get('/api/conversations/:userId', (req, res) => {
  const { userId } = req.params;
  try {
    const convs = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM message_status ms JOIN messages m ON ms.messageId = m.id 
         WHERE m.conversationId = c.id AND ms.userId = ? AND ms.status != 'read') as unread
      FROM conversations c
      JOIN conversation_members cm ON c.id = cm.conversationId
      WHERE cm.userId = ?
      ORDER BY c.lastMessageAt DESC
    `).all(userId, userId);

    const result = convs.map(c => {
      const members = db.prepare(`
        SELECT u.id, u.username, u.displayName, u.avatar, u.status
        FROM users u JOIN conversation_members cm ON u.id = cm.userId
        WHERE cm.conversationId = ?
      `).all(c.id);
      return { ...c, members, unread: c.unread || 0 };
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/conversations', (req, res) => {
  const { name, isGroup, members, createdBy } = req.body;
  try {
    if (!isGroup) {
      const existing = db.prepare(`
        SELECT c.id FROM conversations c
        JOIN conversation_members cm1 ON c.id = cm1.conversationId AND cm1.userId = ?
        JOIN conversation_members cm2 ON c.id = cm2.conversationId AND cm2.userId = ?
        WHERE c.isGroup = 0
      `).get(createdBy, members[0]);
      if (existing) return res.json({ id: existing.id, existing: true });
    }
    const id = uuidv4();
    const allMembers = isGroup ? [createdBy, ...members] : [createdBy, members[0]];
    db.prepare('INSERT INTO conversations (id, name, isGroup, createdBy) VALUES (?,?,?,?)').run(id, name || '', isGroup ? 1 : 0, createdBy);
    const insert = db.prepare('INSERT OR IGNORE INTO conversation_members (conversationId, userId) VALUES (?,?)');
    for (const m of allMembers) insert.run(id, m);
    res.json({ id, existing: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:userId/search/:query', (req, res) => {
  const { userId, query } = req.params;
  try {
    const users = db.prepare(
      `SELECT id, username, displayName, avatar, status FROM users WHERE id != ? AND (username LIKE ? OR displayName LIKE ?) LIMIT 20`
    ).all(userId, `%${query}%`, `%${query}%`);
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:userId', (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, displayName, avatar, status FROM users WHERE id != ? ORDER BY displayName').all(req.params.userId);
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id/profile', (req, res) => {
  const { displayName } = req.body;
  try {
    db.prepare('UPDATE users SET displayName = ? WHERE id = ?').run(displayName, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MESSAGES ====================
app.get('/api/messages/:conversationId/:userId', (req, res) => {
  const { conversationId, userId } = req.params;
  const offset = parseInt(req.query.offset) || 0;
  const limit = 50;
  try {
    db.prepare(`UPDATE message_status SET status = 'read', readAt = datetime('now') 
      WHERE messageId IN (SELECT id FROM messages WHERE conversationId = ?) AND userId = ? AND status != 'read'`)
      .run(conversationId, userId);

    const messages = db.prepare(`
      SELECT m.*, u.displayName as senderName, u.avatar as senderAvatar
      FROM messages m JOIN users u ON m.senderId = u.id
      WHERE m.conversationId = ? AND m.deleted = 0
      ORDER BY m.createdAt DESC LIMIT ? OFFSET ?
    `).all(conversationId, limit, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversationId = ? AND deleted = 0').get(conversationId);
    res.json({ messages: messages.reverse(), total: total.count, hasMore: offset + limit < total.count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages', (req, res) => {
  const { conversationId, senderId, type, content, replyTo } = req.body;
  try {
    const id = uuidv4();
    db.prepare('INSERT INTO messages (id, conversationId, senderId, type, content, replyTo) VALUES (?,?,?,?,?,?)')
      .run(id, conversationId, senderId, type || 'text', content, replyTo || '');

    db.prepare('UPDATE conversations SET lastMessage = ?, lastMessageAt = datetime(\'now\'), lastMessageSender = ? WHERE id = ?')
      .run(content.substring(0, 100), senderId, conversationId);
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/messages/:id', (req, res) => {
  try {
    db.prepare("UPDATE messages SET deleted = 1, content = 'This message was deleted' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/messages/:id', (req, res) => {
  const { content } = req.body;
  try {
    db.prepare('UPDATE messages SET content = ?, edited = 1 WHERE id = ?').run(content, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages/:id/reaction', (req, res) => {
  const { userId, reaction } = req.body;
  try {
    const msg = db.prepare('SELECT reactions FROM messages WHERE id = ?').get(req.params.id);
    const reactions = JSON.parse(msg.reactions || '{}');
    if (reactions[userId] === reaction) delete reactions[userId];
    else reactions[userId] = reaction;
    db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(JSON.stringify(reactions), req.params.id);
    res.json({ reactions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== SOCKET.IO ====================
const onlineUsers = new Map();

io.on('connection', (socket) => {
  let currentUserId = null;

  socket.on('user:online', (userId) => {
    currentUserId = userId;
    onlineUsers.set(userId, socket.id);
    db.prepare("UPDATE users SET status = 'online' WHERE id = ?").run(userId);

    const convs = db.prepare('SELECT conversationId FROM conversation_members WHERE userId = ?').all(userId);
    const rooms = convs.map(c => c.conversationId);
    rooms.forEach(r => socket.join(r));
    socket.join('user:' + userId);

    io.emit('user:status', { userId, status: 'online' });
  });

  socket.on('message:send', (data) => {
    const id = uuidv4();
    const { conversationId, senderId, type, content, replyTo } = data;

    db.prepare('INSERT INTO messages (id, conversationId, senderId, type, content, replyTo) VALUES (?,?,?,?,?,?)')
      .run(id, conversationId, senderId, type || 'text', content, replyTo || '');

    db.prepare("UPDATE conversations SET lastMessage = ?, lastMessageAt = datetime('now'), lastMessageSender = ? WHERE id = ?")
      .run(content.substring(0, 100), senderId, conversationId);

    const msg = db.prepare(`
      SELECT m.*, u.displayName as senderName, u.avatar as senderAvatar
      FROM messages m JOIN users u ON m.senderId = u.id WHERE m.id = ?
    `).get(id);

    const members = db.prepare('SELECT userId FROM conversation_members WHERE conversationId = ? AND userId != ?').all(conversationId, senderId);

    for (const m of members) {
      db.prepare('INSERT OR IGNORE INTO message_status (messageId, userId, status) VALUES (?,?,?)').run(id, m.userId, 'sent');
    }
    msg.status = 'sent';

    io.to(conversationId).emit('message:new', msg);
  });

  socket.on('message:read', ({ conversationId, userId }) => {
    db.prepare(`UPDATE message_status SET status = 'read', readAt = datetime('now') 
      WHERE messageId IN (SELECT id FROM messages WHERE conversationId = ?) AND userId = ? AND status != 'read'`)
      .run(conversationId, userId);
    io.to(conversationId).emit('messages:read', { conversationId, userId });
  });

  socket.on('message:delete', ({ messageId, conversationId }) => {
    db.prepare("UPDATE messages SET deleted = 1, content = 'This message was deleted' WHERE id = ?").run(messageId);
    io.to(conversationId).emit('message:deleted', { messageId, conversationId });
  });

  socket.on('message:edit', ({ messageId, content, conversationId }) => {
    db.prepare('UPDATE messages SET content = ?, edited = 1 WHERE id = ?').run(content, messageId);
    io.to(conversationId).emit('message:edited', { messageId, content, conversationId });
  });

  socket.on('message:reaction', ({ messageId, userId, reaction, conversationId }) => {
    const msg = db.prepare('SELECT reactions FROM messages WHERE id = ?').get(messageId);
    const reactions = JSON.parse(msg.reactions || '{}');
    if (reactions[userId] === reaction) delete reactions[userId];
    else reactions[userId] = reaction;
    db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(JSON.stringify(reactions), messageId);
    io.to(conversationId).emit('message:reacted', { messageId, reactions, userId, conversationId });
  });

  socket.on('typing:start', ({ conversationId, userId, displayName }) => {
    socket.to(conversationId).emit('typing:start', { conversationId, userId, displayName });
  });

  socket.on('typing:stop', ({ conversationId, userId }) => {
    socket.to(conversationId).emit('typing:stop', { conversationId, userId });
  });

  socket.on('conversation:join', ({ conversationId, userId }) => {
    socket.join(conversationId);
    db.prepare('INSERT OR IGNORE INTO conversation_members (conversationId, userId) VALUES (?,?)').run(conversationId, userId);
  });

  socket.on('disconnect', () => {
    if (currentUserId) {
      onlineUsers.delete(currentUserId);
      db.prepare("UPDATE users SET status = 'offline' WHERE id = ?").run(currentUserId);
      io.emit('user:status', { userId: currentUserId, status: 'offline', lastSeen: new Date().toISOString() });
    }
  });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Flame running on http://localhost:${PORT}`);
  console.log(`Also accessible at http://127.0.0.1:${PORT}`);
});
