const DEFAULT_SETTINGS = { bass: 0, clarity: 0, volume: 100, outputMode: 'both', preset: 'balanced' };
const PRESETS = {
  balanced: { bass: 0, clarity: 0, volume: 100, outputMode: 'both', preset: 'balanced' },
  bassBoost: { bass: 8, clarity: 0, volume: 100, outputMode: 'both', preset: 'bassBoost' },
  vocalClarity: { bass: 0, clarity: 5, volume: 100, outputMode: 'both', preset: 'vocalClarity' },
};

const elements = {
  tabName: document.querySelector('#tab-name'),
  status: document.querySelector('#status'),
  bass: document.querySelector('#bass'),
  clarity: document.querySelector('#clarity'),
  volume: document.querySelector('#volume'),
  bassValue: document.querySelector('#bass-value'),
  clarityValue: document.querySelector('#clarity-value'),
  volumeValue: document.querySelector('#volume-value'),
  presetButtons: [...document.querySelectorAll('[data-preset]')],
  outputButtons: [...document.querySelectorAll('[data-output-mode]')],
  start: document.querySelector('#start'),
  stop: document.querySelector('#stop'),
};

let currentTab;
let activeCapture;
let settings = { ...DEFAULT_SETTINGS };

function displayStatus(message, kind = '') {
  elements.status.textContent = message;
  elements.status.className = `status ${kind}`.trim();
}

function renderSettings() {
  elements.bass.value = settings.bass;                                         
  elements.clarity.value = settings.clarity;
  elements.volume.value = settings.volume;
  elements.bassValue.value = `${settings.bass} dB`;
  elements.clarityValue.value = `${settings.clarity} dB`;
  elements.volumeValue.value = `${settings.volume}%`;
  elements.presetButtons.forEach((button) => {
    button.classList.toggle('selected', button.dataset.preset === settings.preset);
  });
  elements.outputButtons.forEach((button) => {
    button.classList.toggle('selected', button.dataset.outputMode === settings.outputMode);
  });
}

function renderCaptureState() {
  const processingCurrentTab = activeCapture?.tabId === currentTab?.id;
  const processingAnotherTab = activeCapture && !processingCurrentTab;

  elements.start.disabled = Boolean(activeCapture);
  elements.stop.disabled = !activeCapture;

  if (processingCurrentTab) {
    displayStatus(`Processing “${activeCapture.title}”.`, 'active');
  } else if (processingAnotherTab) {
    displayStatus(`Processing “${activeCapture.title}”. Stop it before choosing another tab.`, 'active');
  } else {
    displayStatus('Ready to enhance this tab.');
  }
}

async function saveSettings() {
  renderSettings();
  const response = await chrome.runtime.sendMessage({
    target: 'background',
    type: 'update-settings',
    settings,
  });
  if (!response?.ok) displayStatus(response?.error || 'Could not save the audio settings.', 'error');
}

function updateFromSliders() {
  settings = {
    bass: Number(elements.bass.value),
    clarity: Number(elements.clarity.value),
    volume: Number(elements.volume.value),
    outputMode: settings.outputMode,
    preset: 'custom',
  };
  saveSettings().catch((error) => displayStatus(error.message, 'error'));
}

async function initialize() {
  const [tabList, settingsResult, statusResult] = await Promise.all([
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    chrome.storage.local.get('audioSettings'),
    chrome.runtime.sendMessage({ target: 'background', type: 'get-status' }),
  ]);

  currentTab = tabList[0];
  elements.tabName.textContent = currentTab?.title || 'No active tab';
  settings = { ...DEFAULT_SETTINGS, ...settingsResult.audioSettings };
  activeCapture = statusResult?.capture ?? null;
  renderSettings();
  renderCaptureState();
}

elements.presetButtons.forEach((button) => {
  button.addEventListener('click', () => {
    settings = { ...PRESETS[button.dataset.preset], outputMode: settings.outputMode };
    saveSettings().catch((error) => displayStatus(error.message, 'error'));
  });
});

elements.outputButtons.forEach((button) => {
  button.addEventListener('click', () => {
    settings = { ...settings, outputMode: button.dataset.outputMode };
    saveSettings().catch((error) => displayStatus(error.message, 'error'));
  });
});

[elements.bass, elements.clarity, elements.volume].forEach((control) => {
  control.addEventListener('input', updateFromSliders);
});

elements.start.addEventListener('click', async () => {
  if (!currentTab) return displayStatus('No active tab is available.', 'error');
  elements.start.disabled = true;
  displayStatus('Connecting audio…');

  try {
    const response = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'start-capture',
      tab: { id: currentTab.id, title: currentTab.title },
    });
    if (!response?.ok) throw new Error(response?.error || 'Chrome could not start audio processing.');
    activeCapture = response.capture;
    renderCaptureState();
  } catch (error) {
    activeCapture = null;
    displayStatus(error.message, 'error');
    elements.start.disabled = false;
    elements.stop.disabled = true;
  }
});

elements.stop.addEventListener('click', async () => {
  elements.stop.disabled = true;
  displayStatus('Stopping audio processing…');

  try {
    const response = await chrome.runtime.sendMessage({ target: 'background', type: 'stop-capture' });
    if (!response?.ok) throw new Error(response?.error || 'Chrome could not stop audio processing.');
    activeCapture = null;
    renderCaptureState();
  } catch (error) {
    displayStatus(error.message, 'error');
    elements.stop.disabled = false;
  }
});

initialize().catch((error) => displayStatus(error.message, 'error'));
