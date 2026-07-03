// ==================== INIT ====================
function initApp() {
  el.auth.classList.add('hidden');
  el.app.classList.remove('hidden');
  updateUserUI();
  connectSocket();
  loadConversations();
  loadAllUsers();
}

function updateUserUI() {
  el.myName.textContent = state.user.displayName;
  el.myAvatar.innerHTML = state.user.avatar ? `<img src="${state.user.avatar}">` : getInitials(state.user.displayName);
  el.myAvatar.style.background = state.user.avatar ? 'none' : '';
}

// ==================== THEME ====================
function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('mlc-theme', theme);
  el.themeToggle.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
}
el.themeToggle.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
setTheme(state.theme);

// ==================== NEW CHAT ====================
let allUsers = [];
let selectedUsers = [];
let chatMode = 'direct';

el.newChatBtn.addEventListener('click', () => openNewChat());
el.startChatBtn.addEventListener('click', () => openNewChat());

function openNewChat() {
  selectedUsers = [];
  chatMode = 'direct';
  el.newChatModal.classList.remove('hidden');
  el.selectedUsers.innerHTML = '';
  el.groupNameInput.classList.add('hidden');
  el.modalStart.disabled = true;
  el.userSearchInput.value = '';
  renderUsers(allUsers);
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.modal-tab[data-type="direct"]').classList.add('active');
}

document.querySelectorAll('.modal-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    chatMode = tab.dataset.type;
    el.groupNameInput.classList.toggle('hidden', chatMode === 'direct');
    selectedUsers = [];
    el.selectedUsers.innerHTML = '';
    el.modalStart.disabled = true;
    renderUsers(allUsers);
  });
});

async function loadAllUsers() {
  try {
    const res = await fetch('/api/users/' + state.user.id);
    allUsers = await res.json();
  } catch (e) { console.error(e); }
}

function renderUsers(users) {
  if (!users || users.length === 0) {
    el.usersList.innerHTML = '<div class="loading-item">No users found</div>';
    return;
  }
  el.usersList.innerHTML = users.map(u => {
    const sel = selectedUsers.includes(u.id);
    return `<div class="user-item ${sel ? 'selected' : ''}" data-user-id="${u.id}" onclick="toggleUser('${u.id}')">
      <div class="avatar">${u.avatar ? `<img src="${u.avatar}">` : getInitials(u.displayName)}</div>
      <div class="user-item-info">
        <h4>${escapeHtml(u.displayName)}</h4>
        <p>@${escapeHtml(u.username)}</p>
      </div>
      ${sel ? '<i class="fas fa-check-circle check"></i>' : ''}
    </div>`;
  }).join('');
}

function toggleUser(userId) {
  const idx = selectedUsers.indexOf(userId);
  if (idx >= 0) selectedUsers.splice(idx, 1);
  else selectedUsers.push(userId);
  renderSelectedUsers();
  renderUsers(allUsers);
  el.modalStart.disabled = chatMode === 'direct' ? selectedUsers.length !== 1 : selectedUsers.length < 1;
}

function renderSelectedUsers() {
  el.selectedUsers.innerHTML = selectedUsers.map(id => {
    const u = allUsers.find(u => u.id === id);
    if (!u) return '';
    return `<span class="selected-user">${escapeHtml(u.displayName)} <button class="remove-user" onclick="toggleUser('${id}')">&times;</button></span>`;
  }).join('');
}

el.userSearchInput.addEventListener('input', debounce(function() {
  const q = this.value.trim().toLowerCase();
  if (!q) return renderUsers(allUsers);
  renderUsers(allUsers.filter(u => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)));
}, 200));

el.modalStart.addEventListener('click', async () => {
  const body = { isGroup: chatMode === 'group', members: selectedUsers, createdBy: state.user.id };
  if (chatMode === 'group') {
    body.name = (el.groupNameInput.querySelector('input').value.trim()) || 'Group Chat';
  }
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    el.newChatModal.classList.add('hidden');
    if (!data.existing) {
      state.socket.emit('conversation:join', { conversationId: data.id, userId: state.user.id });
      selectedUsers.forEach(m => state.socket.emit('conversation:join', { conversationId: data.id, userId: m }));
    }
    await loadConversations();
    selectConversation(data.id);
  } catch (e) { showToast('Error creating chat', 'error'); }
});

el.modalCancel.addEventListener('click', () => el.newChatModal.classList.add('hidden'));

document.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
}));

// ==================== CHAT INFO ====================
el.chatInfoBtn.addEventListener('click', () => {
  if (!state.currentConv) return;
  const conv = state.currentConv;
  let html = '';
  if (conv.isGroup) html = `<div class="info-section"><h4>Group Name</h4><p>${escapeHtml(conv.name)}</p></div>`;
  html += `<div class="info-section"><h4>Members (${conv.members.length})</h4>`;
  conv.members.forEach(m => {
    html += `<div class="info-member" data-user-id="${m.id}">
      <div class="avatar">${m.avatar ? `<img src="${m.avatar}">` : getInitials(m.displayName)}</div>
      <div>
        <h5>${escapeHtml(m.displayName)} ${m.id === state.user.id ? '<span style="color:var(--accent);font-size:11px;">(You)</span>' : ''}</h5>
        <p><span class="status-dot ${m.status}"></span> ${m.status === 'online' ? 'Online' : 'Offline'}</p>
      </div>
    </div>`;
  });
  html += '</div>';
  el.chatInfoBody.innerHTML = html;
  el.chatInfoModal.classList.remove('hidden');
});

el.leaveChatBtn.addEventListener('click', () => {
  if (!state.currentConv || !confirm('Leave this conversation?')) return;
  el.chatInfoModal.classList.add('hidden');
  el.chatView.classList.add('hidden');
  el.noChat.classList.remove('hidden');
});

// ==================== PROFILE ====================
el.currentUser.addEventListener('click', () => {
  el.profileUsername.textContent = state.user.username;
  el.profileDisplayname.value = state.user.displayName;
  const av = el.profileAvatar.querySelector('.avatar');
  av.innerHTML = state.user.avatar ? `<img src="${state.user.avatar}">` : getInitials(state.user.displayName);
  av.style.background = state.user.avatar ? 'none' : '';
  el.profileModal.classList.remove('hidden');
});

el.saveProfileBtn.addEventListener('click', async () => {
  const name = el.profileDisplayname.value.trim();
  if (!name || name === state.user.displayName) return;
  try {
    await fetch('/api/users/' + state.user.id + '/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name })
    });
    state.user.displayName = name;
    updateUserUI();
    showToast('Profile updated', 'success');
    el.profileModal.classList.add('hidden');
  } catch (e) { showToast('Error updating profile', 'error'); }
});

el.changeAvatarBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    fd.append('userId', state.user.id);
    const res = await fetch('/api/upload-avatar', { method: 'POST', body: fd });
    const data = await res.json();
    state.user.avatar = data.url;
    updateUserUI();
    showToast('Avatar updated', 'success');
    el.profileModal.classList.add('hidden');
  };
  input.click();
});

// ==================== ONLINE USERS ====================
function updateOnlineUsers() {
  const online = allUsers.filter(u => state.onlineUsers.has(u.id));
  el.onlineCount.textContent = online.length;
  if (online.length === 0) {
    el.onlineUsers.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">No one online</span>';
    return;
  }
  el.onlineUsers.innerHTML = online.map(u => `
    <div class="online-user" onclick="startDirectChat('${u.id}')" title="${escapeHtml(u.displayName)}">
      <div class="avatar">${u.avatar ? `<img src="${u.avatar}">` : getInitials(u.displayName)}</div>
      <span>${escapeHtml(u.displayName.split(' ')[0])}</span>
    </div>
  `).join('');
}

// ==================== CONTEXT MENU REACTIONS ====================
window.toggleUser = toggleUser;

console.log('Flame loaded!');
