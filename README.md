# Meet-X

Meet-X is a consent-first meeting recorder and intelligence workspace. The current vertical slice records Windows system audio plus microphone audio, detects Teams/Zoom/Google Meet, uploads to the local SaaS library, and processes English/Hindi audio with local multilingual Whisper.

## Prerequisites

- Windows 10 or 11 for system-audio loopback
- Node.js 22 LTS
- pnpm 9 or newer
- Docker Desktop only when testing Postgres, Redis, and MinIO

## Start the substantial local experience

Install dependencies once:

~~~powershell
pnpm install
~~~

Start the SaaS/API in one PowerShell window:

~~~powershell
pnpm --filter @meet-x/api dev
~~~

Start the native desktop recorder in another PowerShell window:

~~~powershell
pnpm desktop:dev
~~~

The desktop app opens automatically. It saves a recovery copy on the device even if the API upload fails.

## Test a real meeting

1. Start or join a Teams, Zoom, or Google Meet call.
2. Open Meet-X Desktop Recorder and select Detect again.
3. Check that meeting title and source are prefilled; add the audience now or after recording.
4. Leave System audio and Microphone selected.
5. Tell participants the meeting is being recorded, then check the disclosure confirmation.
6. Optionally enable Screen video, choose an Entire screen or App window source, then select Start recording. Audio-only recording does not save screen video.
7. Choose Live while recording to see rolling local Whisper results during the call, or Process after recording for a full-file pass.
8. Speak for at least 20 seconds. English is the recommended default; select Hindi explicitly for Hindi meetings. Auto detection is experimental and rejects languages outside English/Hindi.
9. In live mode, confirm transcript lines and the queued/transcribing badge update. Open Shared live transcript to follow the same session at `/live` on web or mobile, then select Stop & save. In post mode, select Stop & process.
10. Open transcript & summary. The local SaaS meeting page should contain the real recording, transcript segments, cited summary, metadata editor, timestamped notes, and delete action.

SaaS URLs:

- App: http://localhost:3001/app
- Recorder: http://localhost:3001/recorder (same Live/Post transcription choices; browser-native screen/window/tab picker)
- Library: http://localhost:3001/library
- Health: http://localhost:3001/health

## Validation commands

~~~powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm phase1:harness
pnpm phase2:harness
~~~

## Repo map

- apps/api — NestJS SaaS and local upload/processing API.
- apps/desktop-agent — Electron Windows system-audio recorder.
- apps/extension — Chrome extension track, still deferred.
- packages/capture-sdk — capture provider contracts and DesktopSdkProvider.
- services/capture-orchestrator — capture policy and meeting lifecycle.
- services/transcription — multilingual local Whisper and cited summaries.
- packages/db — Drizzle schema and Postgres RLS migration.
- docs — architecture, ADRs, roadmap, and compliance notes.

## Current boundaries

Implemented:

- Visible consent gate; no silent recording.
- Windows meeting detection from local process/window signals.
- Windows loopback system audio with optional explicit entire-screen or application-window video.
- Shared live/post transcription behavior across desktop and web, plus responsive live-transcript pages for mobile viewers.
- Optional microphone mixing.
- Streamed recovery file and streamed API upload.
- Metadata prefill and post-recording edits.
- English/Hindi multilingual Whisper processing.
- Cited summary, transcript-seek playback, notes, search, and deletion.
- Contract-tested DesktopSdkProvider.

Still required before production distribution:

- Signed Windows installer and automatic updates.
- Resumable encrypted cloud-object upload instead of localhost upload.
- Production auth, tenant-backed storage, and immutable consent audit rows.
- Speaker diarisation and quality benchmark corpus.
- Chrome MV3 recorder and calendar sync.


