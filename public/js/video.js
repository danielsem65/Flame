// ==================== VIDEO CALL STATE ====================
const videoState = {
  peerConnection: null,
  localStream: null,
  remoteStream: null,
  inCall: false,
  callTimer: null,
  callSeconds: 0,
  muted: false,
  cameraOff: false,
  ringing: false,
  ringingSound: null
};

// ==================== DOM REFS ====================
const vc = {
  btn: $('video-call-btn'),
  incoming: $('incoming-call'),
  callerAvatar: $('caller-avatar'),
  callerName: $('caller-name'),
  callerStatus: $('caller-status'),
  callAccept: $('call-accept'),
  callDecline: $('call-decline'),
  overlay: $('video-overlay'),
  remoteVideo: $('remote-video'),
  localVideo: $('local-video'),
  timer: $('video-call-timer'),
  callWith: $('video-call-with'),
  muteBtn: $('vc-mute'),
  cameraBtn: $('vc-camera'),
  endBtn: $('vc-end'),
  switchBtn: $('vc-switch')
};

// ==================== STUN SERVERS ====================
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ==================== INITIATE CALL ====================
vc.btn.addEventListener('click', () => {
  if (!state.currentConv || state.currentConv.isGroup) {
    return showToast('Video calls available for 1-on-1 chats only', 'info');
  }
  startCall();
});

async function startCall() {
  try {
    videoState.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    vc.localVideo.srcObject = videoState.localStream;
    videoState.peerConnection = new RTCPeerConnection(RTC_CONFIG);
    setupPeerConnection();

    videoState.localStream.getTracks().forEach(t => videoState.peerConnection.addTrack(t, videoState.localStream));

    const offer = await videoState.peerConnection.createOffer();
    await videoState.peerConnection.setLocalDescription(offer);

    state.socket.emit('video:ring', {
      conversationId: state.currentConv.id,
      callerName: state.user.displayName,
      callerAvatar: state.user.avatar
    });

    showVideoOverlay(true);
    videoState.inCall = true;
    startCallTimer();

    state.socket.emit('video:offer', { conversationId: state.currentConv.id, offer });
  } catch (e) {
    if (e.name === 'NotAllowedError') showToast('Camera/mic access denied', 'error');
    else showToast('Could not start video call', 'error');
    endCall();
  }
}

// ==================== PEER CONNECTION ====================
function setupPeerConnection() {
  const pc = videoState.peerConnection;
  videoState.remoteStream = new MediaStream();
  vc.remoteVideo.srcObject = videoState.remoteStream;

  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach(t => videoState.remoteStream.addTrack(t));
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      state.socket.emit('video:ice-candidate', {
        conversationId: state.currentConv.id,
        candidate: event.candidate
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      showToast('Call disconnected', 'error');
      endCall();
    }
  };
}

// ==================== SOCKET SIGNALING ====================
function setupVideoSocketHandlers() {
  state.socket.on('video:ring', ({ conversationId, from, callerName, callerAvatar }) => {
    if (state.currentConv && state.currentConv.id === conversationId && !videoState.inCall) {
      showIncomingCall(callerName, callerAvatar, conversationId, from);
    }
  });

  state.socket.on('video:accept', async ({ conversationId, from }) => {
    if (!videoState.inCall) return;
    vc.incoming.classList.add('hidden');
    stopRingingSound();
  });

  state.socket.on('video:decline', ({ conversationId, from }) => {
    if (videoState.inCall) {
      showToast('Call declined', 'error');
      endCall();
    }
  });

  state.socket.on('video:offer', async ({ offer, from }) => {
    if (!videoState.peerConnection || !videoState.inCall) return;
    try {
      await videoState.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await videoState.peerConnection.createAnswer();
      await videoState.peerConnection.setLocalDescription(answer);
      state.socket.emit('video:answer', { conversationId: state.currentConv.id, answer });
    } catch (e) { console.error('Error handling offer', e); }
  });

  state.socket.on('video:answer', async ({ answer, from }) => {
    if (!videoState.peerConnection) return;
    try {
      await videoState.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (e) { console.error('Error handling answer', e); }
  });

  state.socket.on('video:ice-candidate', async ({ candidate, from }) => {
    if (!videoState.peerConnection) return;
    try {
      await videoState.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) { /* ignore */ }
  });

  state.socket.on('video:end', ({ conversationId }) => {
    if (videoState.inCall) {
      showToast('Call ended', 'info');
      endCall();
    }
  });

  state.socket.on('video:user-left', ({ conversationId }) => {
    if (videoState.inCall) {
      showToast('Other user left', 'info');
      endCall();
    }
  });
}

// ==================== INCOMING CALL ====================
let pendingCallConv = null;

function showIncomingCall(name, avatar, conversationId, fromUserId) {
  pendingCallConv = conversationId;
  const av = vc.callerAvatar.querySelector('.avatar');
  av.innerHTML = avatar ? `<img src="${avatar}">` : getInitials(name);
  av.style.background = avatar ? 'none' : '';
  vc.callerName.textContent = name;
  vc.callerStatus.textContent = 'Flame Video Call';
  vc.incoming.classList.remove('hidden');
  playRingingSound();
}

vc.callAccept.addEventListener('click', async () => {
  if (!pendingCallConv) return;
  vc.incoming.classList.add('hidden');
  stopRingingSound();
  try {
    videoState.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    vc.localVideo.srcObject = videoState.localStream;
    videoState.peerConnection = new RTCPeerConnection(RTC_CONFIG);
    setupPeerConnection();

    videoState.localStream.getTracks().forEach(t => videoState.peerConnection.addTrack(t, videoState.localStream));

    const conv = state.conversations.find(c => c.id === pendingCallConv);
    if (conv) {
      state.currentConv = conv;
    }

    showVideoOverlay(true);
    videoState.inCall = true;
    startCallTimer();

    state.socket.emit('video:accept', { conversationId: pendingCallConv });
    pendingCallConv = null;
  } catch (e) {
    showToast('Could not access camera/mic', 'error');
    endCall();
  }
});

vc.callDecline.addEventListener('click', () => {
  if (pendingCallConv) {
    state.socket.emit('video:decline', { conversationId: pendingCallConv });
    pendingCallConv = null;
  }
  vc.incoming.classList.add('hidden');
  stopRingingSound();
});

// ==================== RINGING SOUND ====================
function playRingingSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 440;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
    videoState.ringingSound = setTimeout(() => { try { playRingingSound(); } catch (e) {} }, 1000);
  } catch (e) {}
}

function stopRingingSound() {
  if (videoState.ringingSound) {
    clearTimeout(videoState.ringingSound);
    videoState.ringingSound = null;
  }
}

// ==================== UI ====================
function showVideoOverlay(show) {
  vc.overlay.classList.toggle('hidden', !show);
  const other = state.currentConv ? state.currentConv.members.find(m => m.id !== state.user.id) : null;
  vc.callWith.textContent = other ? other.displayName : 'Call';
}

function startCallTimer() {
  videoState.callSeconds = 0;
  videoState.callTimer = setInterval(() => {
    videoState.callSeconds++;
    const m = String(Math.floor(videoState.callSeconds / 60)).padStart(2, '0');
    const s = String(videoState.callSeconds % 60).padStart(2, '0');
    vc.timer.textContent = m + ':' + s;
  }, 1000);
}

// ==================== CONTROLS ====================
vc.muteBtn.addEventListener('click', () => {
  videoState.muted = !videoState.muted;
  if (videoState.localStream) {
    videoState.localStream.getAudioTracks().forEach(t => t.enabled = !videoState.muted);
  }
  vc.muteBtn.innerHTML = videoState.muted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
  vc.muteBtn.classList.toggle('off', videoState.muted);
});

vc.cameraBtn.addEventListener('click', () => {
  videoState.cameraOff = !videoState.cameraOff;
  if (videoState.localStream) {
    videoState.localStream.getVideoTracks().forEach(t => t.enabled = !videoState.cameraOff);
  }
  vc.cameraBtn.innerHTML = videoState.cameraOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
  vc.cameraBtn.classList.toggle('off', videoState.cameraOff);
});

vc.endBtn.addEventListener('click', () => {
  if (state.currentConv) {
    state.socket.emit('video:end', { conversationId: state.currentConv.id });
  }
  endCall();
});

vc.switchBtn.addEventListener('click', async () => {
  if (videoState.localStream) {
    const facing = videoState.localStream.getVideoTracks()[0]?.getSettings().facingMode;
    const newFacing = facing === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing }, audio: false
      });
      const oldTrack = videoState.localStream.getVideoTracks()[0];
      const newTrack = newStream.getVideoTracks()[0];
      videoState.localStream.removeTrack(oldTrack);
      oldTrack.stop();
      videoState.localStream.addTrack(newTrack);
      const sender = videoState.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(newTrack);
      vc.localVideo.srcObject = videoState.localStream;
    } catch (e) { showToast('Could not switch camera', 'error'); }
  }
});

// ==================== END CALL ====================
function endCall() {
  if (videoState.callTimer) {
    clearInterval(videoState.callTimer);
    videoState.callTimer = null;
  }
  if (videoState.peerConnection) {
    videoState.peerConnection.close();
    videoState.peerConnection = null;
  }
  if (videoState.localStream) {
    videoState.localStream.getTracks().forEach(t => t.stop());
    videoState.localStream = null;
  }
  videoState.remoteStream = null;
  videoState.inCall = false;
  videoState.muted = false;
  videoState.cameraOff = false;
  vc.remoteVideo.srcObject = null;
  vc.localVideo.srcObject = null;
  vc.overlay.classList.add('hidden');
  vc.incoming.classList.add('hidden');
  vc.muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
  vc.muteBtn.classList.remove('off');
  vc.cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
  vc.cameraBtn.classList.remove('off');
  vc.timer.textContent = '00:00';
  stopRingingSound();
}

// ==================== INIT ====================
// setupVideoSocketHandlers is called from initApp() after socket connects
