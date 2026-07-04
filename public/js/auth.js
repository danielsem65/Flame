function showAuthError(form, msg) {
  if (form === 'login') el.loginError.textContent = msg;
  else el.registerError.textContent = msg;
}

function saveSession(user) {
  localStorage.setItem('flame_user', JSON.stringify({ id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, bio: user.bio }));
}

function clearSession() {
  localStorage.removeItem('flame_user');
}

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-form').classList.add('active');
    showAuthError('login', '');
    showAuthError('register', '');
  });
});

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = el.loginUsername.value.trim();
  const password = el.loginPassword.value.trim();
  if (!username || !password) return showAuthError('login', 'Please fill all fields');
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError('login', data.error);
    state.user = data;
    saveSession(data);
    initApp();
  } catch (e) { showAuthError('login', 'Connection error'); }
});

el.registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = el.regUsername.value.trim();
  const displayName = el.regDisplayname.value.trim();
  const password = el.regPassword.value.trim();
  const confirm = el.regConfirm.value.trim();
  if (!username || !displayName || !password) return showAuthError('register', 'Please fill all fields');
  if (password !== confirm) return showAuthError('register', 'Passwords do not match');
  if (password.length < 4) return showAuthError('register', 'Password too short');
  try {
    const res = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError('register', data.error);
    state.user = data;
    saveSession(data);
    initApp();
  } catch (e) { showAuthError('register', 'Connection error'); }
});

el.logoutBtn.addEventListener('click', () => {
  if (state.socket) state.socket.disconnect();
  state.user = null;
  clearSession();
  el.app.classList.add('hidden');
  el.auth.classList.remove('hidden');
});

// Auto-login from saved session
(async function autoLogin() {
  const saved = localStorage.getItem('flame_user');
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    const res = await fetch('/api/me/' + parsed.id);
    if (!res.ok) { clearSession(); return; }
    const user = await res.json();
    state.user = user;
    saveSession(user);
    initApp();
  } catch (e) { clearSession(); }
})();
