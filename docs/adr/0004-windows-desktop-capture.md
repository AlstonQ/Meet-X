# ADR 0004: Windows Desktop Audio Capture

## Status

Accepted and implemented as the Phase 1 desktop vertical slice.

## Context

A browser PWA cannot access Windows process information or unrestricted system-audio loopback simply because it is installed. Browser system-audio capture also normally requires a tab or display-selection flow. Meet-X needs to detect local Teams, Zoom, and Google Meet sessions, record system sound plus microphone audio without forcing screen video, and optionally save a user-selected screen or application window.

The recorder must remain visible and consent-first. Failed upload or transcription must never discard the local recording.

## Decision

Build apps/desktop-agent as an Electron companion implementing the DesktopSdkProvider boundary.

On Windows, Electron grants a system loopback audio stream through its display-media request handler. Chromium requires a display-media request to acquire this stream, so the agent requests display media after an explicit user gesture. For audio-only capture it disables and discards video tracks. When Screen video is enabled, the agent lists available entire screens and application windows, requires an explicit source selection, and retains only that selected video track.

The recorder:

- Requires explicit confirmation that participants were informed.
- Keeps a persistent visible recording state and prevents closing while active.
- Detects local meeting windows every five seconds and prefills source/title.
- Mixes Windows loopback and the default microphone through Web Audio.
- Offers explicit entire-screen or application-window selection when optional video is enabled.
- Streams one-second WebM/Opus chunks to a local recovery file.
- Streams the completed artifact to the Meet-X upload API.
- Automatically invokes multilingual Whisper processing when selected.
- Keeps the recovery file when upload or processing fails.
- Restricts media permissions and external links to the trusted recorder window and configured Meet-X origin.

## Consequences

- Teams desktop audio no longer depends on browser screen sharing.
- Windows is the first supported native platform; macOS requires a separately reviewed permission and capture path.
- The Chromium display-capture API is used internally to obtain loopback audio. Video is discarded for audio-only sessions and retained only when the user explicitly selects Screen video and a source.
- Electron packaging, signing, update delivery, and platform security become launch responsibilities.
- The current localhost API remains a development transport. Production uses authenticated, resumable, region-pinned object upload.
- Local recovery files contain customer content and require user-visible retention/deletion controls before general release.

## Alternatives rejected

### PWA-only capture

PWA installation does not grant native process inspection or unrestricted OS loopback audio. It cannot satisfy Teams desktop detection and audio-only system capture.

### Require browser screen sharing

This works for many browser calls but creates the wrong user experience for desktop Teams and captures video the user did not ask Meet-X to retain.

### Virtual audio-cable dependency

Virtual devices can expose system sound as a microphone but add installation complexity and fragile per-device routing. Electron loopback is available directly on Windows.

### Silent background capture

Rejected for legal, privacy, and product-policy reasons. Recording requires a foreground user action and a visible state.