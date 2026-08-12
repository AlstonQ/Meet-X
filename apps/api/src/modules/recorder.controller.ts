import { Controller, Get, Header, Headers } from "@nestjs/common";
import { requirePrototypeSession, renderSaasShell } from "./auth.controller.js";

const recorderBody = String.raw`
<section class="card">
  <p>Browser fallback recorder for microphone or selected tab/screen capture. For Teams/Zoom/Meet system audio without screen sharing, use the Meet-X Desktop Recorder now included in this repository (pnpm desktop:dev).</p>
  <div class="notice">Recording disclosure: this meeting is being recorded by Meet-X. Tell participants before recording. Silent or invisible recording is intentionally not supported.</div>
</section>
<section class="two">
  <div class="card">
    <h2>Meeting metadata</h2>
    <label>Meeting name</label>
    <input id="meetingTitle" placeholder="e.g. Acme discovery call" />
    <label>Audience / participants</label>
    <textarea id="meetingAudience" placeholder="Names or emails, separated by commas or new lines"></textarea>
    <label>Meeting URL</label>
    <input id="meetingUrl" placeholder="Paste Teams, Meet, or Zoom URL if available" />
    <label>Detected source</label>
    <input id="sourceApp" placeholder="Manual / Teams / Meet / Zoom" />
    <label><input id="includeMicrophone" type="checkbox" checked style="width:auto; margin-right:8px" /> Mix microphone into screen/tab recording</label>
    <label for="languageHint">Language</label>
    <select id="languageHint">
      <option value="en" selected>English ? recommended</option>
      <option value="hi">Hindi</option>
      <option value="auto">Auto detect ? experimental</option>
    </select>
    <label for="transcriptionMode">Transcription timing</label>
    <select id="transcriptionMode">
      <option value="live" selected>Live while recording ? recommended</option>
      <option value="post">Process after recording</option>
    </select>
    <label class="consent"><input id="disclosureAcknowledged" type="checkbox" /> I have informed participants that this meeting is being recorded.</label>
    <div class="controls"><button id="detectLocalButton" class="secondary">Detect local meeting</button></div><p class="status" id="detectStatus">Waiting for metadata, selected capture source, or local meeting detection.</p>
  </div>
  <div class="card">
    <h2>Capture controls</h2>
    <div class="controls">
      <button id="audioOnlyButton">Microphone only</button>
      <button id="previewButton" class="secondary">Choose screen/window/tab</button>
      <button id="startButton" class="secondary" disabled>Start recording</button>
      <button id="stopButton" class="danger" disabled>Stop</button>
      <a id="downloadLink" class="button" hidden>Download recording</a>
      <a id="meetingLink" class="button secondary" hidden>Open transcript & summary</a>
      <a class="button secondary" href="/library">Library</a>
    </div>
    <p class="status" id="statusText">Idle. Choose audio-only mic or screen/tab capture.</p>
    <div id="liveTranscriptPanel" class="live-transcript" hidden aria-live="polite">
      <div class="live-heading"><strong>Live transcript</strong><span id="liveTranscriptBadge">Listening</span></div>
      <div id="liveTranscriptBody" class="live-body"><p>Transcript lines appear after the first spoken chunk.</p></div>
      <a id="liveLink" class="button secondary" hidden target="_blank" rel="noreferrer">Open shared live transcript</a>
    </div>
    <video id="preview" autoplay muted playsinline controls></video>
  </div>
</section>
<style>
  .notice { border: 1px solid rgba(36,197,143,.22); border-radius: 20px; padding: 16px; background: #eefaf6; color: #147a5a; }
  .controls { display: flex; flex-wrap: wrap; gap: 12px; margin: 14px 0; }
  button.danger { background: #ff3b30; color: #fff; box-shadow: 0 10px 24px rgba(255,59,48,.18); }
  button:disabled { cursor: not-allowed; opacity: 0.45; }
  label { display: block; margin: 14px 0 6px; color: #424245; font-weight: 800; font-size: 13px; }
  input, textarea, select { box-sizing: border-box; width: 100%; border: 1px solid rgba(0,0,0,.08); border-radius: 16px; padding: 13px 14px; background: rgba(255,255,255,.78); color: #1d1d1f; font: inherit; }
  textarea { min-height: 110px; resize: vertical; }
  .consent { display: flex; align-items: flex-start; gap: 9px; font-weight: 650; line-height: 1.45; }
  .consent input { width: auto; margin-top: 3px; accent-color: #7257e8; }
  .live-transcript { margin-top: 16px; border: 1px solid #ded5ff; border-radius: 18px; background: #faf9ff; overflow: hidden; }
  .live-heading { display: flex; justify-content: space-between; gap: 12px; padding: 13px 15px; border-bottom: 1px solid #e9e4ff; }
  .live-heading span { color: #08794e; background: #e8f8f0; border-radius: 999px; padding: 5px 9px; font-size: 11px; font-weight: 800; }
  .live-body { max-height: 230px; overflow-y: auto; padding: 6px 15px 12px; }
  .live-line { display: grid; grid-template-columns: 44px 1fr; gap: 9px; padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,.06); }
  .live-line time { color: #7257e8; font-size: 11px; } .live-line p { margin: 0; line-height: 1.5; } .live-transcript .button { margin: 0 15px 15px; }
</style>
<script>
  const audioOnlyButton = document.getElementById("audioOnlyButton");
  const previewButton = document.getElementById("previewButton");
  const startButton = document.getElementById("startButton");
  const stopButton = document.getElementById("stopButton");
  const downloadLink = document.getElementById("downloadLink");
  const meetingLink = document.getElementById("meetingLink");
  const statusText = document.getElementById("statusText");
  const detectStatus = document.getElementById("detectStatus");
  const preview = document.getElementById("preview");
  const meetingTitle = document.getElementById("meetingTitle");
  const meetingAudience = document.getElementById("meetingAudience");
  const meetingUrl = document.getElementById("meetingUrl");
  const sourceApp = document.getElementById("sourceApp");
  const includeMicrophone = document.getElementById("includeMicrophone");
  const detectLocalButton = document.getElementById("detectLocalButton");
  const languageHint = document.getElementById("languageHint");
  const transcriptionMode = document.getElementById("transcriptionMode");
  const disclosureAcknowledged = document.getElementById("disclosureAcknowledged");
  const liveTranscriptPanel = document.getElementById("liveTranscriptPanel");
  const liveTranscriptBadge = document.getElementById("liveTranscriptBadge");
  const liveTranscriptBody = document.getElementById("liveTranscriptBody");
  const liveLink = document.getElementById("liveLink");
  let stream;
  let displayStream;
  let microphoneStream;
  let audioContext;
  let recorder;
  let captureMode = "screen";
  let chunks = [];
  let startedAt = 0;
  const LIVE_CHUNK_MS = 10000;
  let liveSessionId = "";
  let liveRecorder;
  let liveRecorderStopPromise = Promise.resolve();
  let liveChunkTimer;
  let liveQueue = Promise.resolve();
  let livePending = 0;
  let liveChunkIndex = 0;
  let liveSegments = [];
  let liveError = "";
  let isStopping = false;
  let liveMimeType = "audio/webm";

  function setStatus(message) { statusText.textContent = message; }
  function setDetectStatus(message) { detectStatus.textContent = message; }

  function sourceFromText(value) {
    const text = value.toLowerCase();
    if (text.includes("teams.microsoft") || text.includes("msteams") || text.includes("teams")) { return "Microsoft Teams"; }
    if (text.includes("meet.google") || text.includes("google meet")) { return "Google Meet"; }
    if (text.includes("zoom.us") || text.includes("zoom")) { return "Zoom"; }
    return "";
  }

  function defaultTitleFor(source) {
    const stamp = new Date().toLocaleString();
    return source ? source + " meeting " + stamp : "Local recording " + stamp;
  }

  function stopPreparedStreams() {
    for (const track of stream?.getTracks() ?? []) { track.stop(); }
    for (const track of displayStream?.getTracks() ?? []) { track.stop(); }
    for (const track of microphoneStream?.getTracks() ?? []) { track.stop(); }
    audioContext?.close().catch(() => undefined);
    stream = undefined;
    displayStream = undefined;
    microphoneStream = undefined;
    audioContext = undefined;
  }

  function updateStartAvailability() {
    const recordingActive = recorder?.state === "recording" || recorder?.state === "paused";
    const liveNeedsAudio = transcriptionMode.value === "live" && Boolean(stream) && stream.getAudioTracks().length === 0;
    startButton.disabled = !stream || !disclosureAcknowledged.checked || liveNeedsAudio || recordingActive || isStopping;
  }

  function formatLiveTime(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }

  function renderLiveTranscript() {
    liveTranscriptBody.replaceChildren();
    if (liveSegments.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = liveError || "Listening for speech. Transcript lines appear after each 10-second chunk.";
      liveTranscriptBody.append(empty);
      return;
    }
    for (const segment of liveSegments) {
      const row = document.createElement("div");
      row.className = "live-line";
      const time = document.createElement("time");
      time.textContent = formatLiveTime(segment.startMs);
      const text = document.createElement("p");
      text.textContent = segment.text;
      row.append(time, text);
      liveTranscriptBody.append(row);
    }
    liveTranscriptBody.scrollTop = liveTranscriptBody.scrollHeight;
  }

  function updateLiveBadge() {
    if (liveError) {
      liveTranscriptBadge.textContent = "Post-processing fallback ready";
    } else if (livePending > 0) {
      liveTranscriptBadge.textContent = "Transcribing ? " + livePending + " queued";
    } else {
      liveTranscriptBadge.textContent = "Live ? " + liveSegments.length + " lines";
    }
  }

  function createLiveSessionId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return "cap_" + Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    if (!response.ok) {
      const message = typeof payload.message === "string" ? payload.message : text || ("Request failed with status " + response.status);
      throw new Error(message);
    }
    return payload;
  }

  async function beginLiveTranscription(isScreenVideo) {
    liveSessionId = createLiveSessionId();
    liveChunkIndex = 0;
    liveSegments = [];
    livePending = 0;
    liveError = "";
    liveQueue = Promise.resolve();
    renderLiveTranscript();
    updateLiveBadge();
    const payload = await requestJson("/api/live-transcription/" + encodeURIComponent(liveSessionId) + "/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: meetingTitle.value.trim() || defaultTitleFor(sourceApp.value),
        audience: meetingAudience.value.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean),
        sourceApp: sourceApp.value.trim() || "Browser recorder",
        languageHint: languageHint.value,
        screenVideo: isScreenVideo
      })
    });
    liveLink.href = payload.liveUrl;
    liveLink.hidden = false;
    liveTranscriptPanel.hidden = false;
  }

  function enqueueLiveBlob(blob, input) {
    livePending += 1;
    updateLiveBadge();
    liveQueue = liveQueue.then(async () => {
      try {
        const payload = await requestJson("/api/live-transcription/" + encodeURIComponent(input.sessionId) + "/chunks", {
          method: "POST",
          headers: {
            "Content-Type": liveMimeType,
            "X-Chunk-Index": String(input.chunkIndex),
            "X-Start-Ms": String(input.startMs),
            "X-Duration-Ms": String(input.durationMs),
            "X-Language-Hint": languageHint.value
          },
          body: blob
        });
        if (Array.isArray(payload.segments) && payload.segments.length > 0) {
          liveSegments = [...liveSegments, ...payload.segments].sort((left, right) => left.startMs - right.startMs);
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
    if (!liveSessionId || isStopping || recorder?.state !== "recording" || !stream || stream.getAudioTracks().length === 0) { return; }
    const sessionId = liveSessionId;
    const chunkIndex = liveChunkIndex;
    liveChunkIndex += 1;
    const chunkStartMs = Math.max(0, Date.now() - startedAt);
    const chunkStartedAt = Date.now();
    const parts = [];
    liveMimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const chunkRecorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { mimeType: liveMimeType });
    let resolveStop;
    liveRecorderStopPromise = new Promise((resolve) => { resolveStop = resolve; });
    liveRecorder = chunkRecorder;
    chunkRecorder.addEventListener("dataavailable", (event) => { if (event.data.size > 0) { parts.push(event.data); } });
    chunkRecorder.addEventListener("stop", () => {
      clearTimeout(liveChunkTimer);
      liveChunkTimer = undefined;
      const blob = new Blob(parts, { type: liveMimeType });
      const durationMs = Math.max(250, Date.now() - chunkStartedAt);
      if (blob.size > 0) { enqueueLiveBlob(blob, { sessionId, chunkIndex, startMs: chunkStartMs, durationMs }); }
      if (liveRecorder === chunkRecorder) { liveRecorder = undefined; liveRecorderStopPromise = Promise.resolve(); }
      resolveStop();
      if (!isStopping && recorder?.state === "recording") { startLiveChunk(); }
    }, { once: true });
    chunkRecorder.start();
    liveChunkTimer = setTimeout(() => { if (chunkRecorder.state !== "inactive") { chunkRecorder.stop(); } }, LIVE_CHUNK_MS);
  }

  function stopCurrentLiveChunk() {
    clearTimeout(liveChunkTimer);
    liveChunkTimer = undefined;
    const pendingStop = liveRecorderStopPromise;
    if (liveRecorder && liveRecorder.state !== "inactive") { liveRecorder.stop(); }
    return pendingStop;
  }

  async function processUploadedMeeting(meetingId) {
    const processPostRecording = async (mode) => {
      const processed = await requestJson("/api/meetings/" + encodeURIComponent(meetingId) + "/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ languageHint: languageHint.value })
      });
      if (liveSessionId) {
        await requestJson("/api/live-transcription/" + encodeURIComponent(liveSessionId) + "/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingId, mode })
        }).catch(() => undefined);
      }
      return processed;
    };

    if (transcriptionMode.value === "live" && liveSessionId && liveSegments.length > 0) {
      try {
        return await requestJson("/api/live-transcription/" + encodeURIComponent(liveSessionId) + "/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingId })
        });
      } catch {
        setStatus("Live transcript could not be finalized. Processing the full recording instead...");
        return processPostRecording("post_fallback");
      }
    }
    return processPostRecording(liveSessionId ? "post_fallback" : "post");
  }

  function inferFromMeetingUrl() {
    const detected = sourceFromText(meetingUrl.value);
    if (detected && !sourceApp.value) { sourceApp.value = detected; }
    if (detected && !meetingTitle.value) { meetingTitle.value = defaultTitleFor(detected); }
    if (detected) { setDetectStatus("Detected " + detected + " from meeting URL."); }
  }

  function inferFromCaptureTrack() {
    const labels = stream ? stream.getTracks().map((track) => track.label).join(" ") : "";
    const detected = sourceFromText(labels);
    if (detected && !sourceApp.value) { sourceApp.value = detected; }
    if (detected && !meetingTitle.value) { meetingTitle.value = defaultTitleFor(detected); }
    setDetectStatus(detected ? "Detected " + detected + " from selected capture source." : "Could not infer meeting app. Please fill metadata manually.");
  }

  function prefillFromUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const title = params.get("title");
    const url = params.get("meetingUrl");
    const audience = params.get("audience");
    if (title) { meetingTitle.value = title; }
    if (url) { meetingUrl.value = url; }
    if (audience) { meetingAudience.value = audience; }
    inferFromMeetingUrl();
  }

  detectLocalButton.addEventListener("click", async () => {
    setDetectStatus("Scanning local app windows...");
    try {
      const response = await fetch("/api/local-agent/meetings");
      if (!response.ok) { throw new Error("Detection failed with status " + response.status); }
      const payload = await response.json();
      const candidate = payload.candidates?.[0];
      if (!candidate) { setDetectStatus(payload.note || "No local meeting detected."); return; }
      if (!sourceApp.value) { sourceApp.value = candidate.sourceApp; }
      if (!meetingTitle.value) { meetingTitle.value = candidate.title; }
      setDetectStatus("Detected " + candidate.sourceApp + ": " + candidate.title);
    } catch (error) {
      setDetectStatus("Local detection unavailable: " + error.message);
    }
  });

  meetingUrl.addEventListener("input", inferFromMeetingUrl);
  prefillFromUrlParams();
  const defaultAudience = localStorage.getItem("meetx.settings.defaultAudience");
  if (defaultAudience && !meetingAudience.value) { meetingAudience.value = defaultAudience; }

  audioOnlyButton.addEventListener("click", async () => {
    try {
      stopPreparedStreams();
      downloadLink.hidden = true;
      meetingLink.hidden = true;
      captureMode = "audio";
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      stream = microphoneStream;
      preview.srcObject = null;
      if (!sourceApp.value) { sourceApp.value = "Microphone audio"; }
      if (!meetingTitle.value) { meetingTitle.value = defaultTitleFor(sourceApp.value); }
      updateStartAvailability();
      setStatus("Audio-only mic ready. Start recording when participants have been informed.");
    } catch (error) {
      setStatus("Microphone permission cancelled or unavailable: " + error.message);
    }
  });

  previewButton.addEventListener("click", async () => {
    try {
      stopPreparedStreams();
      downloadLink.hidden = true;
      meetingLink.hidden = true;
      captureMode = "screen";
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      microphoneStream = undefined;
      if (includeMicrophone.checked) {
        try {
          microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false
          });
        } catch (error) {
          setStatus("Screen selected, but microphone permission was denied. Recording will continue with selected source audio only.");
        }
      }
      const tracks = [...displayStream.getVideoTracks()];
      const audioTracks = [...displayStream.getAudioTracks(), ...(microphoneStream?.getAudioTracks() ?? [])];
      if (audioTracks.length > 1) {
        audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        for (const audioTrack of audioTracks) {
          const singleTrackStream = new MediaStream([audioTrack]);
          const source = audioContext.createMediaStreamSource(singleTrackStream);
          source.connect(destination);
        }
        tracks.push(...destination.stream.getAudioTracks());
      } else {
        tracks.push(...audioTracks);
      }
      stream = new MediaStream(tracks);
      preview.srcObject = stream;
      inferFromCaptureTrack();
      if (!meetingTitle.value) { meetingTitle.value = defaultTitleFor(sourceApp.value); }
      updateStartAvailability();
      setStatus("Preview ready. Start recording when participants have been informed.");
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorder?.state === "recording") { stopButton.click(); }
      });
    } catch (error) {
      setStatus("Permission cancelled or capture unavailable: " + error.message);
    }
  });

  startButton.addEventListener("click", async () => {
    if (!stream) { setStatus("Choose microphone-only or screen/window/tab capture first."); return; }
    if (!disclosureAcknowledged.checked) { setStatus("Confirm that participants were informed before recording."); return; }
    if (transcriptionMode.value === "live" && stream.getAudioTracks().length === 0) { setStatus("Live transcription needs microphone or shared system/tab audio."); return; }
    if (!meetingTitle.value.trim()) { meetingTitle.value = defaultTitleFor(sourceApp.value); }
    chunks = [];
    isStopping = false;
    liveSessionId = "";
    liveSegments = [];
    liveError = "";
    liveLink.hidden = true;
    liveTranscriptPanel.hidden = transcriptionMode.value !== "live";
    renderLiveTranscript();
    updateLiveBadge();
    const isAudioOnly = captureMode === "audio" && stream.getVideoTracks().length === 0;
    const audioMimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const videoMimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
    const mimeType = isAudioOnly ? audioMimeType : videoMimeType;
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) { chunks.push(event.data); }
    });
    recorder.addEventListener("stop", async () => {
      await stopCurrentLiveChunk();
      await liveQueue;
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const url = URL.createObjectURL(blob);
      const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadLink.href = url;
      downloadLink.download = (isAudioOnly ? "meet-x-audio-" : "meet-x-recording-") + safeTimestamp + ".webm";
      downloadLink.hidden = false;
      startButton.disabled = true;
      stopButton.disabled = true;
      previewButton.disabled = false;
      audioOnlyButton.disabled = false;
      setStatus("Recording stopped. Uploading to local Meet-X library...");
      try {
        const response = await fetch("/api/recordings", {
          method: "POST",
          headers: {
            "Content-Type": blob.type || mimeType,
            "X-MeetX-Encoded-Metadata": "1",
            "X-Meeting-Title": encodeURIComponent(meetingTitle.value.trim() || defaultTitleFor(sourceApp.value)),
            "X-Meeting-Audience": encodeURIComponent(meetingAudience.value.trim()),
            "X-Meeting-Url": encodeURIComponent(meetingUrl.value.trim()),
            "X-Source-App": encodeURIComponent(sourceApp.value.trim() || (isAudioOnly ? "Microphone audio" : "Manual capture")),
            "X-File-Name": downloadLink.download
          },
          body: blob
        });
        if (!response.ok) { throw new Error("Upload failed with status " + response.status); }
        const payload = await response.json();
        meetingLink.href = payload.detailUrl;
        meetingLink.hidden = false;
        setStatus("Recording uploaded. Building transcript and summary...");
        const processing = await processUploadedMeeting(payload.meetingId);
        if (processing.status === "processed") { setStatus("Transcript and summary ready. This meeting is now in your Meeting Library."); }
        else { setStatus("Recording saved. Open the meeting to review processing status."); }
      } catch (error) {
        const uploadFailed = meetingLink.hidden;
        setStatus(uploadFailed ? "Recording saved locally, but upload failed: " + error.message : "Recording uploaded, but transcription failed: " + error.message);
      } finally {
        recorder = undefined;
        isStopping = false;
        languageHint.disabled = false;
        transcriptionMode.disabled = false;
        updateStartAvailability();
      }
    });
    if (transcriptionMode.value === "live") {
      setStatus("Preparing shared live transcript...");
      try {
        await beginLiveTranscription(!isAudioOnly);
      } catch (error) {
        liveSessionId = "";
        liveError = error.message;
        liveTranscriptPanel.hidden = false;
        renderLiveTranscript();
        updateLiveBadge();
      }
    }
    startedAt = Date.now();
    recorder.start(1000);
    if (liveSessionId) { startLiveChunk(); }
    startButton.disabled = true;
    stopButton.disabled = false;
    previewButton.disabled = true;
    audioOnlyButton.disabled = true;
    languageHint.disabled = true;
    transcriptionMode.disabled = true;
    setStatus(liveSessionId ? "Recording with live transcript... elapsed 00:00" : "Recording... transcript will process after stop.");
  });

  stopButton.addEventListener("click", async () => {
    if (recorder?.state === "recording") {
      isStopping = true;
      stopButton.disabled = true;
      setStatus("Stopping recording and finishing transcript...");
      await stopCurrentLiveChunk();
      recorder.stop();
      stopPreparedStreams();
    }
  });

  disclosureAcknowledged.addEventListener("change", updateStartAvailability);
  transcriptionMode.addEventListener("change", () => {
    if (transcriptionMode.value === "post" && recorder?.state !== "recording") { liveTranscriptPanel.hidden = true; }
    updateStartAvailability();
  });

  setInterval(() => {
    if (recorder?.state !== "recording") { return; }
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
    const seconds = String(elapsedSeconds % 60).padStart(2, "0");
    setStatus((liveSessionId ? "Recording with live transcript... elapsed " : "Recording... elapsed ") + minutes + ":" + seconds);
  }, 500);
</script>`;

@Controller()
export class RecorderController {
  @Get("/recorder")
  @Header("Content-Type", "text/html; charset=utf-8")
  recorder(@Headers("cookie") cookieHeader: string | undefined): string {
    const session = requirePrototypeSession(cookieHeader);
    return renderSaasShell({
      title: "Recorder",
      active: "recorder",
      session,
      body: recorderBody
    });
  }
}