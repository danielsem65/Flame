// ==================== FEED ====================
async function loadFeed() {
  try {
    const res = await fetch('/api/posts/feed/' + state.user.id);
    const posts = await res.json();
    renderFeed(posts || []);
    loadStoriesBar();
  } catch (e) { el.feedPosts.innerHTML = '<div class="loading-item">Failed to load feed</div>'; }
}

function renderFeed(posts) {
  if (posts.length === 0) {
    el.feedPosts.innerHTML = '<div class="loading-item"><i class="fas fa-newspaper"></i> No posts yet. Be the first!</div>';
    return;
  }
  el.feedPosts.innerHTML = posts.map(p => {
    const liked = p.liked > 0;
    return `<div class="post-card" data-post-id="${p.id}">
      <div class="post-header">
        <div class="avatar" onclick="navigateToProfile('${p.userId}')">${p.avatar ? `<img src="${p.avatar}">` : getInitials(p.displayName)}</div>
        <div><span class="post-user" onclick="navigateToProfile('${p.userId}')">${escapeHtml(p.displayName)}</span><span class="post-time"> &middot; ${formatTime(p.createdAt)}</span></div>
      </div>
      ${p.image ? `<img class="post-image" src="${p.image}" onclick="openImageModal('${p.image}')">` : ''}
      <div class="post-content">${escapeHtml(p.content)}</div>
      <div class="post-actions">
        <button class="post-action ${liked ? 'liked' : ''}" onclick="toggleLike('${p.id}','post',this)"><i class="fas fa-heart"></i> <span>${p.likeCount || 0}</span></button>
        <button class="post-action" onclick="focusComment('${p.id}',this)"><i class="fas fa-comment"></i> <span>${p.commentCount || 0}</span></button>
      </div>
      <div class="post-comments" id="comments-${p.id}"></div>
      <div class="post-comment-input"><input placeholder="Write a comment..." id="comment-input-${p.id}" onkeydown="if(event.key==='Enter')submitComment('${p.id}')"></div>
    </div>`;
  }).join('');
}

function renderComments(comments) {
  return comments.map(c => `<div class="post-comment"><strong onclick="navigateToProfile('${c.userId}')">${escapeHtml(c.userName)}</strong> ${escapeHtml(c.content)}</div>`).join('');
}

async function loadStoriesBar() {
  try {
    const res = await fetch('/api/stories');
    const groups = await res.json();
    renderStoriesBar(groups || []);
  } catch (e) {}
}

function renderStoriesBar(groups) {
  let html = `<div class="story-circle" onclick="openStoryInput()"><div class="avatar no-story"><i class="fas fa-plus" style="font-size:24px;line-height:60px;text-align:center;display:block;color:var(--accent);"></i></div><span>Your Story</span></div>`;
  groups.forEach(g => {
    const u = g.user;
    html += `<div class="story-circle" onclick="viewStories('${u.id}')">
      <div class="avatar has-story">${u.avatar ? `<img src="${u.avatar}">` : getInitials(u.displayName)}</div>
      <span>${escapeHtml(u.displayName.split(' ')[0])}</span>
    </div>`;
  });
  el.storiesBar.innerHTML = html;
}

function openStoryInput() { el.storyMediaInput.click(); }

el.storyMediaInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json();
  const isVideo = file.type.startsWith('video/');
  await fetch('/api/stories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: state.user.id, media: data.url, type: isVideo ? 'video' : 'image' })
  });
  showToast('Story added!', 'success');
  loadFeed();
});

async function toggleLike(itemId, type, btn) {
  const liked = btn.classList.toggle('liked');
  const span = btn.querySelector('span');
  span.textContent = parseInt(span.textContent) + (liked ? 1 : -1);
  try {
    await fetch('/api/like', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.user.id, targetId: itemId, targetType: type })
    });
  } catch (e) { showToast('Error', 'error'); }
}

function focusComment(postId) {
  const inp = document.getElementById('comment-input-' + postId);
  if (inp) inp.focus();
}

async function submitComment(postId) {
  const inp = document.getElementById('comment-input-' + postId);
  const content = inp.value.trim();
  if (!content) return;
  inp.value = '';
  try {
    await fetch('/api/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.user.id, targetId: postId, targetType: 'post', content })
    });
    loadFeed();
  } catch (e) { showToast('Error posting comment', 'error'); }
}

// ==================== CREATE POST ====================
el.createPostCard.addEventListener('click', () => el.createPostModal.classList.remove('hidden'));
document.querySelectorAll('#create-post-modal .modal-close').forEach(b => b.addEventListener('click', () => el.createPostModal.classList.add('hidden')));

let postImageData = null;
el.postAddImage.addEventListener('click', () => el.postImageInput.click());
el.postImageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    postImageData = ev.target.result;
    el.postImagePreview.innerHTML = `<img src="${postImageData}"><button class="icon-btn" onclick="postImageData=null;el.postImagePreview.innerHTML='';el.postImagePreview.classList.add('hidden')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.5);color:white;border-radius:50%;"><i class="fas fa-times"></i></button>`;
    el.postImagePreview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

el.postSubmit.addEventListener('click', async () => {
  const content = el.postContent.value.trim();
  if (!content && !postImageData) return showToast('Add text or an image', 'error');
  let imageUrl = '';
  if (postImageData) {
    const blob = await fetch(postImageData).then(r => r.blob());
    const fd = new FormData();
    fd.append('file', blob, 'post.jpg');
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    imageUrl = data.url;
  }
  try {
    await fetch('/api/posts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.user.id, content, image: imageUrl })
    });
    el.createPostModal.classList.add('hidden');
    el.postContent.value = '';
    el.postImagePreview.innerHTML = '';
    el.postImagePreview.classList.add('hidden');
    postImageData = null;
    showToast('Post created!', 'success');
    loadFeed();
  } catch (e) { showToast('Error creating post', 'error'); }
});

// ==================== REELS ====================
async function loadReels() {
  try {
    const res = await fetch('/api/reels/' + state.user.id);
    const reels = await res.json();
    renderReels(reels || []);
  } catch (e) { el.reelsContainer.innerHTML = '<div class="loading-item">Failed to load reels</div>'; }
}

function renderReels(reels) {
  if (reels.length === 0) {
    el.reelsContainer.innerHTML = '<div class="loading-item"><i class="fas fa-film"></i> No reels yet</div>';
    return;
  }
  el.reelsContainer.innerHTML = reels.map(r => {
    const liked = r.liked > 0;
    return `<div class="reel-card" data-reel-id="${r.id}">
      <video src="${r.video}" loop playsinline></video>
      <div class="reel-info">
        <strong onclick="navigateToProfile('${r.userId}')">${escapeHtml(r.displayName)}</strong>
        ${r.caption ? `<p>${escapeHtml(r.caption)}</p>` : ''}
      </div>
      <div class="reel-side-actions">
        <button class="${liked ? 'liked' : ''}" onclick="toggleLike('${r.id}','reel',this)"><i class="fas fa-heart"></i><span>${r.likeCount || 0}</span></button>
      </div>
    </div>`;
  }).join('');
  setupReelScroll();
}

function setupReelScroll() {
  const container = el.reelsContainer;
  const videos = container.querySelectorAll('video');
  let playing = false;
  function playCurrent() {
    const rect = container.getBoundingClientRect();
    videos.forEach(v => {
      const vr = v.parentElement.getBoundingClientRect();
      const pct = (vr.top + vr.height / 2 - rect.top) / rect.height;
      if (pct > 0 && pct < 1) {
        if (!playing) { v.play().catch(()=>{}); playing = true; }
      } else { v.pause(); }
    });
    playing = false;
  }
  container.addEventListener('scroll', () => { playing = false; requestAnimationFrame(playCurrent); });
  setTimeout(playCurrent, 500);
}

// ==================== UPLOAD REEL ====================
el.uploadReelBtn.addEventListener('click', () => el.uploadReelModal.classList.remove('hidden'));
document.querySelectorAll('#upload-reel-modal .modal-close').forEach(b => b.addEventListener('click', () => el.uploadReelModal.classList.add('hidden')));

el.reelUploadArea.addEventListener('click', () => el.reelVideoInput.click());
el.reelVideoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  el.reelUploadArea.innerHTML = `<video src="${URL.createObjectURL(file)}" style="max-height:200px;border-radius:8px;" controls></video>`;
  el.reelSubmit.disabled = false;
  el.reelSubmit._file = file;
});

el.reelSubmit.addEventListener('click', async () => {
  const file = el.reelSubmit._file;
  const caption = el.reelCaption.value.trim();
  if (!file) return showToast('Select a video', 'error');
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json();
  await fetch('/api/reels', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: state.user.id, video: data.url, caption })
  });
  el.uploadReelModal.classList.add('hidden');
  el.reelCaption.value = '';
  el.reelUploadArea.innerHTML = '<i class="fas fa-cloud-upload-alt" style="font-size:48px;color:var(--accent);margin-bottom:12px;"></i><p>Tap to select a video</p>';
  el.reelSubmit.disabled = true;
  el.reelSubmit._file = null;
  showToast('Reel uploaded!', 'success');
  loadReels();
});

// ==================== STORIES VIEWER ====================
let storyQueue = [];
let storyIndex = 0;
let storyTimer = null;

async function viewStories(userId) {
  try {
    const res = await fetch('/api/stories');
    const groups = await res.json();
    const group = groups.find(g => g.user.id === userId);
    if (!group || !group.stories.length) return;
    storyQueue = group.stories.map(s => ({ ...s, userName: group.user.displayName, userAvatar: group.user.avatar }));
    storyIndex = 0;
    el.storyViewer.classList.remove('hidden');
    showStory(0);
  } catch (e) {}
}

function showStory(idx) {
  if (idx >= storyQueue.length) { closeStoryViewer(); return; }
  if (idx < 0) idx = 0;
  storyIndex = idx;
  const s = storyQueue[idx];
  el.storyUsername.textContent = s.userName;
  el.storyUserAvatar.innerHTML = s.userAvatar ? `<img src="${s.userAvatar}">` : getInitials(s.userName);
  el.storyProgress.innerHTML = storyQueue.map((_, i) =>
    `<div class="story-progress-bar"><div class="fill" style="width:${i < idx ? 100 : i === idx ? 0 : 0}%"></div></div>`
  ).join('');
  if (s.type === 'video') {
    el.storyImage.style.display = 'none';
    el.storyVideo.style.display = 'block';
    el.storyVideo.src = s.media;
    el.storyVideo.play().catch(()=>{});
    startProgress(el.storyVideo);
  } else {
    el.storyVideo.style.display = 'none';
    el.storyImage.style.display = 'block';
    el.storyImage.src = s.media;
    startProgress(null);
  }
}

function startProgress(video) {
  if (storyTimer) clearInterval(storyTimer);
  const bar = el.storyProgress.querySelectorAll('.fill')[storyIndex];
  if (!bar) return;
  const duration = video ? (video.duration * 1000) || 10000 : 4000;
  const interval = 100;
  let elapsed = 0;
  if (video) {
    video.onended = () => showStory(storyIndex + 1);
    video.addEventListener('timeupdate', () => {
      const pct = (video.currentTime / video.duration) * 100;
      if (bar) bar.style.width = Math.min(pct, 100) + '%';
    }, { once: false });
  } else {
    storyTimer = setInterval(() => {
      elapsed += interval;
      bar.style.width = Math.min((elapsed / duration) * 100, 100) + '%';
      if (elapsed >= duration) { clearInterval(storyTimer); showStory(storyIndex + 1); }
    }, interval);
  }
}

el.storyNext.addEventListener('click', () => { clearInterval(storyTimer); showStory(storyIndex + 1); });
el.storyPrev.addEventListener('click', () => { clearInterval(storyTimer); showStory(storyIndex - 1); });
el.storyClose.addEventListener('click', closeStoryViewer);

function closeStoryViewer() {
  el.storyViewer.classList.add('hidden');
  if (storyTimer) clearInterval(storyTimer);
  el.storyVideo.pause();
  el.storyVideo.src = '';
}

// ==================== NOTIFICATIONS ====================
async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications/' + state.user.id);
    const data = await res.json();
    renderNotifications(data.notifications || []);
    if (el.notifBadge) { el.notifBadge.classList.add('hidden'); el.notifBadge.textContent = '0'; }
    fetch('/api/notifications/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.user.id })
    }).catch(()=>{});
  } catch (e) { el.notifsContainer.innerHTML = '<div class="loading-item">Failed to load</div>'; }
}

function getNotifMessage(n) {
  if (n.type === 'follow') return 'started following you';
  if (n.type === 'like') return 'liked your post';
  if (n.type === 'comment') return 'commented on your post';
  return 'interacted with you';
}

function renderNotifications(notifs) {
  if (notifs.length === 0) {
    el.notifsContainer.innerHTML = '<div class="notif-empty"><i class="fas fa-bell"></i>No notifications yet</div>';
    return;
  }
  el.notifsContainer.innerHTML = notifs.map(n => {
    let icon = 'fas fa-heart';
    if (n.type === 'follow') icon = 'fas fa-user-plus';
    else if (n.type === 'comment') icon = 'fas fa-comment';
    else if (n.type === 'like') icon = 'fas fa-heart';
    return `<div class="notif-item" onclick="${n.type === 'follow' ? `navigateToProfile('${n.fromUserId}')` : ''}">
      <div class="avatar">${n.avatar ? `<img src="${n.avatar}">` : getInitials(n.displayName)}</div>
      <div class="notif-text"><strong>${escapeHtml(n.displayName)}</strong> ${getNotifMessage(n)}<span class="notif-time">${formatTime(n.createdAt)}</span></div>
      <i class="${icon} notif-icon"></i>
    </div>`;
  }).join('');
}

// ==================== PROFILE ====================
async function loadMyProfile() {
  navigateToProfile(state.user.id);
}

async function navigateToProfile(userId) {
  try {
    const res = await fetch('/api/profile/' + userId + '/' + state.user.id);
    const data = await res.json();
    renderProfile(data);
  } catch (e) { el.profileContainer.innerHTML = '<div class="loading-item">User not found</div>'; }
}

function renderProfile(data) {
  const isMe = data.id === state.user.id;
  const following = data.isFollowing;
  const posts = data.posts || [];
  el.profileContainer.innerHTML = `
    <div class="profile-header-card">
      <div class="avatar large">${data.avatar ? `<img src="${data.avatar}">` : getInitials(data.displayName)}</div>
      <h2>${escapeHtml(data.displayName)}</h2>
      <div class="profile-username">@${escapeHtml(data.username)}</div>
      ${data.bio ? `<div class="profile-bio">${escapeHtml(data.bio)}</div>` : ''}
      <div class="profile-stats">
        <div class="profile-stat"><span class="num">${data.postCount || 0}</span><span class="label">Posts</span></div>
        <div class="profile-stat"><span class="num">${data.followerCount || 0}</span><span class="label">Followers</span></div>
        <div class="profile-stat"><span class="num">${data.followingCount || 0}</span><span class="label">Following</span></div>
      </div>
      ${isMe ? '' : `<button class="follow-btn ${following ? 'following' : ''}" onclick="toggleFollow('${data.id}',this)">${following ? 'Following' : 'Follow'}</button>`}
    </div>
    <div class="profile-grid">${posts.map(p => p.image ? `<img src="${p.image}" onclick="openImageModal('${p.image}')">` : '<div class="grid-placeholder"><i class="fas fa-file-alt"></i></div>').join('')}</div>
  `;
}

async function toggleFollow(targetId, btn) {
  const following = btn.classList.toggle('following');
  btn.textContent = following ? 'Following' : 'Follow';
  try {
    await fetch('/api/follow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followerId: state.user.id, followingId: targetId })
    });
  } catch (e) { showToast('Error', 'error'); }
}

// ==================== EDIT PROFILE ====================
el.editProfileBtn.addEventListener('click', () => {
  el.editDisplayname.value = state.user.displayName;
  el.editBio.value = state.user.bio || '';
  const av = el.editAvatarPreview.querySelector('.avatar');
  av.innerHTML = state.user.avatar ? `<img src="${state.user.avatar}">` : getInitials(state.user.displayName);
  av.style.background = state.user.avatar ? 'none' : '';
  el.editProfileModal.classList.remove('hidden');
});

el.saveProfileBtn.addEventListener('click', async () => {
  const name = el.editDisplayname.value.trim();
  const bio = el.editBio.value.trim();
  if (!name) return showToast('Name is required', 'error');
  try {
    await fetch('/api/users/' + state.user.id + '/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name, bio })
    });
    state.user.displayName = name;
    state.user.bio = bio;
    showToast('Profile updated', 'success');
    el.editProfileModal.classList.add('hidden');
    loadMyProfile();
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
    el.editProfileModal.classList.add('hidden');
    showToast('Avatar updated', 'success');
    loadMyProfile();
  };
  input.click();
});

// ==================== IMAGE MODAL ====================
function openImageModal(src) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;cursor:pointer;';
  modal.innerHTML = `<img src="${src}" style="max-width:95%;max-height:95%;object-fit:contain;">`;
  modal.onclick = () => modal.remove();
  document.body.appendChild(modal);
}

// ==================== INIT SOCIAL ====================
function initSocial() {
  if (el.feedMyAvatar) {
    el.feedMyAvatar.innerHTML = state.user.avatar ? `<img src="${state.user.avatar}">` : getInitials(state.user.displayName);
    el.feedMyAvatar.style.background = state.user.avatar ? 'none' : '';
  }
  loadFeed();
}

// ==================== GLOBALS ====================
window.loadFeed = loadFeed;
window.loadReels = loadReels;
window.loadNotifications = loadNotifications;
window.loadMyProfile = loadMyProfile;
window.navigateToProfile = navigateToProfile;
window.toggleLike = toggleLike;
window.submitComment = submitComment;
window.focusComment = focusComment;
window.viewStories = viewStories;
window.toggleFollow = toggleFollow;
window.openImageModal = openImageModal;
