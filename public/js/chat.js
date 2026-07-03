// ==================== LOAD / RENDER ====================
async function loadConversations() {
  try {
    const res = await fetch('/api/conversations/' + state.user.id);
    state.conversations = await res.json();
    renderConversations();
  } catch (e) { console.error(e); }
}

function renderConversations() {
  if (state.conversations.length === 0) {
    el.conversationsList.innerHTML = '<div class="loading-item"><i class="fas fa-comment-dots"></i> No conversations yet</div>';
    return;
  }
  el.conversationsList.innerHTML = state.conversations.map(c => {
    const isGroup = c.isGroup;
    const other = isGroup ? null : c.members.find(m => m.id !== state.user.id);
    const name = isGroup ? c.name : (other ? other.displayName : 'Unknown');
    const initials = isGroup ? getInitials(c.name) : (other ? getInitials(other.displayName) : '?');
    const avatarUrl = isGroup ? null : (other ? other.avatar : null);
    const status = isGroup ? '' : (other ? other.status : 'offline');
    const active = state.currentConv && state.currentConv.id === c.id;
    return `<div class="conv-item ${active ? 'active' : ''}" data-conv-id="${c.id}" onclick="selectConversation('${c.id}')">
      <div class="conv-avatar">
        <div class="avatar">${avatarUrl ? `<img src="${avatarUrl}">` : initials}</div>
        ${!isGroup ? `<span class="status-dot ${status}"></span>` : ''}
      </div>
      <div class="conv-info">
        <h4>${escapeHtml(name)}</h4>
        <p>${escapeHtml(c.lastMessage || 'No messages yet')}</p>
      </div>
      <div class="conv-meta">
        <div class="time">${c.lastMessageAt ? formatTime(c.lastMessageAt) : ''}</div>
        ${c.unread > 0 ? `<div class="unread-badge">${c.unread}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function updateConversationLastMessage(msg) {
  const conv = state.conversations.find(c => c.id === msg.conversationId);
  if (conv) {
    conv.lastMessage = msg.content.substring(0, 100);
    conv.lastMessageAt = msg.createdAt;
    conv.unread = (conv.unread || 0) + 1;
    renderConversations();
  }
}

async function selectConversation(convId) {
  const conv = state.conversations.find(c => c.id === convId);
  if (!conv) return;
  state.currentConv = conv;
  state.messages = [];
  state.typingUsers.clear();
  el.typingIndicator.classList.add('hidden');
  el.replyPreview.classList.add('hidden');
  state.replyTo = null;
  el.noChat.classList.add('hidden');
  el.chatView.classList.remove('hidden');

  const other = conv.members.find(m => m.id !== state.user.id);
  el.chatName.textContent = conv.isGroup ? conv.name : (other ? other.displayName : 'Unknown');
  if (!conv.isGroup && other) {
    el.chatStatus.textContent = other.status === 'online' ? 'Online' : 'Offline';
    el.chatStatus.className = 'typing-status';
  } else {
    el.chatStatus.textContent = conv.isGroup ? conv.members.length + ' members' : '';
  }
  const aname = conv.isGroup ? conv.name : (other ? other.displayName : '');
  const aurl = conv.isGroup ? null : (other ? other.avatar : null);
  el.chatAvatar.innerHTML = aurl ? `<img src="${aurl}">` : getInitials(aname);
  el.chatAvatar.style.background = aurl ? 'none' : '';

  el.messagesWrapper.innerHTML = '';
  el.messagesLoading.classList.remove('hidden');
  el.messagesContainer.scrollTop = 0;

  try {
    const res = await fetch(`/api/messages/${convId}/${state.user.id}`);
    const data = await res.json();
    state.messages = data.messages;
    el.messagesWrapper.innerHTML = '';
    if (state.messages.length === 0) {
      el.messagesWrapper.innerHTML = '<div class="msg-date-divider">Start of conversation</div>';
    } else {
      renderMessages(state.messages);
    }
    el.messagesLoading.classList.add('hidden');
    scrollToBottom();
    state.socket.emit('message:read', { conversationId: convId, userId: state.user.id });
    conv.unread = 0;
    renderConversations();
  } catch (e) { console.error(e); }

  if (window.innerWidth <= 768) {
    document.querySelector('.sidebar').classList.add('hidden-mobile');
  }
}

el.mobileBack.addEventListener('click', () => {
  document.querySelector('.sidebar').classList.remove('hidden-mobile');
  el.chatView.classList.add('hidden');
  el.noChat.classList.remove('hidden');
});

// ==================== MESSAGES ====================
function renderMessages(messages) {
  let lastDate = '';
  messages.forEach(msg => {
    const md = new Date(msg.createdAt).toLocaleDateString();
    if (md !== lastDate) {
      lastDate = md;
      const div = document.createElement('div');
      div.className = 'msg-date-divider';
      div.textContent = new Date(msg.createdAt).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
      el.messagesWrapper.appendChild(div);
    }
    addMessageToUI(msg);
  });
}

function addMessageToUI(msg) {
  const sent = msg.senderId === state.user.id;
  if (state.messages.every(m => m.id !== msg.id)) state.messages.push(msg);
  const div = document.createElement('div');
  div.className = 'message ' + (sent ? 'sent' : 'received');
  div.dataset.msgId = msg.id;
  div.dataset.senderId = msg.senderId;

  let contentHtml = '';
  if (msg.deleted) {
    contentHtml = '<span class="msg-text" style="font-style:italic;opacity:0.6;">This message was deleted</span>';
  } else if (msg.type === 'text') {
    contentHtml = `<span class="msg-text">${escapeHtml(msg.content)}</span>`;
  } else if (msg.type === 'image') {
    contentHtml = `<img class="msg-image" src="${msg.content}" onclick="window.open('${msg.content}')">`;
  } else if (msg.type === 'file') {
    const p = msg.content.split('|||');
    contentHtml = `<div class="msg-file" onclick="window.open('${p[0]}')">
      <i class="fas fa-file"></i>
      <div class="file-info"><span class="file-name">${escapeHtml(p[1] || 'File')}</span><span class="file-size">${p[2] || ''}</span></div>
    </div>`;
  } else if (msg.type === 'voice') {
    const p = msg.content.split('|||');
    contentHtml = `<div class="msg-voice">
      <button onclick="toggleVoice(this)"><i class="fas fa-play"></i></button>
      <div class="voice-wave"><span></span><span></span><span></span><span></span><span></span></div>
      <span class="voice-time">${p[1] || '0:05'}</span>
      <audio src="${p[0]}"></audio>
    </div>`;
  }

  let replyHtml = '';
  if (msg.replyTo) {
    replyHtml = `<div class="reply-attachment"><span class="reply-sender">Replying</span><span class="reply-content">${escapeHtml(msg.replyTo)}</span></div>`;
  }

  const reactions = JSON.parse(msg.reactions || '{}');
  const rkeys = Object.keys(reactions);

  const avatarUrl = msg.senderAvatar || null;
  const si = getInitials(msg.senderName || '?');

  div.innerHTML = `
    <div class="avatar">${avatarUrl ? `<img src="${avatarUrl}">` : si}</div>
    <div class="message-bubble" oncontextmenu="showContextMenu(event,'${msg.id}')">
      ${replyHtml}
      ${contentHtml}
      <div class="msg-meta">${msg.edited ? '<span class="edited">edited</span>' : ''}${formatTime(msg.createdAt)} ${sent ? '<i class="fas fa-check"></i>' : ''}</div>
      ${rkeys.length > 0 ? '<div class="msg-reactions">' + rkeys.map(k => reactions[k]).join(' ') + '</div>' : ''}
    </div>`;

  el.messagesWrapper.appendChild(div);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
  });
}

// ==================== SEND MESSAGE ====================
function getMessageContent() { return el.messageInput.textContent.trim(); }
function clearInput() { el.messageInput.textContent = ''; el.sendBtn.disabled = true; }

el.messageInput.addEventListener('input', () => {
  el.sendBtn.disabled = !getMessageContent();
  if (!state.currentConv) return;
  if (getMessageContent()) {
    state.socket.emit('typing:start', { conversationId: state.currentConv.id, userId: state.user.id, displayName: state.user.displayName });
    if (el.sendBtn._typingTimer) clearTimeout(el.sendBtn._typingTimer);
    el.sendBtn._typingTimer = setTimeout(() => {
      state.socket.emit('typing:stop', { conversationId: state.currentConv.id, userId: state.user.id });
    }, 2000);
  } else {
    state.socket.emit('typing:stop', { conversationId: state.currentConv.id, userId: state.user.id });
  }
});

el.messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage(type, content) {
  if (!state.currentConv) return;
  const text = content || getMessageContent();
  if (!text && type !== 'file' && type !== 'voice' && type !== 'image') return;
  state.socket.emit('message:send', {
    conversationId: state.currentConv.id,
    senderId: state.user.id,
    type: type || 'text',
    content: content || text,
    replyTo: state.replyTo || ''
  });
  clearInput();
  state.replyTo = null;
  el.replyPreview.classList.add('hidden');
  state.socket.emit('typing:stop', { conversationId: state.currentConv.id, userId: state.user.id });
}

el.sendBtn.addEventListener('click', () => sendMessage());

// ==================== REPLY ====================
function setReply(messageId, content) {
  state.replyTo = content;
  el.replyPreview.classList.remove('hidden');
  el.replyLabel.textContent = 'Replying';
  el.replyContent.textContent = content;
  el.messageInput.focus();
}

el.replyClose.addEventListener('click', () => {
  state.replyTo = null;
  el.replyPreview.classList.add('hidden');
});

// ==================== CONTEXT MENU ====================
function showContextMenu(e, msgId) {
  e.preventDefault();
  state.contextMsgId = msgId;
  el.contextMenu.classList.remove('hidden');
  el.contextMenu.style.left = e.pageX + 'px';
  el.contextMenu.style.top = e.pageY + 'px';
  const msg = state.messages.find(m => m.id === msgId);
  const isMine = msg && msg.senderId === state.user.id;
  el.contextMenu.querySelector('[data-action="edit"]').style.display = isMine ? 'flex' : 'none';
  el.contextMenu.querySelector('[data-action="delete"]').style.display = isMine ? 'flex' : 'none';
}

document.addEventListener('click', () => el.contextMenu.classList.add('hidden'));

el.contextMenu.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    const msg = state.messages.find(m => m.id === state.contextMsgId);
    if (!msg) return;
    if (action === 'reply') setReply(msg.id, msg.content);
    else if (action === 'edit') editMessage(msg.id, msg.content);
    else if (action === 'copy') { navigator.clipboard.writeText(msg.content); showToast('Copied!', 'success'); }
    else if (action === 'delete') deleteMessage(msg.id);
    el.contextMenu.classList.add('hidden');
  });
});

function deleteMessage(msgId) {
  if (!confirm('Delete this message?')) return;
  state.socket.emit('message:delete', { messageId: msgId, conversationId: state.currentConv.id });
}

function editMessage(msgId, current) {
  const nc = prompt('Edit message:', current);
  if (nc && nc !== current) {
    state.socket.emit('message:edit', { messageId: msgId, content: nc, conversationId: state.currentConv.id });
  }
}

function renderReactions(el, reactions) {
  const keys = Object.keys(reactions);
  const existing = el.querySelector('.msg-reactions');
  if (existing) existing.remove();
  if (keys.length > 0) {
    const div = document.createElement('div');
    div.className = 'msg-reactions';
    div.textContent = keys.map(k => reactions[k]).join(' ');
    el.appendChild(div);
  }
}

el.contextMenu.querySelectorAll('.context-reactions span').forEach(span => {
  span.addEventListener('click', () => {
    state.socket.emit('message:reaction', {
      messageId: state.contextMsgId, userId: state.user.id,
      reaction: span.dataset.reaction, conversationId: state.currentConv.id
    });
    el.contextMenu.classList.add('hidden');
  });
});

// ==================== EMOJI ====================
const EMOJIS = {
  smileys: '😀😃😄😁😅😂🤣😊😇🙂😉😌😍🥰😘😗😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🥴😵🤯🤠🥳🥺😢😭😤😡🤬💀☠️💩🤡👹👺👻👽👾🤖'.split(''),
  people: '👍👎👊✊🤛🤜👏🙌👐🤲🤝🙏✌️🤞🤟🤘👌👈👉👆👇☝️✋🤚🖐🖖👋🤙💪🦵🦶👂🦻👃🧠🦷🦴👀👁👅👄💋👶🧒👦👧🧑👨👩🧔👴👵🙍🙎🙅🙆💁🙋🙇🤦🤷💑💏👪'.split(''),
  animals: '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🐤🐣🐥🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🦟🦗🕷🦂🐢🐍🦎🦖🦕🐙🦑🦐🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🐘🦛🦏🐪🐫🦒🦘🐃🐂🐄🐎🐖🐏🐑🦙🐐🦌🐕🐩🦮🐕‍🦺🐈🐓🦃🦚🦜🦢🦩🐇🦝'.split(''),
  food: '🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶🌽🥕🧄🧅🥔🍠🥐🍞🥖🥨🧀🥚🍳🥞🧇🥓🥩🍗🍖🌭🍔🍟🍕🥪🥙🧆🌮🌯🥗🥘🍝🍜🍲🍛🍣🍱🥟🦪🍤🍙🍚🍘🍥🥠🥮🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛☕️🍵🧃🥤🍶🍺🍻🥂🍷🥃🍸🍹🧉🍾🧊'.split(''),
  travel: '🚗🚕🚙🚌🚎🏎🚓🚑🚒🚐🛴🚲🛵🏍🛺🚨🚔🚍🚘🚖🚡🚠🚟🚃🚋🚞🚝🚄🚅🚈🚂✈️🛩🛫🛬🚁🚀🛸⛵️🛥🚢🛳⚓️🏠🏡🏘🏚🏗🏢🏭🏣🏤🏥🏦🏨🏩🏪🏫🏬🏯🏰💒🗼🗽⛲️⛰🏔🌋🗻🏕🏖🏜🏝🏟🎡🎢🎠'.split(''),
  objects: '⌚️📱💻⌨️🖥🖨🖱🖲🕹🗜💽💾💿📀📼📷📸📹🎥📽🎞📞☎️📟📠📺📻🎙🎚🎛🧭⏱⏲⏰🕰📡🔋🔌💡🔦🕯🗑🛢💸💵💴💶💷💰💳🧾✉️📧📨📩📤📥📦📫📪📬📭📮📝📃📜📄📑🔖🏷✂️📎🖇📌📍📐📏🧮🔍🔎🔏🔐🔒🔓'.split(''),
  symbols: '❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟☮️✝️☪️🕉☸️✡️🔯🕎☯️☦️🛐⛎♈️♉️♊️♋️♌️♍️♎️♏️♐️♑️♒️♓️🆔⚛️🉑☢️☣️📴📳🈶🈚️🈸🈺🈷️✴️🆚💮🉐㊙️㊗️🈴🈵🈲🅰️🅱️🆎🆑🅾️🆘❌⭕️🛑⛔️📛🚫💯💢♨️🚷🚯🚳🚱🔞📵🚭❗️❕❓❔‼️⁉️🔅🔆〽️⚠️🚸🔱⚜️🔰♻️✅🈯️💹❇️✳️❎🌐💠Ⓜ️🌀🌈🏳️🏴🏁🚩🎌🏴‍☠️🇺🇳🇺🇸🇬🇧🇨🇦🇦🇺🇯🇵🇨🇳🇰🇷🇩🇪🇫🇷🇪🇸🇮🇹🇷🇺🇧🇷🇮🇳🇦🇪🇿🇦'.split('')
};

let currentEmojiCat = 'smileys';

function renderEmojis(cat) {
  currentEmojiCat = cat;
  el.emojiGrid.innerHTML = EMOJIS[cat].map(e => `<span>${e}</span>`).join('');
  el.emojiGrid.querySelectorAll('span').forEach(s => {
    s.addEventListener('click', () => {
      el.messageInput.focus();
      document.execCommand('insertText', false, s.textContent);
      el.sendBtn.disabled = false;
    });
  });
  document.querySelectorAll('.emoji-cat').forEach(c => c.classList.toggle('active', c.dataset.cat === cat));
}

renderEmojis('smileys');

document.querySelectorAll('.emoji-cat').forEach(btn => {
  btn.addEventListener('click', () => renderEmojis(btn.dataset.cat));
});

el.emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  state.emojiOpen = !state.emojiOpen;
  el.emojiPicker.classList.toggle('hidden', !state.emojiOpen);
});

document.addEventListener('click', (e) => {
  if (!el.emojiPicker.contains(e.target) && e.target !== el.emojiBtn) {
    el.emojiPicker.classList.add('hidden');
    state.emojiOpen = false;
  }
});

// ==================== FILE ====================
el.attachBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*,.pdf,.doc,.docx,.zip,.txt';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return showToast('File too large (max 50MB)', 'error');
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (file.type.startsWith('image/')) {
      sendMessage('image', data.url);
    } else {
      sendMessage('file', data.url + '|||' + file.name + '|||' + formatFileSize(file.size));
    }
  };
  input.click();
});

// ==================== VOICE ====================
el.voiceBtn.addEventListener('click', async () => {
  if (state.recording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaRecorder = new MediaRecorder(stream);
    state.audioChunks = [];
    state.recording = true;
    state.recordingSeconds = 0;
    el.recordingIndicator.classList.remove('hidden');
    el.voiceBtn.innerHTML = '<i class="fas fa-stop"></i>';
    state.mediaRecorder.ondataavailable = (e) => state.audioChunks.push(e.data);
    state.mediaRecorder.onstop = () => stream.getTracks().forEach(t => t.stop());
    state.mediaRecorder.start();
    state.recordingTimer = setInterval(() => {
      state.recordingSeconds++;
      const m = Math.floor(state.recordingSeconds / 60);
      const s = state.recordingSeconds % 60;
      el.recordingTime.textContent = m + ':' + s.toString().padStart(2, '0');
    }, 1000);
  } catch (e) { showToast('Microphone access denied', 'error'); }
});

el.recordingCancel.addEventListener('click', () => {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') state.mediaRecorder.stop();
  stopRecording();
});

el.recordingSend.addEventListener('click', async () => {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
    await new Promise(r => state.mediaRecorder.onstop = r);
    const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('file', blob, 'voice.webm');
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    const dur = Math.floor(state.recordingSeconds / 60) + ':' + (state.recordingSeconds % 60).toString().padStart(2, '0');
    sendMessage('voice', data.url + '|||' + dur);
  }
  stopRecording();
});

function stopRecording() {
  state.recording = false;
  el.recordingIndicator.classList.add('hidden');
  el.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
  if (state.recordingTimer) { clearInterval(state.recordingTimer); state.recordingTimer = null; }
}

// ==================== TYPING ====================
function updateTypingIndicator() {
  if (state.typingUsers.size === 0) { el.typingIndicator.classList.add('hidden'); return; }
  el.typingIndicator.classList.remove('hidden');
  const names = Array.from(state.typingUsers.values());
  el.typingText.textContent = names.length === 1 ? names[0] + ' is typing...' : names.join(', ') + ' are typing...';
}

function updateUserStatus(userId, status) {
  document.querySelectorAll(`[data-user-id="${userId}"] .status-dot`).forEach(d => d.className = 'status-dot ' + status);
  document.querySelectorAll(`[data-user-id="${userId}"] .status-text`).forEach(t => t.textContent = status === 'online' ? 'Online' : 'Offline');
  if (state.currentConv && !state.currentConv.isGroup) {
    const other = state.currentConv.members.find(m => m.id !== state.user.id);
    if (other && other.id === userId) {
      el.chatStatus.textContent = status === 'online' ? 'Online' : 'Offline';
      el.chatStatus.className = 'typing-status';
    }
  }
}

// ==================== SEARCH ====================
el.searchInput.addEventListener('input', debounce(async function() {
  const q = this.value.trim();
  if (!q) return loadConversations();
  try {
    const res = await fetch(`/api/users/${state.user.id}/search/${encodeURIComponent(q)}`);
    const users = await res.json();
    el.conversationsList.innerHTML = users.map(u => `
      <div class="conv-item" onclick="startDirectChat('${u.id}')">
        <div class="conv-avatar"><div class="avatar">${u.avatar ? `<img src="${u.avatar}">` : getInitials(u.displayName)}</div></div>
        <div class="conv-info"><h4>${escapeHtml(u.displayName)}</h4><p>@${escapeHtml(u.username)}</p></div>
      </div>
    `).join('');
  } catch (e) {}
}, 300));

async function startDirectChat(userId) {
  el.searchInput.value = '';
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isGroup: false, members: [userId], createdBy: state.user.id })
    });
    const data = await res.json();
    if (!data.existing) {
      state.socket.emit('conversation:join', { conversationId: data.id, userId: state.user.id });
      state.socket.emit('conversation:join', { conversationId: data.id, userId });
    }
    await loadConversations();
    selectConversation(data.id);
  } catch (e) { showToast('Error starting chat', 'error'); }
}

// ==================== CHAT SEARCH ====================
el.chatSearchBtn.addEventListener('click', () => {
  el.chatSearchBar.classList.toggle('hidden');
  if (!el.chatSearchBar.classList.contains('hidden')) el.chatSearchInput.focus();
});

el.chatSearchClose.addEventListener('click', () => {
  el.chatSearchBar.classList.add('hidden');
  el.chatSearchInput.value = '';
  document.querySelectorAll('.message').forEach(m => m.style.background = '');
});

el.chatSearchInput.addEventListener('input', debounce(function() {
  const q = this.value.trim().toLowerCase();
  if (!q) {
    state.searchResults = []; state.searchIndex = -1;
    el.searchResultsCount.textContent = '0 results';
    document.querySelectorAll('.message').forEach(m => m.style.background = '');
    return;
  }
  state.searchResults = state.messages.filter(m => !m.deleted && m.content.toLowerCase().includes(q));
  state.searchIndex = -1;
  el.searchResultsCount.textContent = state.searchResults.length + ' results';
  document.querySelectorAll('.message').forEach(m => m.style.background = '');
  if (state.searchResults.length > 0) navigateSearch(1);
}, 300));

el.searchPrev.addEventListener('click', () => navigateSearch(-1));
el.searchNext.addEventListener('click', () => navigateSearch(1));

function navigateSearch(dir) {
  if (state.searchResults.length === 0) return;
  document.querySelectorAll('.message').forEach(m => m.style.background = '');
  state.searchIndex = (state.searchIndex + dir + state.searchResults.length) % state.searchResults.length;
  const msgId = state.searchResults[state.searchIndex].id;
  const e = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (e) {
    e.style.background = 'rgba(108,99,255,0.1)';
    e.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  el.searchResultsCount.textContent = `${state.searchIndex + 1} of ${state.searchResults.length} results`;
}

// ==================== NOTIFICATIONS ====================
function playNotification() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 600;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

// ==================== GLOBALS ====================
window.selectConversation = selectConversation;
window.startDirectChat = startDirectChat;
window.showContextMenu = showContextMenu;
window.toggleVoice = function(btn) {
  const audio = btn.parentElement.querySelector('audio');
  const icon = btn.querySelector('i');
  if (audio.paused) {
    audio.play();
    icon.className = 'fas fa-pause';
    audio.onended = () => { icon.className = 'fas fa-play'; };
  } else {
    audio.pause();
    audio.currentTime = 0;
    icon.className = 'fas fa-play';
  }
};
