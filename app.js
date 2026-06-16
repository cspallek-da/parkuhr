const durationInput = document.getElementById('durationMinutes');
const warningInput = document.getElementById('warningMinutes');
const noteInput = document.getElementById('note');
const startButton = document.getElementById('startButton');
const pauseButton = document.getElementById('pauseButton');
const resetButton = document.getElementById('resetButton');
const notifyButton = document.getElementById('notifyButton');
const installButton = document.getElementById('installButton');
const timeLeftEl = document.getElementById('timeLeft');
const statusText = document.getElementById('statusText');
const progressRing = document.getElementById('progressRing');
const overlay = document.getElementById('messageOverlay');
const messageIcon = document.getElementById('messageIcon');
const messageTitle = document.getElementById('messageTitle');
const messageText = document.getElementById('messageText');
const closeMessage = document.getElementById('closeMessage');

const STORAGE_KEY = 'parkuhr-state-v1';

let timerId = null;
let deferredInstallPrompt = null;
let state = {
  running: false,
  paused: false,
  startedAt: null,
  endAt: null,
  durationMs: 30 * 60 * 1000,
  remainingMs: 30 * 60 * 1000,
  warningMs: 5 * 60 * 1000,
  warningShown: false,
  expiredShown: false,
  note: ''
};

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    state = { ...state, ...saved };
    durationInput.value = Math.max(1, Math.round(state.durationMs / 60000));
    warningInput.value = Math.max(0, Math.round(state.warningMs / 60000));
    noteInput.value = state.note || '';
    if (state.running && !state.paused && state.endAt && Date.now() < state.endAt) {
      startTicker();
    } else if (state.running && state.endAt && Date.now() >= state.endAt) {
      state.remainingMs = 0;
      state.running = false;
      state.paused = false;
      showExpiredMessage();
      saveState();
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function updateUi() {
  let remaining = state.remainingMs;
  if (state.running && !state.paused && state.endAt) {
    remaining = Math.max(0, state.endAt - Date.now());
    state.remainingMs = remaining;
  }
  const elapsed = Math.max(0, state.durationMs - remaining);
  const progress = state.durationMs > 0 ? Math.min(360, (elapsed / state.durationMs) * 360) : 0;
  timeLeftEl.textContent = formatTime(remaining);
  progressRing.style.setProperty('--progress', `${progress}deg`);
  progressRing.classList.toggle('warning', state.running && remaining <= state.warningMs && remaining > 0);
  progressRing.classList.toggle('expired', remaining <= 0 && !state.running);
  startButton.disabled = state.running && !state.paused;
  pauseButton.disabled = !state.running;
  resetButton.disabled = !state.running && remaining === state.durationMs;
  durationInput.disabled = state.running && !state.paused;
  warningInput.disabled = state.running && !state.paused;
  if (state.running && state.paused) {
    statusText.textContent = 'Pausiert';
    pauseButton.textContent = 'Weiter';
  } else if (state.running) {
    statusText.textContent = remaining <= state.warningMs ? 'Läuft bald ab' : 'Parkuhr läuft';
    pauseButton.textContent = 'Pause';
  } else if (remaining <= 0) {
    statusText.textContent = 'Abgelaufen';
    pauseButton.textContent = 'Pause';
  } else {
    statusText.textContent = 'Bereit';
    pauseButton.textContent = 'Pause';
  }
}

function showMessage(type, title, text) {
  messageIcon.textContent = type === 'expired' ? '⏰' : '⚠️';
  messageTitle.textContent = title;
  messageText.textContent = text;
  overlay.hidden = false;
}

function browserNotify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag: 'parkuhr-alert', renotify: true });
  } catch {}
}

function noteSuffix() {
  return state.note ? ` Hinweis: ${state.note}` : '';
}

function showWarningMessage() {
  if (state.warningShown) return;
  state.warningShown = true;
  const text = `Deine Parkzeit läuft bald ab.${noteSuffix()}`;
  showMessage('warning', 'Parkzeit läuft bald ab', text);
  browserNotify('Parkuhr: läuft bald ab', text);
  saveState();
}

function showExpiredMessage() {
  if (state.expiredShown) return;
  state.expiredShown = true;
  const text = `Deine eingestellte Parkzeit ist abgelaufen.${noteSuffix()}`;
  showMessage('expired', 'Parkzeit abgelaufen', text);
  browserNotify('Parkuhr: abgelaufen', text);
  saveState();
}

function tick() {
  if (!state.running || state.paused) {
    updateUi();
    return;
  }
  state.remainingMs = Math.max(0, state.endAt - Date.now());
  if (state.remainingMs <= state.warningMs && state.remainingMs > 0) showWarningMessage();
  if (state.remainingMs <= 0) {
    state.running = false;
    state.paused = false;
    stopTicker();
    showExpiredMessage();
  }
  updateUi();
  saveState();
}

function startTicker() {
  stopTicker();
  timerId = window.setInterval(tick, 1000);
  tick();
}

function stopTicker() {
  if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function startParkingMeter() {
  const durationMinutes = clampNumber(durationInput.value, 1, 999, 30);
  const warningMinutes = clampNumber(warningInput.value, 0, durationMinutes, Math.min(5, durationMinutes));
  state.durationMs = durationMinutes * 60 * 1000;
  state.warningMs = warningMinutes * 60 * 1000;
  state.remainingMs = state.durationMs;
  state.startedAt = Date.now();
  state.endAt = state.startedAt + state.durationMs;
  state.running = true;
  state.paused = false;
  state.warningShown = false;
  state.expiredShown = false;
  state.note = noteInput.value.trim();
  durationInput.value = durationMinutes;
  warningInput.value = warningMinutes;
  saveState();
  startTicker();
}

function togglePause() {
  if (!state.running) return;
  if (state.paused) {
    state.endAt = Date.now() + state.remainingMs;
    state.paused = false;
    startTicker();
  } else {
    state.remainingMs = Math.max(0, state.endAt - Date.now());
    state.paused = true;
    stopTicker();
  }
  saveState();
  updateUi();
}

function resetParkingMeter() {
  stopTicker();
  const durationMinutes = clampNumber(durationInput.value, 1, 999, 30);
  const warningMinutes = clampNumber(warningInput.value, 0, durationMinutes, Math.min(5, durationMinutes));
  state = {
    running: false,
    paused: false,
    startedAt: null,
    endAt: null,
    durationMs: durationMinutes * 60 * 1000,
    remainingMs: durationMinutes * 60 * 1000,
    warningMs: warningMinutes * 60 * 1000,
    warningShown: false,
    expiredShown: false,
    note: noteInput.value.trim()
  };
  overlay.hidden = true;
  saveState();
  updateUi();
}

async function requestNotifications() {
  if (!('Notification' in window)) {
    showMessage('warning', 'Hinweis', 'Dein Browser unterstützt keine Browser-Benachrichtigungen. Die Meldung in der App funktioniert trotzdem.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    showMessage('warning', 'Aktiviert', 'Browser-Benachrichtigungen sind aktiviert. Zusätzlich erscheint weiterhin die Meldung in der App.');
  } else {
    showMessage('warning', 'Nicht aktiviert', 'Browser-Benachrichtigungen wurden nicht aktiviert. Die Meldung in der App funktioniert trotzdem.');
  }
}

startButton.addEventListener('click', startParkingMeter);
pauseButton.addEventListener('click', togglePause);
resetButton.addEventListener('click', resetParkingMeter);
notifyButton.addEventListener('click', requestNotifications);
closeMessage.addEventListener('click', () => { overlay.hidden = true; });
durationInput.addEventListener('change', resetParkingMeter);
warningInput.addEventListener('change', resetParkingMeter);
noteInput.addEventListener('input', () => { state.note = noteInput.value.trim(); saveState(); });

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

window.addEventListener('focus', tick);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js'); });
}

loadState();
updateUi();
