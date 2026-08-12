const elements = {
  apiPill: document.getElementById("apiPill"),
  recordingPill: document.getElementById("recordingPill"),
  detectButton: document.getElementById("detectButton"),
  detectedMeeting: document.getElementById("detectedMeeting"),
  meetingTitle: document.getElementById("meetingTitle"),
  meetingAudience: document.getElementById("meetingAudience"),
  sourceApp: document.getElementById("sourceApp"),
  languageHint: document.getElementById("languageHint"),
  meetingUrl: document.getElementById("meetingUrl"),
  systemAudio: document.getElementById("systemAudio"),
  microphone: document.getElementById("microphone"),
  screenVideo: document.getElementById("screenVideo"),
  displaySourcePicker: document.getElementById("displaySourcePicker"),
  displaySource: document.getElementById("displaySource"),
  displaySourceGrid: document.getElementById("displaySourceGrid"),
  refreshSourcesButton: document.getElementById("refreshSourcesButton"),
  disclosureAcknowledged: document.getElementById("disclosureAcknowledged"),
  transcriptionMode: document.getElementById("transcriptionMode"),
  transcriptionHelp: document.getElementById("transcriptionHelp"),
  liveTranscriptPanel: document.getElementById("liveTranscriptPanel"),
  liveTranscriptBadge: document.getElementById("liveTranscriptBadge"),
  liveTranscriptBody: document.getElementById("liveTranscriptBody"),
  startButton: document.getElementById("startButton"),
  pauseButton: document.getElementById("pauseButton"),
  stopButton: document.getElementById("stopButton"),
  timer: document.getElementById("timer"),
  statusCard: document.getElementById("statusCard"),
  statusTitle: document.getElementById("statusTitle"),
  statusText: document.getElementById("statusText"),
  openLiveButton: document.getElementById("openLiveButton"),
  liveUrl: document.getElementById("liveUrl"),
  openMeetingButton: document.getElementById("openMeetingButton"),
  openSaasButton: document.getElementById("openSaasButton"),
  localFile: document.getElementById("localFile")
};

const LIVE_CHUNK_MS = 10_000;
let mediaRecorder = null;
let recordingSessionId = null;
let displayStream = null;
let microphoneStream = null;
let mixedStream = null;
let archiveStream = null;
let audioContext = null;
let appendQueue = Promise.resolve();
let liveRecorder = null;
let liveRecorderStopPromise = null;
let liveChunkTimer = null;
let liveQueue = Promise.resolve();
let livePending = 0;
let liveChunkIndex = 0;
let liveSegments = [];
let liveError = "";
let startedAt = 0;
let timerHandle = null;
let detectedTitle = "";
let meetingDetailUrl = "";
let livePageUrl = "";
let liveMime = "audio/webm";
let archiveMime = "audio/webm";
let isStopping = false;

function setStatus(kind, title, text) {
  elements.statusCard.className = "status-card" + (kind ? " " + kind : "");
  elements.statusTitle.textContent = title;
  elements.statusText.textContent = text;
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours + ":" + minutes + ":" + remainder;
}

function speakerName(id) {
  if (id === "speaker_user") return "You";
  const numbered = /^speaker_(\d+)$/u.exec(id || "");
  if (numbered) return "Speaker " + numbered[1];
  if (id && id.startsWith("speaker_")) {
    return id.slice(8).split("_").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }
  return id || "Speaker";
}
function formatTimestamp(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return minutes + ":" + remainder;
}

function hasAudioSource() {
  return elements.systemAudio.checked || elements.microphone.checked;
}

function renderDisplaySources() {
  elements.displaySourceGrid.replaceChildren();
  const info = document.createElement("div");
  info.className = "source-preview-empty source-system-picker";
  info.innerHTML = "<strong>Native picker opens on Start recording.</strong><span>Choose Entire screen, Window, or browser tab in the same system picker used by screen sharing apps.</span>";
  elements.displaySourceGrid.append(info);
  elements.displaySource.value = "system-picker";
}
async function loadDisplaySources() {
  elements.displaySourcePicker.classList.toggle("hidden", !elements.screenVideo.checked);
  renderDisplaySources();
  elements.displaySourceHint.textContent = "Click Start recording, then choose Entire screen, Window, or browser tab in the native picker.";
  updateStartAvailability();

}function updateStartAvailability() {
  const hasCaptureSource = hasAudioSource() || elements.screenVideo.checked;
  const liveNeedsAudio = elements.transcriptionMode.value === "live" && !hasAudioSource();
  elements.startButton.disabled = !elements.disclosureAcknowledged.checked || !hasCaptureSource || liveNeedsAudio || Boolean(recordingSessionId);
  if (!recordingSessionId && !elements.disclosureAcknowledged.checked) {
    setStatus("", "Ready when you are", "Confirm participant disclosure to enable recording.");
  } else if (!recordingSessionId && !hasCaptureSource) {
    setStatus("error", "Choose a capture source", "Enable system audio, microphone, screen video, or a combination.");  } else if (!recordingSessionId && liveNeedsAudio) {
    setStatus("error", "Live transcript needs audio", "Enable system audio or microphone, or choose post-recording processing.");
  } else if (!recordingSessionId) {
    setStatus("", "Ready to record", elements.screenVideo.checked ? "Screen video and selected audio sources will be saved." : "Audio-only recording is ready; no screen video will be saved.");
  }
}

function updateTranscriptionModeUI() {
  const isLive = elements.transcriptionMode.value === "live";
  elements.transcriptionHelp.textContent = isLive
    ? "Rolling local Whisper transcription appears here and on the Live meetings web page, usually 10-20 seconds behind."
    : "The full recording is transcribed after upload. This is slower but gives Whisper the most context.";
  elements.stopButton.textContent = isLive ? "Stop & save" : "Stop & process";
  if (!recordingSessionId) elements.liveTranscriptPanel.classList.add("hidden");
  updateStartAvailability();
}

function metadata() {
  return {
    title: elements.meetingTitle.value.trim(),
    audience: elements.meetingAudience.value.trim(),
    meetingUrl: elements.meetingUrl.value.trim(),
    sourceApp: elements.sourceApp.value.trim(),
    languageHint: elements.languageHint.value,
    systemAudio: elements.systemAudio.checked,
    microphone: elements.microphone.checked,
    screenVideo: elements.screenVideo.checked,
    displaySourceId: elements.screenVideo.checked ? "system-picker" : "",
    disclosureAcknowledged: elements.disclosureAcknowledged.checked,
    transcriptionMode: elements.transcriptionMode.value
  };
}

function setCaptureInputsDisabled(disabled) {
  elements.systemAudio.disabled = disabled;
  elements.microphone.disabled = disabled;
  elements.screenVideo.disabled = disabled;
  elements.displaySource.disabled = disabled;
  elements.refreshSourcesButton.disabled = disabled;
  elements.languageHint.disabled = disabled;
  elements.transcriptionMode.disabled = disabled;
}

function stopMediaTracks() {
  const seen = new Set();
  for (const stream of [displayStream, microphoneStream, mixedStream, archiveStream]) {
    if (!stream) continue;
    for (const track of stream.getTracks()) {
      if (!seen.has(track.id)) {
        seen.add(track.id);
        track.stop();
      }
    }
  }
  displayStream = null;
  microphoneStream = null;
  mixedStream = null;
  archiveStream = null;
}

function resetRecordingControls(preserveStatus) {
  clearInterval(timerHandle);
  clearTimeout(liveChunkTimer);
  timerHandle = null;
  liveChunkTimer = null;
  elements.recordingPill.classList.add("hidden");
  elements.pauseButton.classList.add("hidden");
  elements.stopButton.classList.add("hidden");
  elements.startButton.classList.remove("hidden");
  elements.startButton.disabled = false;
  elements.pauseButton.textContent = "Pause";
  elements.timer.textContent = "00:00:00";
  setCaptureInputsDisabled(false);
  isStopping = false;
  updateTranscriptionModeUI();
  if (!preserveStatus) updateStartAvailability();
}

function renderLiveTranscript() {
  elements.liveTranscriptBody.replaceChildren();
  if (liveSegments.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = liveError || "Listening for speech. Transcript lines appear after each 10-second chunk.";
    elements.liveTranscriptBody.append(empty);
    return;
  }
  for (const segment of liveSegments) {
    const row = document.createElement("div");
    row.className = "live-line";
    const time = document.createElement("span");
    time.textContent = formatTimestamp(segment.startMs);
    const text = document.createElement("p");
    text.textContent = speakerName(segment.speakerId) + ": " + segment.text;
    row.append(time, text);
    elements.liveTranscriptBody.append(row);
  }
  elements.liveTranscriptBody.scrollTop = elements.liveTranscriptBody.scrollHeight;
}

function updateLiveBadge() {
  if (liveError) {
    elements.liveTranscriptBadge.textContent = "Fallback available";
    elements.liveTranscriptBadge.className = "warning";
  } else if (livePending > 0) {
    elements.liveTranscriptBadge.textContent = "Transcribing - " + livePending + " queued";
    elements.liveTranscriptBadge.className = "working";
  } else {
    elements.liveTranscriptBadge.textContent = "Live - listening";
    elements.liveTranscriptBadge.className = "";
  }
}

function enqueueLiveBlob(blob, input) {
  livePending += 1;
  updateLiveBadge();
  liveQueue = liveQueue.then(async () => {
    try {
      const bytes = await blob.arrayBuffer();
      const result = await window.meetxDesktop.transcribeLiveChunk(input.sessionId, {
        bytes,
        chunkIndex: input.chunkIndex,
        startMs: input.startMs,
        durationMs: input.durationMs,
        languageHint: elements.languageHint.value
      });
      if (Array.isArray(result.segments) && result.segments.length > 0) {
        liveSegments = [...liveSegments, ...result.segments].sort((left, right) => left.startMs - right.startMs);
        renderLiveTranscript();
      }
    } catch (error) {
      liveError = error.message;
      renderLiveTranscript();
    } finally {
      livePending = Math.max(0, livePending - 1);
      updateLiveBadge();
    }
  });
  return liveQueue;
}

function startLiveChunk() {
  if (
    elements.transcriptionMode.value !== "live" ||
    !mixedStream ||
    !recordingSessionId ||
    isStopping ||
    !mediaRecorder ||
    mediaRecorder.state !== "recording"
  ) return;

  const sessionId = recordingSessionId;
  const chunkIndex = liveChunkIndex;
  liveChunkIndex += 1;
  const chunkStartMs = Math.max(0, Date.now() - startedAt);
  const chunkStartedAt = Date.now();
  const parts = [];
  const recorder = new MediaRecorder(mixedStream, { mimeType: liveMime });
  let resolveStop;
  const stopPromise = new Promise((resolve) => { resolveStop = resolve; });
  liveRecorder = recorder;
  liveRecorderStopPromise = stopPromise;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) parts.push(event.data);
  });
  recorder.addEventListener("error", (event) => {
    liveError = event.error ? event.error.message : "Live audio chunk failed.";
    renderLiveTranscript();
    updateLiveBadge();
  });
  recorder.addEventListener("stop", () => {
    clearTimeout(liveChunkTimer);
    liveChunkTimer = null;
    const durationMs = Math.max(250, Date.now() - chunkStartedAt);
    const blob = new Blob(parts, { type: liveMime });
    if (blob.size > 0) enqueueLiveBlob(blob, { sessionId, chunkIndex, startMs: chunkStartMs, durationMs });
    if (liveRecorder === recorder) {
      liveRecorder = null;
      liveRecorderStopPromise = null;
    }
    resolveStop();
    if (!isStopping && mediaRecorder && mediaRecorder.state === "recording") startLiveChunk();
  }, { once: true });

  recorder.start();
  liveChunkTimer = setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
  }, LIVE_CHUNK_MS);
}

function stopCurrentLiveChunk() {
  clearTimeout(liveChunkTimer);
  liveChunkTimer = null;
  const recorder = liveRecorder;
  const stopPromise = liveRecorderStopPromise || Promise.resolve();
  if (recorder && recorder.state !== "inactive") recorder.stop();
  return stopPromise;
}

async function detectMeeting() {
  elements.detectButton.disabled = true;
  elements.detectButton.textContent = "Detecting...";
  try {
    const result = await window.meetxDesktop.detectMeetings();
    const candidate = result.candidates && result.candidates[0];
    if (!candidate) {
      elements.detectedMeeting.className = "detected empty";
      elements.detectedMeeting.querySelector("strong").textContent = "No active meeting detected";
      elements.detectedMeeting.querySelector("p").textContent = result.note;
      return;
    }
    elements.detectedMeeting.className = "detected";
    elements.detectedMeeting.querySelector("strong").textContent = candidate.sourceApp;
    elements.detectedMeeting.querySelector("p").textContent = candidate.title + " - " + candidate.reason;
    if (!elements.meetingTitle.value.trim() || elements.meetingTitle.value === detectedTitle) {
      elements.meetingTitle.value = candidate.title;
      detectedTitle = candidate.title;
    }
    if (!elements.sourceApp.value.trim()) elements.sourceApp.value = candidate.sourceApp;
  } catch (error) {
    elements.detectedMeeting.className = "detected empty";
    elements.detectedMeeting.querySelector("strong").textContent = "Detection unavailable";
    elements.detectedMeeting.querySelector("p").textContent = error.message;
  } finally {
    elements.detectButton.disabled = false;
    elements.detectButton.textContent = "Detect again";
  }
}

async function initialize() {
  try {
    const status = await window.meetxDesktop.getStatus();
    elements.apiPill.textContent = status.apiAvailable ? "SaaS connected" : "SaaS offline - local save active";
    elements.apiPill.className = "pill " + (status.apiAvailable ? "ok" : "bad");
    if (!status.systemAudioAvailable) {
      elements.systemAudio.checked = false;
      elements.systemAudio.disabled = true;
      setStatus("error", "System audio unavailable", "The native loopback recorder currently supports Windows.");
    }
  } catch (error) {
    elements.apiPill.textContent = "Local agent error";
    elements.apiPill.className = "pill bad";
    setStatus("error", "Desktop agent could not initialize", error.message);
  }
  updateTranscriptionModeUI();
  await loadDisplaySources();
  await detectMeeting();
  setInterval(() => { if (!recordingSessionId) detectMeeting(); }, 5000);
}

async function startRecording() {
  const input = metadata();
  elements.startButton.disabled = true;
  setCaptureInputsDisabled(true);
  elements.openLiveButton.classList.add("hidden");
  elements.liveUrl.textContent = "";
  livePageUrl = "";
  setStatus("", "Preparing capture", "Connecting to selected Windows audio and screen sources...");
  try {
    const started = await window.meetxDesktop.beginCapture(input);
    recordingSessionId = started.sessionId;
    livePageUrl = started.liveUrl || "";
    if (livePageUrl) {
      elements.openLiveButton.classList.remove("hidden");
      elements.liveUrl.textContent = "Shared live page: " + livePageUrl + " - On another device, open /live on this Meet-X server.";
    }

    const audioTracks = [];
    let screenTrack;
    if (input.systemAudio || input.screenVideo) {
      displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenTrack = displayStream.getVideoTracks()[0];
      if (input.screenVideo) {
        if (!screenTrack) throw new Error("Windows did not provide a screen-video track.");
        screenTrack.enabled = true;
      } else {
        for (const videoTrack of displayStream.getVideoTracks()) videoTrack.enabled = false;
      }
      if (input.systemAudio) {
        const systemTrack = displayStream.getAudioTracks()[0];
        if (!systemTrack) throw new Error("Windows did not provide a system-audio track.");
        audioTracks.push(systemTrack);
      }
    }

    if (input.microphone) {
      try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
        const microphoneTrack = microphoneStream.getAudioTracks()[0];
        if (microphoneTrack) audioTracks.push(microphoneTrack);
      } catch (error) {
        if (!audioTracks.length && !input.screenVideo) throw error;
        setStatus("", "Microphone unavailable", "Continuing with the remaining selected sources.");
      }
    }

    if (!audioTracks.length && !input.screenVideo) throw new Error("No usable capture source was available.");
    if (audioTracks.length > 0) {
      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      for (const track of audioTracks) {
        const source = audioContext.createMediaStreamSource(new MediaStream([track]));
        source.connect(destination);
      }
      mixedStream = destination.stream;
    }

    const archiveTracks = [];
    if (mixedStream) archiveTracks.push(...mixedStream.getAudioTracks());
    if (input.screenVideo && screenTrack) archiveTracks.push(screenTrack);
    archiveStream = new MediaStream(archiveTracks);

    liveMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    archiveMime = input.screenVideo && MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : input.screenVideo && MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : liveMime;
    mediaRecorder = new MediaRecorder(archiveStream, { mimeType: archiveMime });
    appendQueue = Promise.resolve();
    liveQueue = Promise.resolve();
    livePending = 0;
    liveChunkIndex = 0;
    liveSegments = [];
    liveError = "";
    isStopping = false;
    renderLiveTranscript();
    updateLiveBadge();

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (!event.data || event.data.size === 0 || !recordingSessionId) return;
      const sessionId = recordingSessionId;
      appendQueue = appendQueue
        .then(() => event.data.arrayBuffer())
        .then((bytes) => window.meetxDesktop.appendCapture(sessionId, bytes))
        .catch((error) => setStatus("error", "Local save interrupted", error.message));
    });
    mediaRecorder.addEventListener("stop", finalizeRecording, { once: true });
    mediaRecorder.start(1000);

    startedAt = Date.now();
    elements.startButton.classList.add("hidden");
    elements.pauseButton.classList.remove("hidden");
    elements.stopButton.classList.remove("hidden");
    elements.recordingPill.classList.remove("hidden");
    elements.liveTranscriptPanel.classList.toggle("hidden", input.transcriptionMode !== "live");
    const mediaDescription = input.screenVideo ? "screen video and audio" : "audio";
    setStatus(
      "recording",
      input.transcriptionMode === "live" ? "Recording + shared live transcript" : "Recording is visible",
      input.transcriptionMode === "live"
        ? "Meet-X is saving " + mediaDescription + " while Whisper publishes rolling transcript chunks."
        : "Meet-X is saving " + mediaDescription + " and will transcribe it after you stop."
    );
    startLiveChunk();
    timerHandle = setInterval(() => { elements.timer.textContent = formatElapsed(Date.now() - startedAt); }, 250);
  } catch (error) {
    const failedSessionId = recordingSessionId;
    recordingSessionId = null;
    await stopCurrentLiveChunk();
    stopMediaTracks();
    if (audioContext) await audioContext.close().catch(() => undefined);
    audioContext = null;
    if (failedSessionId) await window.meetxDesktop.cancelCapture(failedSessionId).catch(() => undefined);
    elements.openLiveButton.classList.add("hidden");
    elements.liveUrl.textContent = "";
    resetRecordingControls(false);
    setStatus("error", "Could not start recording", error.message);
  }
}

async function finalizeRecording() {
  const sessionId = recordingSessionId;
  if (!sessionId) return;
  clearInterval(timerHandle);
  timerHandle = null;
  elements.pauseButton.disabled = true;
  elements.stopButton.disabled = true;
  setStatus("", "Saving recording", "Finalizing local media before upload...");

  try {
    await stopCurrentLiveChunk();
    await appendQueue;
    stopMediaTracks();
    if (audioContext) await audioContext.close();
    audioContext = null;
    if (elements.transcriptionMode.value === "live") {
      setStatus("", "Finishing live transcript", livePending > 0 ? "Waiting for " + livePending + " queued Whisper chunk(s)..." : "Saving live transcript and summary...");
      await liveQueue;
    }

    const result = await window.meetxDesktop.finishCapture(sessionId, {
      transcriptionMode: elements.transcriptionMode.value,
      languageHint: elements.languageHint.value
    });
    meetingDetailUrl = result.detailUrl;
    elements.localFile.textContent = "Recovery copy: " + result.localFilePath;
    elements.openMeetingButton.classList.remove("hidden");

    if (result.processing && result.processing.status === "processed") {
      if (result.processing.mode === "post_fallback") {
        setStatus("success", "Transcript and summary ready", "Live chunks needed a fallback, so Meet-X processed the complete recording successfully.");
      } else if (result.processing.mode === "live") {
        setStatus("success", "Live transcript saved", "The recording, shared transcript, and cited summary are ready.");
      } else {
        setStatus("success", "Transcript and summary ready", "The complete recording was processed with multilingual Whisper.");
      }
    } else if (result.processing && result.processing.status === "processing_failed") {
      setStatus("error", "Recording saved; transcription needs attention", "Open the meeting to see the Whisper processing error and retry.");
    } else {
      setStatus("success", "Recording uploaded", "Open the meeting to process or review it.");
    }
  } catch (error) {
    setStatus("error", "Recording kept safely on this device", error.message);
  } finally {
    recordingSessionId = null;
    mediaRecorder = null;
    liveRecorder = null;
    liveRecorderStopPromise = null;
    elements.pauseButton.disabled = false;
    elements.stopButton.disabled = false;
    resetRecordingControls(true);
  }
}

elements.startButton.addEventListener("click", startRecording);
elements.stopButton.addEventListener("click", () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  isStopping = true;
  elements.stopButton.disabled = true;
  mediaRecorder.stop();
});
elements.pauseButton.addEventListener("click", async () => {
  if (!mediaRecorder) return;
  if (mediaRecorder.state === "recording") {
    mediaRecorder.pause();
    await stopCurrentLiveChunk();
    elements.pauseButton.textContent = "Resume";
    setStatus("", "Recording paused", "Media capture and live transcription are paused.");
  } else if (mediaRecorder.state === "paused") {
    mediaRecorder.resume();
    elements.pauseButton.textContent = "Pause";
    setStatus("recording", elements.transcriptionMode.value === "live" ? "Recording + shared live transcript" : "Recording is visible", "Capture resumed.");
    startLiveChunk();
  }
});
elements.detectButton.addEventListener("click", detectMeeting);
elements.disclosureAcknowledged.addEventListener("change", updateStartAvailability);
elements.systemAudio.addEventListener("change", updateStartAvailability);
elements.microphone.addEventListener("change", updateStartAvailability);
elements.refreshSourcesButton.addEventListener("click", loadDisplaySources);
elements.screenVideo.addEventListener("change", async () => {
  elements.displaySourcePicker.classList.toggle("hidden", !elements.screenVideo.checked);
  if (elements.screenVideo.checked) await loadDisplaySources();
  else updateStartAvailability();
});

elements.transcriptionMode.addEventListener("change", updateTranscriptionModeUI);
elements.openLiveButton.addEventListener("click", () => { if (livePageUrl) window.meetxDesktop.openUrl(livePageUrl); });
elements.openMeetingButton.addEventListener("click", () => { if (meetingDetailUrl) window.meetxDesktop.openUrl(meetingDetailUrl); });
elements.openSaasButton.addEventListener("click", () => window.meetxDesktop.openUrl("/library"));

initialize();
