const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const SESSION_KEY = 'activeCapture';

let creatingOffscreenDocument;

async function getActiveCapture() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return result[SESSION_KEY] ?? null;
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length > 0) return;

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'Capture and process the selected tab audio with Web Audio.',
    });
  }

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = undefined;
  }
}

async function closeOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

async function startCapture(tab) {
  if (!tab?.id) throw new Error('No active tab is available.');

  const activeCapture = await getActiveCapture();
  if (activeCapture) {
    if (activeCapture.tabId === tab.id) return activeCapture;
    throw new Error(`Stop processing “${activeCapture.title}” before starting another tab.`);
  }

  await ensureOffscreenDocument();
  try {
    const settingsResult = await chrome.storage.local.get('audioSettings');
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'start-audio',
      streamId,
      tabId: tab.id,
      settings: settingsResult.audioSettings,
    });

    if (!response?.ok) throw new Error(response?.error || 'Chrome could not start audio processing.');
  } catch (error) {
    await closeOffscreenDocument();
    throw error;
  }

  const capture = { tabId: tab.id, title: tab.title || 'Current tab' };
  await chrome.storage.session.set({ [SESSION_KEY]: capture });
  return capture;
}

async function stopCapture() {
  const activeCapture = await getActiveCapture();
  if (!activeCapture) return null;

  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop-audio' });
  } catch {
    // The offscreen page may already have been closed after the tab stopped.
  }

  await chrome.storage.session.remove(SESSION_KEY);
  await closeOffscreenDocument();
  return activeCapture;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'background') return;

  (async () => {
    switch (message.type) {
      case 'get-status':
        sendResponse({ ok: true, capture: await getActiveCapture() });
        break;
      case 'start-capture':
        sendResponse({ ok: true, capture: await startCapture(message.tab) });
        break;
      case 'stop-capture':
        sendResponse({ ok: true, capture: await stopCapture() });
        break;
      case 'update-settings':
        await chrome.storage.local.set({ audioSettings: message.settings });
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'update-settings',
          settings: message.settings,
        }).catch(() => undefined);
        sendResponse({ ok: true });
        break;
      case 'audio-stopped':
        await chrome.storage.session.remove(SESSION_KEY);
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown background message.' });
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

chrome.tabCapture.onStatusChanged.addListener((info) => {
  if (info.status !== 'stopped') return;

  getActiveCapture().then(async (activeCapture) => {
    if (!activeCapture || activeCapture.tabId !== info.tabId) return;
    await chrome.storage.session.remove(SESSION_KEY);
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop-audio' }).catch(() => undefined);
    await closeOffscreenDocument().catch(() => undefined);
  });
});
