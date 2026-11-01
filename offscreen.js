const DEFAULT_SETTINGS = { bass: 0, clarity: 0, volume: 100, outputMode: 'both', preset: 'balanced' };

let audioContext;
let mediaStream;
let sourceNode;
let bassNode;
let clarityNode;
let gainNode;
let limiterNode;
let monoMixNode;
let leftGainNode;
let rightGainNode;
let outputMergerNode;
let activeTabId;

function normalizeSettings(settings = {}) {
  const numberInRange = (value, minimum, maximum, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
  };

  return {
    bass: numberInRange(settings.bass, 0, 12, DEFAULT_SETTINGS.bass),
    clarity: numberInRange(settings.clarity, 0, 12, DEFAULT_SETTINGS.clarity),
    volume: numberInRange(settings.volume, 0, 150, DEFAULT_SETTINGS.volume),
    outputMode: ['left', 'both', 'right'].includes(settings.outputMode) ? settings.outputMode : DEFAULT_SETTINGS.outputMode,
    preset: typeof settings.preset === 'string' ? settings.preset : DEFAULT_SETTINGS.preset,
  };
}

function applySettings(settings) {
  if (!bassNode) return;
  const normalized = normalizeSettings(settings);
  const now = audioContext.currentTime;
  bassNode.gain.setTargetAtTime(normalized.bass, now, 0.015);
  clarityNode.gain.setTargetAtTime(normalized.clarity, now, 0.015);
  gainNode.gain.setTargetAtTime(normalized.volume / 100, now, 0.015);
  leftGainNode.gain.setTargetAtTime(normalized.outputMode === 'right' ? 0 : 1, now, 0.01);
  rightGainNode.gain.setTargetAtTime(normalized.outputMode === 'left' ? 0 : 1, now, 0.01);
}

async function stopAudio({ notify = false } = {}) {
  const stoppedTabId = activeTabId;
  const stream = mediaStream;

  activeTabId = undefined;
  mediaStream = undefined;
  sourceNode?.disconnect();
  bassNode?.disconnect();
  clarityNode?.disconnect();
  gainNode?.disconnect();
  limiterNode?.disconnect();
  monoMixNode?.disconnect();
  leftGainNode?.disconnect();
  rightGainNode?.disconnect();
  outputMergerNode?.disconnect();
  sourceNode = bassNode = clarityNode = gainNode = limiterNode = monoMixNode = leftGainNode = rightGainNode = outputMergerNode = undefined;
  stream?.getTracks().forEach((track) => track.stop());

  if (audioContext) {
    await audioContext.close().catch(() => undefined);
    audioContext = undefined;
  }

  if (notify && stoppedTabId !== undefined) {
    chrome.runtime.sendMessage({ target: 'background', type: 'audio-stopped', tabId: stoppedTabId }).catch(() => undefined);
  }
}

async function startAudio({ streamId, tabId, settings }) {
  if (mediaStream) throw new Error('Audio processing is already active.');

  audioContext = new AudioContext();
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  if (mediaStream.getAudioTracks().length === 0) {
    await stopAudio();
    throw new Error('This tab does not provide an audio track.');
  }

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  bassNode = audioContext.createBiquadFilter();
  bassNode.type = 'lowshelf';
  bassNode.frequency.value = 120;
  bassNode.Q.value = 0.7;

  clarityNode = audioContext.createBiquadFilter();
  clarityNode.type = 'peaking';
  clarityNode.frequency.value = 3000;
  clarityNode.Q.value = 1;

  gainNode = audioContext.createGain();
  limiterNode = audioContext.createDynamicsCompressor();
  limiterNode.threshold.value = -4;
  limiterNode.knee.value = 0;
  limiterNode.ratio.value = 20;
  limiterNode.attack.value = 0.003;
  limiterNode.release.value = 0.25;

  // Explicitly downmix before routing to an earcup, so this works for mono and
  // stereo sources alike instead of merely selecting the source's left channel.
  monoMixNode = audioContext.createGain();
  monoMixNode.channelCount = 1;
  monoMixNode.channelCountMode = 'explicit';
  monoMixNode.channelInterpretation = 'speakers';
  leftGainNode = audioContext.createGain();
  rightGainNode = audioContext.createGain();
  outputMergerNode = audioContext.createChannelMerger(2);

  sourceNode.connect(bassNode).connect(clarityNode).connect(gainNode).connect(limiterNode).connect(monoMixNode);
  monoMixNode.connect(leftGainNode);
  monoMixNode.connect(rightGainNode);
  leftGainNode.connect(outputMergerNode, 0, 0);
  rightGainNode.connect(outputMergerNode, 0, 1);
  outputMergerNode.connect(audioContext.destination);
  activeTabId = tabId;
  applySettings(settings);
  await audioContext.resume();

  mediaStream.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', () => stopAudio({ notify: true }));
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen') return;

  (async () => {
    if (message.type === 'start-audio') {
      await startAudio(message);
    } else if (message.type === 'stop-audio') {
      await stopAudio();
    } else if (message.type === 'update-settings') {
      applySettings(message.settings);
    } else {
      throw new Error('Unknown audio-engine message.');
    }
    sendResponse({ ok: true });
  })().catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
