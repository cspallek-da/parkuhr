const durationInput = document.getElementById('durationMinutes');
const warningInput = document.getElementById('warningMinutes');
const licensePlateInput = document.getElementById('licensePlate');
const parkingPlaceInput = document.getElementById('parkingPlace');
const noteInput = document.getElementById('note');
const startButton = document.getElementById('startButton');
const pauseButton = document.getElementById('pauseButton');
const resetButton = document.getElementById('resetButton');
const notifyButton = document.getElementById('notifyButton');
const installButton = document.getElementById('installButton');
const clearHistoryButton = document.getElementById('clearHistoryButton');
const timeLeftEl = document.getElementById('timeLeft');
const statusText = document.getElementById('statusText');
const activeInfo = document.getElementById('activeInfo');
const progressRing = document.getElementById('progressRing');
const overlay = document.getElementById('messageOverlay');
const messageIcon = document.getElementById('messageIcon');
const messageTitle = document.getElementById('messageTitle');
const messageText = document.getElementById('messageText');
const closeMessage = document.getElementById('closeMessage');
const historyList = document.getElementById('historyList');

const STORAGE_KEY = 'parkuhr-state-v2';
const HISTORY_KEY = 'parkuhr-history-v1';

let timerId = null;
let deferredInstallPrompt = null;
let audioContext = null;
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
  note: '',
  licensePlate: '',
  parkingPlace: ''
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
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(timestamp));
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
    licensePlateInput.value = state.licensePlate || '';
    parkingPlaceInput.value = state.parkingPlace || '';

    if (state.running && !state.paused && state.endAt && Date.now() < state.endAt) startTicker();
    else if (state.running && state.endAt && Date.now() >= state.endAt) {
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

function updateQuickButtons() {
  document.querySelectorAll('.quick').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.minutes) === Number(durationInput.value)));
  document.querySelectorAll('.warning-quick').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.minutes) === Number(warningInput.value)));
}

function updateActiveInfo() {
  const parts = [];
  if (state.licensePlate) parts.push(`🚗 ${state.licensePlate}`);
  if (state.parkingPlace) parts.push(`📍 ${state.parkingPlace}`);
  if (state.endAt) parts.push(`⏰ bis ${new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' }).format(new Date(state.endAt))}`);
  activeInfo.textContent = parts.join('  ·  ');
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
    statusText.textContent = remaining <= state.warningMs ? 'Zeit zum Zurücklaufen' : 'Parkuhr läuft';
    pauseButton.textContent = 'Pause';
  } else if (remaining <= 0) {
    statusText.textContent = 'Abgelaufen';
    pauseButton.textContent = 'Pause';
  } else {
    statusText.textContent = 'Bereit';
    pauseButton.textContent = 'Pause';
  }
  updateQuickButtons();
  updateActiveInfo();
}

function playAlertSound() {
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioContext.currentTime;
    [0, 0.22, 0.44].forEach((offset) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    });
  } catch {}
}

function vibrateAlert() {
  if ('vibrate' in navigator) navigator.vibrate([250, 120, 250, 120, 400]);
}

function alertFeedback() {
  playAlertSound();
  vibrateAlert();
}

function showMessage(type, title, text) {
  messageIcon.textContent = type === 'expired' ? '⏰' : '⚠️';
  messageTitle.textContent = title;
  messageText.textContent = text;
  overlay.hidden = false;
}

function browserNotify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, tag: 'parkuhr-alert', renotify: true }); } catch {}
}

function detailsText() {
  const lines = [];
  if (state.licensePlate) lines.push(`Kennzeichen: ${state.licensePlate}`);
  if (state.parkingPlace) lines.push(`Parkplatz: ${state.parkingPlace}`);
  if (state.note) lines.push(`Hinweis: ${state.note}`);
  return lines.length ? `\n\n${lines.join('\n')}` : '';
}

function showWarningMessage() {
  if (state.warningShown) return;
  state.warningShown = true;
  const minutes = Math.round(state.warningMs / 60000);
  const text = `Deine Parkzeit läuft in ca. ${minutes} Minuten ab. Jetzt loslaufen.${detailsText()}`;
  showMessage('warning', 'Zeit zum Auto zurückzugehen', text);
  browserNotify('Parkuhr: Zeit zum Zurückgehen', text);
  alertFeedback();
  saveState();
}

function showExpiredMessage() {
  if (state.expiredShown) return;
  state.expiredShown = true;
  const text = `Deine eingestellte Parkzeit ist abgelaufen.${detailsText()}`;
  showMessage('expired', 'Parkzeit abgelaufen', text);
  browserNotify('Parkuhr: abgelaufen', text);
  alertFeedback();
  saveState();
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 10)));
}

function addHistory(status) {
  const item = {
    status,
    startedAt: state.startedAt,
    endAt: state.endAt,
    durationMinutes: Math.round(state.durationMs / 60000),
    warningMinutes: Math.round(state.warningMs / 60000),
    licensePlate: state.licensePlate,
    parkingPlace: state.parkingPlace,
    note: state.note
  };
  const items = getHistory();
  items.unshift(item);
  saveHistory(items);
  renderHistory();
}

function renderHistory() {
  const items = getHistory();
  if (!items.length) {
    historyList.className = 'history-list empty';
    historyList.textContent = 'Noch keine Parkvorgänge.';
    return;
  }
  historyList.className = 'history-list';
  historyList.innerHTML = items.map(item => {
    const title = `${item.licensePlate || 'Ohne Kennzeichen'}${item.parkingPlace ? ' · ' + item.parkingPlace : ''}`;
    const meta = `${item.durationMinutes} Min · Erinnerung ${item.warningMinutes} Min vorher · bis ${formatDateTime(item.endAt)} · ${item.status}`;
    const note = item.note ? `<div class="history-meta">${escapeHtml(item.note)}</div>` : '';
    return `<div class="history-item"><div class="history-title">${escapeHtml(title)}</div><div class="history-meta">${escapeHtml(meta)}</div>${note}</div>`;
  }).join('');
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function tick() {
  if (!state.running || state.paused) { updateUi(); return; }
  state.remainingMs = Math.max(0, state.endAt - Date.now());
  if (state.remainingMs <= state.warningMs && state.remainingMs > 0) showWarningMessage();
  if (state.remainingMs <= 0) {
    state.running = false;
    state.paused = false;
    stopTicker();
    showExpiredMessage();
    addHistory('abgelaufen');
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
  if (timerId) { window.clearInterval(timerId); timerId = null; }
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
  state.licensePlate = licensePlateInput.value.trim().toUpperCase();
  state.parkingPlace = parkingPlaceInput.value.trim();
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
  const wasRunning = state.running;
  stopTicker();
  const durationMinutes = clampNumber(durationInput.value, 1, 999, 30);
  const warningMinutes = clampNumber(warningInput.value, 0, durationMinutes, Math.min(5, durationMinutes));
  if (wasRunning && state.startedAt) addHistory('zurückgesetzt');
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
    note: noteInput.value.trim(),
    licensePlate: licensePlateInput.value.trim().toUpperCase(),
    parkingPlace: parkingPlaceInput.value.trim()
  };
  overlay.hidden = true;
  saveState();
  updateUi();
}

async function requestNotifications() {
  alertFeedback();
  if (!('Notification' in window)) {
    showMessage('warning', 'Hinweis', 'Dein Browser unterstützt keine Browser-Benachrichtigungen. Die Meldung in der App funktioniert trotzdem.');
    return;
  }
  const permission = await Notification.requestPermission();
  showMessage('warning', permission === 'granted' ? 'Aktiviert' : 'Nicht aktiviert', permission === 'granted' ? 'Browser-Benachrichtigungen sind aktiviert. Ton/Vibration wurden getestet.' : 'Browser-Benachrichtigungen wurden nicht aktiviert. Die Meldung in der App funktioniert trotzdem.');
}

document.querySelectorAll('.quick').forEach(btn => btn.addEventListener('click', () => { durationInput.value = btn.dataset.minutes; resetParkingMeter(); }));
document.querySelectorAll('.warning-quick').forEach(btn => btn.addEventListener('click', () => { warningInput.value = btn.dataset.minutes; resetParkingMeter(); }));
startButton.addEventListener('click', startParkingMeter);
pauseButton.addEventListener('click', togglePause);
resetButton.addEventListener('click', resetParkingMeter);
notifyButton.addEventListener('click', requestNotifications);
clearHistoryButton.addEventListener('click', () => { localStorage.removeItem(HISTORY_KEY); renderHistory(); });
closeMessage.addEventListener('click', () => { overlay.hidden = true; });
durationInput.addEventListener('change', resetParkingMeter);
warningInput.addEventListener('change', resetParkingMeter);
[licensePlateInput, parkingPlaceInput, noteInput].forEach(input => input.addEventListener('input', () => {
  state.licensePlate = licensePlateInput.value.trim().toUpperCase();
  state.parkingPlace = parkingPlaceInput.value.trim();
  state.note = noteInput.value.trim();
  saveState();
  updateUi();
}));

window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstallPrompt = event; installButton.hidden = false; });
installButton.addEventListener('click', async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; installButton.hidden = true; });
window.addEventListener('focus', tick);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js'); });

loadState();
renderHistory();
updateUi();
