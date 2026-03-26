# Live Subtitle Translator

An Electron prototype for local live subtitle translation between `中文（台灣）` and `English`, now shaped as a tray-first utility with a separate subtitle overlay window.

## What it does

- Captures microphone audio from your device.
- Transcribes speech locally with `Xenova/whisper-tiny`.
- Translates subtitles locally with `Xenova/opus-mt-zh-en` and `Xenova/opus-mt-en-zh`.
- Converts Chinese output to Taiwan Traditional Chinese with `opencc-js`.
- Keeps a control panel for settings and history.
- Shows translated and original subtitles in a separate transparent always-on-top overlay window.
- Adds a tray / menu bar entry for showing the panel, toggling the overlay, and starting or stopping live subtitles.

## How to run

```bash
npm install
npm start
```

For local verification on this machine, launch the app from a normal macOS Terminal session or a packaged app bundle. Running Electron directly inside the Codex desktop sandbox can abort before app startup.

## How it behaves now

- The main control panel is for language direction, overlay settings, and subtitle history.
- The control panel also lets you switch audio input devices when the system default input ends up silent.
- The subtitle overlay is a separate frameless window meant to stay on screen while you work.
- By default, `點擊穿透` is off, so you can drag the whole subtitle window directly.
- If you turn `點擊穿透` on, the overlay will stop intercepting clicks until you turn it off again.
- `背景深度` only adjusts the subtitle background layer; subtitle text stays fully opaque.
- `0%` matches the previous look, while `100%` makes the subtitle background solid black.
- The overlay currently uses a single flat dark edge without a white outline, to avoid double-edge artifacts on transparent Electron windows.
- The overlay position and size are remembered between launches.
- UI state is now persisted with an atomic write path, so a half-written settings file will not block the next launch.
- The app now enforces a single running instance to avoid stale background processes and state-file races.
- On macOS packaging, the app is configured as a menu-bar-style utility with `LSUIElement`.
- The packaged macOS build now also injects microphone usage text into the Electron helper apps so packaged permission prompts behave more like the dev build.

## Platform notes

- macOS currently has the most polished tray-first experience.
- Windows keeps the transparent overlay and click-through path, but now uses more conservative visual effects than macOS to reduce composition risk.
- Linux runs in the most conservative mode: click-through is disabled, and overlay visuals fall back to a less effect-heavy style.
- If the system tray is unavailable on a platform, the app still works through the control panel instead of hiding into an unreachable tray icon.
- Audio capture now prefers `AudioWorklet` and only falls back to `ScriptProcessorNode` when necessary.

## Packaging

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

The packaged app now uses generated icon assets under `assets/icons/`. To regenerate them from a new square PNG:

```bash
npm run generate:icons -- /absolute/path/to/source.png ./assets/icons
```

GitHub Actions is configured in `.github/workflows/build-desktop.yml` to build:

- macOS `.dmg`
- Windows installer `.exe`
- Linux `.AppImage`

## Current limitations

- The current prototype captures microphone input only. It does not yet capture system audio from Zoom, Meet, or local videos.
- "Live" here means chunked near-real-time updates, roughly every 2.8 seconds.
- The first launch downloads the local models from Hugging Face and stores them under the Electron user data cache. After that, inference runs locally on the machine.
- Translation quality is usable for a prototype, but it is not yet tuned for long conversations, speaker diarization, or domain-specific vocabulary.
- On Linux, transparent overlay behavior depends on the desktop environment. This build automatically disables click-through there to avoid making the subtitle window impossible to interact with.
- On macOS, microphone access may need to be approved in `System Settings > Privacy & Security > Microphone` the first time you start listening. If the permission was previously denied and no prompt appears, reset it with `tccutil reset Microphone com.sean9112.live-subtitle-translator`.
- If packaged macOS audio comes through as silent PCM, use the control panel's input-device selector instead of the system default input and retry.

## Known launch issue

- On this machine, tested on March 26, 2026 with macOS 26.4 (`25E246`), Electron aborts if launched from inside the Codex desktop sandbox.
- The same app starts normally when launched outside the sandbox, so the remaining blocker is the sandboxed GUI runtime rather than the subtitle logic in this repository.
