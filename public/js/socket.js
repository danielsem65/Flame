function connectSocket() {
  state.socket = io();
  state.socket.emit('user:online', state.user.id);

  state.socket.on('message:new', (msg) => {
    if (state.currentConv && msg.conversationId === state.currentConv.id) {
      addMessageToUI(msg);
      scrollToBottom();
    }
    updateConversationLastMessage(msg);
    playNotification();
  });

  state.socket.on('message:deleted', ({ messageId, conversationId }) => {
    const e = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (e) e.querySelector('.msg-text').textContent = 'This message was deleted';
  });

  state.socket.on('message:edited', ({ messageId, content }) => {
    const e = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (e) {
      e.querySelector('.msg-text').textContent = content;
      if (!e.querySelector('.edited')) {
        const meta = e.querySelector('.msg-meta');
        const span = document.createElement('span');
        span.className = 'edited';
        span.textContent = 'edited';
        meta.prepend(span);
      }
    }
  });

  state.socket.on('message:reacted', ({ messageId, reactions }) => {
    const e = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (e) renderReactions(e, reactions);
  });

  state.socket.on('messages:read', ({ conversationId }) => {
    if (state.currentConv && state.currentConv.id === conversationId) {
      document.querySelectorAll('.message.sent .msg-meta .fa-check-double')
        .forEach(i => i.style.color = 'var(--success)');
    }
  });

  state.socket.on('typing:start', ({ conversationId, userId, displayName }) => {
    if (state.currentConv && state.currentConv.id === conversationId && userId !== state.user.id) {
      state.typingUsers.set(userId, displayName);
      updateTypingIndicator();
    }
  });

  state.socket.on('typing:stop', ({ conversationId, userId }) => {
    state.typingUsers.delete(userId);
    updateTypingIndicator();
  });

  state.socket.on('user:status', ({ userId, status }) => {
    updateUserStatus(userId, status);
    if (status === 'online') state.onlineUsers.add(userId);
    else state.onlineUsers.delete(userId);
  });

  state.socket.on('notification:new', (notif) => {
    if (el.notifBadge) { el.notifBadge.classList.remove('hidden'); el.notifBadge.textContent = '1'; }
    if (document.getElementById('view-notifs') && !document.getElementById('view-notifs').classList.contains('hidden')) {
      if (typeof loadNotifications === 'function') loadNotifications();
    }
  });
}
