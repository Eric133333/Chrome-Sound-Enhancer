# Tab Sound Enhancer

A local Chrome extension that lets you boost bass, improve vocal clarity, and adjust volume for one browser tab at a time.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this project folder: `C:\Users\hunge\Downloads\Engineer\sound plugin`.
5. Pin **Tab Sound Enhancer**, open a tab with audio, then click the extension and choose **Start processing**.

Use **Stop** before switching to another tab. Chrome shows its normal capture indicator while processing is active.

## Controls

- **Bass:** low-shelf boost at 120 Hz, from 0 to +12 dB.
- **Clarity:** presence boost around 3 kHz, from 0 to +12 dB.
- **Volume:** processed output from 0% to 150%; a limiter reduces clipping risk at higher levels.
- **Headphone output:** sends a mono mix to the left ear, right ear, or both ears; this works even if the original audio is mono.
- **Profiles:** Balanced, Bass Boost, and Vocal Clarity. The last-selected controls are remembered for later sessions.
