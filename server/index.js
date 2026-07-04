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
    res.json({ id, username, displayName, avatar: '', bio: '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'All fields required' });
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, bio: user.bio });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me/:id', (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, displayName, avatar, bio FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
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

// ==================== SOCIAL ====================
// --- POSTS ---
app.post('/api/posts', (req, res) => {
  const { userId, content, image } = req.body;
  try {
    const id = uuidv4();
    db.prepare('INSERT INTO posts (id, userId, content, image) VALUES (?,?,?,?)').run(id, userId, content || '', image || '');
    const post = db.prepare('SELECT p.*, u.displayName, u.avatar FROM posts p JOIN users u ON p.userId = u.id WHERE p.id = ?').get(id);
    res.json(post);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/posts/feed/:userId', (req, res) => {
  try {
    const posts = db.prepare(`
      SELECT p.*, u.displayName, u.avatar,
        (SELECT COUNT(*) FROM likes WHERE targetId = p.id AND targetType = 'post') as likeCount,
        (SELECT COUNT(*) FROM comments WHERE targetId = p.id AND targetType = 'post') as commentCount,
        (SELECT COUNT(*) FROM likes WHERE targetId = p.id AND targetType = 'post' AND userId = ?) as liked
      FROM posts p JOIN users u ON p.userId = u.id
      ORDER BY p.createdAt DESC LIMIT 50
    `).all(req.params.userId);
    res.json(posts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/posts/:id/:userId', (req, res) => {
  try {
    db.prepare('DELETE FROM posts WHERE id = ? AND userId = ?').run(req.params.id, req.params.userId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- REELS ---
app.post('/api/reels', (req, res) => {
  const { userId, video, caption } = req.body;
  try {
    const id = uuidv4();
    db.prepare('INSERT INTO reels (id, userId, video, caption) VALUES (?,?,?,?)').run(id, userId, video, caption || '');
    const reel = db.prepare('SELECT r.*, u.displayName, u.avatar FROM reels r JOIN users u ON r.userId = u.id WHERE r.id = ?').get(id);
    res.json(reel);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reels/:userId', (req, res) => {
  try {
    const reels = db.prepare(`
      SELECT r.*, u.displayName, u.avatar,
        (SELECT COUNT(*) FROM likes WHERE targetId = r.id AND targetType = 'reel') as likeCount,
        (SELECT COUNT(*) FROM comments WHERE targetId = r.id AND targetType = 'reel') as commentCount,
        (SELECT COUNT(*) FROM likes WHERE targetId = r.id AND targetType = 'reel' AND userId = ?) as liked
      FROM reels r JOIN users u ON r.userId = u.id
      ORDER BY r.createdAt DESC LIMIT 50
    `).all(req.params.userId);
    res.json(reels);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- STORIES ---
app.post('/api/stories', (req, res) => {
  const { userId, media, type } = req.body;
  try {
    db.prepare("DELETE FROM stories WHERE userId = ?").run(userId);
    const id = uuidv4();
    db.prepare('INSERT INTO stories (id, userId, media, type) VALUES (?,?,?,?)').run(id, userId, media, type || 'image');
    const story = db.prepare('SELECT s.*, u.displayName, u.avatar FROM stories s JOIN users u ON s.userId = u.id WHERE s.id = ?').get(id);
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stories', (req, res) => {
  try {
    const stories = db.prepare(`
      SELECT s.*, u.displayName, u.avatar FROM stories s JOIN users u ON s.userId = u.id
      WHERE s.expiresAt > datetime('now') ORDER BY s.createdAt DESC
    `).all();
    const grouped = {};
    stories.forEach(s => {
      if (!grouped[s.userId]) grouped[s.userId] = { user: { id: s.userId, displayName: s.displayName, avatar: s.avatar }, stories: [] };
      grouped[s.userId].stories.push(s);
    });
    res.json(Object.values(grouped));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- LIKES ---
app.post('/api/like', (req, res) => {
  const { targetId, targetType, userId } = req.body;
  try {
    const existing = db.prepare('SELECT id FROM likes WHERE targetId = ? AND targetType = ? AND userId = ?').get(targetId, targetType, userId);
    if (existing) {
      db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
      res.json({ liked: false });
    } else {
      const id = uuidv4();
      db.prepare('INSERT INTO likes (id, targetId, targetType, userId) VALUES (?,?,?,?)').run(id, targetId, targetType, userId);
      const target = db.prepare(`SELECT userId FROM ${targetType === 'post' ? 'posts' : 'reels'} WHERE id = ?`).get(targetId);
      if (target && target.userId !== userId) {
        const nid = uuidv4();
        db.prepare('INSERT INTO notifications (id, userId, fromUserId, type, referenceId) VALUES (?,?,?,?,?)').run(nid, target.userId, userId, 'like', targetId);
      }
      res.json({ liked: true });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- COMMENTS ---
app.post('/api/comments', (req, res) => {
  const { targetId, targetType, userId, content } = req.body;
  try {
    const id = uuidv4();
    db.prepare('INSERT INTO comments (id, targetId, targetType, userId, content) VALUES (?,?,?,?,?)').run(id, targetId, targetType, userId, content);
    const comment = db.prepare('SELECT c.*, u.displayName, u.avatar FROM comments c JOIN users u ON c.userId = u.id WHERE c.id = ?').get(id);
    const target = db.prepare(`SELECT userId FROM ${targetType === 'post' ? 'posts' : 'reels'} WHERE id = ?`).get(targetId);
    if (target && target.userId !== userId) {
      const nid = uuidv4();
      db.prepare('INSERT INTO notifications (id, userId, fromUserId, type, referenceId) VALUES (?,?,?,?,?)').run(nid, target.userId, userId, 'comment', targetId);
    }
    res.json(comment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/comments/:targetId/:targetType', (req, res) => {
  try {
    const comments = db.prepare(`
      SELECT c.*, u.displayName, u.avatar FROM comments c JOIN users u ON c.userId = u.id
      WHERE c.targetId = ? AND c.targetType = ? ORDER BY c.createdAt ASC
    `).all(req.params.targetId, req.params.targetType);
    res.json(comments);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- FOLLOW ---
app.post('/api/follow', (req, res) => {
  const { followerId, followingId } = req.body;
  try {
    const existing = db.prepare('SELECT * FROM follows WHERE followerId = ? AND followingId = ?').get(followerId, followingId);
    if (existing) {
      db.prepare('DELETE FROM follows WHERE followerId = ? AND followingId = ?').run(followerId, followingId);
      res.json({ following: false });
    } else {
      db.prepare('INSERT INTO follows (followerId, followingId) VALUES (?,?)').run(followerId, followingId);
      const nid = uuidv4();
      db.prepare('INSERT INTO notifications (id, userId, fromUserId, type, referenceId) VALUES (?,?,?,?,?)').run(nid, followingId, followerId, 'follow', '');
      res.json({ following: true });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- PROFILE ---
app.get('/api/profile/:id/:viewerId', (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, displayName, avatar, bio, createdAt FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const postCount = db.prepare('SELECT COUNT(*) as c FROM posts WHERE userId = ?').get(req.params.id).c;
    const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE followingId = ?').get(req.params.id).c;
    const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE followerId = ?').get(req.params.id).c;
    const isFollowing = db.prepare('SELECT * FROM follows WHERE followerId = ? AND followingId = ?').get(req.params.viewerId, req.params.id);
    const posts = db.prepare('SELECT * FROM posts WHERE userId = ? ORDER BY createdAt DESC LIMIT 20').all(req.params.id);
    res.json({ ...user, postCount, followerCount, followingCount, isFollowing: !!isFollowing, posts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id/profile', (req, res) => {
  const { displayName, bio } = req.body;
  try {
    if (displayName) db.prepare('UPDATE users SET displayName = ? WHERE id = ?').run(displayName, req.params.id);
    if (bio !== undefined) db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- NOTIFICATIONS ---
app.get('/api/notifications/:userId', (req, res) => {
  try {
    const notifs = db.prepare(`
      SELECT n.*, u.displayName, u.avatar FROM notifications n JOIN users u ON n.fromUserId = u.id
      WHERE n.userId = ? ORDER BY n.createdAt DESC LIMIT 50
    `).all(req.params.userId);
    const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE userId = ? AND read = 0').get(req.params.userId);
    res.json({ notifications: notifs, unread: unread.c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notifications/read', (req, res) => {
  const { userId } = req.body;
  try {
    db.prepare('UPDATE notifications SET read = 1 WHERE userId = ?').run(userId);
    res.json({ success: true });
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

  // Video call signaling
  socket.on('video:offer', ({ conversationId, offer }) => {
    socket.to(conversationId).emit('video:offer', { offer, from: currentUserId });
  });

  socket.on('video:answer', ({ conversationId, answer }) => {
    socket.to(conversationId).emit('video:answer', { answer, from: currentUserId });
  });

  socket.on('video:ice-candidate', ({ conversationId, candidate }) => {
    socket.to(conversationId).emit('video:ice-candidate', { candidate, from: currentUserId });
  });

  socket.on('video:ring', ({ conversationId, callerName, callerAvatar }) => {
    socket.to(conversationId).emit('video:ring', { conversationId, from: currentUserId, callerName, callerAvatar });
  });

  socket.on('video:accept', ({ conversationId }) => {
    socket.to(conversationId).emit('video:accept', { conversationId, from: currentUserId });
  });

  socket.on('video:decline', ({ conversationId }) => {
    socket.to(conversationId).emit('video:decline', { conversationId, from: currentUserId });
  });

  socket.on('video:end', ({ conversationId }) => {
    socket.to(conversationId).emit('video:end', { conversationId });
  });

  socket.on('video:user-left', ({ conversationId }) => {
    socket.to(conversationId).emit('video:user-left', { conversationId });
  });

  socket.on('notification:new', ({ userId, notification }) => {
    io.to('user:' + userId).emit('notification:new', notification);
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
