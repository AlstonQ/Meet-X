const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Notification, session, shell } = require("electron");
const { createReadStream } = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { detectMeetings } = require("./services/detection-service.cjs");

const API_ORIGIN = process.env.MEETX_API_ORIGIN || "http://localhost:3001";
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024 * 1024;
const captures = new Map();

let mainWindow;
let recordingSessionId = null;
let selectedDisplaySourceId = null;
let captureArmedUntil = 0;
let isQuitting = false;

app.setName("Meet-X Desktop Recorder");
app.setAppUserModelId("com.meetx.desktop-recorder");

function isTrustedWebContents(webContents) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && webContents && webContents.id === mainWindow.webContents.id);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 820,
    minHeight: 640,
    title: "Meet-X Desktop Recorder",
    backgroundColor: "#f5f5f7",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (!isQuitting && recordingSessionId) {
      event.preventDefault();
      dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Recording in progress",
        message: "Meet-X is recording this meeting.",
        detail: "Stop the recording before closing so the local audio file can be finalized and uploaded.",
        buttons: ["Keep recording"],
        defaultId: 0
      });
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setRecordingWindowState(active) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setAlwaysOnTop(active, "floating");
  mainWindow.setProgressBar(active ? 2 : -1);
  mainWindow.setTitle(active ? "Recording - Meet-X Desktop Recorder" : "Meet-X Desktop Recorder");
}

function recordingRoot() {
  return path.join(app.getPath("userData"), "recordings");
}

async function listDisplaySources() {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: false
  });
  return sources
    .filter((source) => !source.name.toLowerCase().includes("meet-x desktop recorder"))
    .map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith("screen:") ? "screen" : "window",
      thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : ""
    }));
}

function cleanHeader(value) {
  return encodeURIComponent(String(value || "").replace(/[\r\n]/gu, " ").trim().slice(0, 4000));
}

function readJsonResponse(response, resolve, reject) {
  const chunks = [];
  let size = 0;
  response.on("data", (chunk) => {
    size += chunk.length;
    if (size <= 1024 * 1024) chunks.push(chunk);
  });
  response.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (response.statusCode < 200 || response.statusCode >= 300) {
      reject(new Error("Meet-X API returned " + response.statusCode + ": " + raw.slice(0, 300)));
      return;
    }
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch {
      reject(new Error("Meet-X API returned an invalid response."));
    }
  });
}

function requestJson(route, method, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(route, API_ORIGIN);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const transport = target.protocol === "https:" ? https : http;
    const headers = { Accept: "application/json" };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(payload.length);
    }
    const request = transport.request(target, { method, headers }, (response) => readJsonResponse(response, resolve, reject));
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Meet-X API request timed out.")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function requestBinary(route, payload, extraHeaders, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(route, API_ORIGIN);
    const transport = target.protocol === "https:" ? https : http;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const headers = {
      Accept: "application/json",
      "Content-Length": String(body.length),
      ...extraHeaders
    };
    const request = transport.request(target, { method: "POST", headers }, (response) => readJsonResponse(response, resolve, reject));
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Live transcription request timed out.")));
    request.on("error", reject);
    request.end(body);
  });
}

async function uploadRecording(capture) {
  const fileInfo = await fsp.stat(capture.filePath);
  return new Promise((resolve, reject) => {
    const target = new URL("/api/recordings", API_ORIGIN);
    const transport = target.protocol === "https:" ? https : http;
    const headers = {
      Accept: "application/json",
      "Content-Type": capture.metadata.screenVideo ? "video/webm" : "audio/webm",
      "Content-Length": String(fileInfo.size),
      "X-MeetX-Encoded-Metadata": "1",
      "X-Meeting-Title": cleanHeader(capture.metadata.title || "Desktop meeting recording"),
      "X-Meeting-Audience": cleanHeader(capture.metadata.audience),
      "X-Meeting-Url": cleanHeader(capture.metadata.meetingUrl),
      "X-Source-App": cleanHeader(capture.metadata.sourceApp || "Meet-X Desktop Recorder"),
      "X-Local-User-Name": cleanHeader(capture.metadata.localUserName || "You"),
      "X-Microphone-Captured": capture.metadata.microphone ? "1" : "0",
      "X-System-Audio-Captured": capture.metadata.systemAudio ? "1" : "0",
      "X-File-Name": cleanHeader(path.basename(capture.filePath))
    };
    const request = transport.request(target, { method: "POST", headers }, (response) => readJsonResponse(response, resolve, reject));
    request.setTimeout(10 * 60 * 1000, () => request.destroy(new Error("Recording upload timed out.")));
    request.on("error", reject);
    createReadStream(capture.filePath).on("error", reject).pipe(request);
  });
}

async function writeEventSidecar(capture, event) {
  capture.events.push({ ...event, at: new Date().toISOString() });
  await fsp.writeFile(capture.eventsPath, JSON.stringify(capture.events, null, 2), "utf8");
}

async function cancelCapture(sessionId) {
  const capture = captures.get(sessionId);
  if (!capture) return;
  await writeEventSidecar(capture, { type: "cancelled" }).catch(() => undefined);
  await requestJson("/api/live-transcription/" + encodeURIComponent(sessionId), "DELETE", undefined, 3000).catch(() => undefined);
  const info = await fsp.stat(capture.filePath).catch(() => null);
  if (!info || info.size === 0) {
    await fsp.unlink(capture.filePath).catch(() => undefined);
  }
  captures.delete(sessionId);
  if (recordingSessionId === sessionId) {
    recordingSessionId = null;
    selectedDisplaySourceId = null;
  }
  setRecordingWindowState(false);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return isTrustedWebContents(webContents) && (permission === "media" || permission === "display-capture");
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isTrustedWebContents(webContents) && (permission === "media" || permission === "display-capture"));
  });
  createWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (!recordingSessionId) app.quit();
});

ipcMain.handle("agent:status", async () => {
  let apiAvailable = false;
  try {
    await requestJson("/health", "GET", undefined, 3000);
    apiAvailable = true;
  } catch {
    apiAvailable = false;
  }
  return {
    apiOrigin: API_ORIGIN,
    apiAvailable,
    platform: process.platform,
    systemAudioAvailable: process.platform === "win32",
    recordingRoot: recordingRoot()
  };
});

ipcMain.handle("meeting:detect", async () => {
  try {
    return await detectMeetings();
  } catch (error) {
    return {
      available: true,
      candidates: [],
      note: "Meeting detection failed: " + (error instanceof Error ? error.message : "unknown error")
    };
  }
});

ipcMain.handle("capture:list-sources", async () => listDisplaySources());

ipcMain.handle("capture:begin", async (_event, input) => {
  if (!input || input.disclosureAcknowledged !== true) {
    throw new Error("Confirm that participants were informed before recording.");
  }
  if (!input.systemAudio && !input.microphone && !input.screenVideo) {
    throw new Error("Choose system audio, microphone, screen video, or a combination.");
  }
  if (input.transcriptionMode === "live" && !input.systemAudio && !input.microphone) {
    throw new Error("Live transcription needs system audio, microphone, or both.");
  }
  if (recordingSessionId) {
    throw new Error("A recording is already active.");
  }

  const displaySource = input.screenVideo ? { id: "system-picker", name: "Chosen in system screen picker", kind: "screen", thumbnail: "" } : null;
  selectedDisplaySourceId = null;

  const sessionId = "cap_" + randomUUID().replaceAll("-", "");
  const directory = recordingRoot();
  await fsp.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, sessionId + ".webm");
  const eventsPath = path.join(directory, sessionId + ".events.json");
  await fsp.writeFile(filePath, Buffer.alloc(0), { flag: "wx" });

  const capture = {
    sessionId,
    filePath,
    eventsPath,
    bytes: 0,
    startedAt: new Date().toISOString(),
    metadata: {
      title: String(input.title || "").trim(),
      audience: String(input.audience || "").trim(),
      meetingUrl: String(input.meetingUrl || "").trim(),
      sourceApp: String(input.sourceApp || "").trim(),
      systemAudio: Boolean(input.systemAudio),
      microphone: Boolean(input.microphone),
      localUserName: process.env.MEETX_RECORDER_USER_NAME || os.userInfo().username || "You",
      screenVideo: Boolean(input.screenVideo),
      displaySourceId: displaySource ? displaySource.id : "",
      displaySourceName: displaySource ? displaySource.name : "",
      transcriptionMode: input.transcriptionMode === "live" ? "live" : "post",
      languageHint: ["auto", "en", "hi"].includes(String(input.languageHint)) ? String(input.languageHint) : "auto"
    },
    events: []
  };
  captures.set(sessionId, capture);
  recordingSessionId = sessionId;
  captureArmedUntil = Date.now() + 15000;
  setRecordingWindowState(true);
  await writeEventSidecar(capture, {
    type: "capture_started",
    systemAudio: Boolean(input.systemAudio),
    microphone: Boolean(input.microphone),
    screenVideo: Boolean(input.screenVideo),
    displaySourceId: capture.metadata.displaySourceId,
    displaySourceName: capture.metadata.displaySourceName,
    transcriptionMode: capture.metadata.transcriptionMode,
    disclosureAcknowledged: true
  });

  let liveUrl;
  if (capture.metadata.transcriptionMode === "live") {
    try {
      const live = await requestJson(
        "/api/live-transcription/" + encodeURIComponent(sessionId) + "/start",
        "POST",
        {
          title: capture.metadata.title || "Live desktop meeting",
          audience: capture.metadata.audience.split(",").map((value) => value.trim()).filter((value) => value.length > 0),
          sourceApp: capture.metadata.sourceApp || "Meet-X Desktop Recorder",
          languageHint: capture.metadata.languageHint,
          screenVideo: capture.metadata.screenVideo,
          microphone: capture.metadata.microphone,
          systemAudio: capture.metadata.systemAudio,
          localUserName: capture.metadata.localUserName
        },
        10_000
      );
      liveUrl = new URL(live.liveUrl, API_ORIGIN).toString();
      await writeEventSidecar(capture, { type: "live_session_published", liveUrl });
    } catch (error) {
      await writeEventSidecar(capture, { type: "live_session_publish_failed", message: error instanceof Error ? error.message : "unknown error" });
    }
  }

  return { sessionId, filePath, liveUrl };
});
ipcMain.handle("transcription:live-chunk", async (_event, sessionId, input) => {
  const capture = captures.get(sessionId);
  if (!capture || recordingSessionId !== sessionId) {
    throw new Error("Capture session is not active.");
  }
  if (!input || !Number.isInteger(input.chunkIndex) || !Number.isInteger(input.startMs) || !Number.isInteger(input.durationMs)) {
    throw new Error("Live transcription chunk metadata is invalid.");
  }

  const payload = Buffer.from(input.bytes);
  if (payload.length === 0 || payload.length > 32 * 1024 * 1024) {
    throw new Error("Live transcription chunks must be between 1 byte and 32MB.");
  }
  const languageHint = ["auto", "en", "hi"].includes(String(input.languageHint)) ? String(input.languageHint) : "auto";
  return requestBinary(
    "/api/live-transcription/" + encodeURIComponent(sessionId) + "/chunks",
    payload,
    {
      "Content-Type": "audio/webm;codecs=opus",
      "X-Chunk-Index": String(input.chunkIndex),
      "X-Start-Ms": String(input.startMs),
      "X-Duration-Ms": String(input.durationMs),
      "X-Language-Hint": languageHint
    },
    10 * 60 * 1000
  );
});

ipcMain.handle("capture:append", async (_event, sessionId, bytes) => {
  const capture = captures.get(sessionId);
  if (!capture || recordingSessionId !== sessionId) {
    throw new Error("Capture session is not active.");
  }
  const buffer = Buffer.from(bytes);
  capture.bytes += buffer.length;
  if (capture.bytes > MAX_CAPTURE_BYTES) {
    throw new Error("The local recording exceeded the 2GB safety limit.");
  }
  await fsp.appendFile(capture.filePath, buffer);
  return { bytesWritten: capture.bytes };
});

ipcMain.handle("capture:cancel", async (_event, sessionId) => {
  await cancelCapture(sessionId);
  return { ok: true };
});

ipcMain.handle("capture:finish", async (_event, sessionId, input) => {
  const capture = captures.get(sessionId);
  if (!capture || recordingSessionId !== sessionId) {
    throw new Error("Capture session is not active.");
  }
  recordingSessionId = null;
  selectedDisplaySourceId = null;
  setRecordingWindowState(false);
  await writeEventSidecar(capture, { type: "capture_stopped", bytes: capture.bytes });

  if (capture.bytes === 0) {
    await cancelCapture(sessionId);
    throw new Error("No recording data was captured.");
  }

  let upload;
  try {
    upload = await uploadRecording(capture);
    await writeEventSidecar(capture, { type: "upload_completed", meetingId: upload.meetingId });
  } catch (error) {
    await writeEventSidecar(capture, { type: "upload_failed", message: error instanceof Error ? error.message : "unknown error" });
    throw new Error("The recording is safely stored at " + capture.filePath + ", but upload failed. " + (error instanceof Error ? error.message : ""));
  }

  const languageHint = input && input.languageHint ? input.languageHint : "auto";
  const transcriptionMode = input && input.transcriptionMode === "live" ? "live" : "post";
  const processFullRecording = async (mode) => {
    const result = await requestJson(
      "/api/meetings/" + encodeURIComponent(upload.meetingId) + "/process",
      "POST",
      { languageHint },
      10 * 60 * 1000
    );
    return { ...result, mode };
  };

  let processing;
  try {
    if (transcriptionMode === "live") {
      processing = await requestJson(
        "/api/live-transcription/" + encodeURIComponent(sessionId) + "/finalize",
        "POST",
        { meetingId: upload.meetingId },
        2 * 60 * 1000
      );
      await writeEventSidecar(capture, { type: "live_transcription_finalized", status: processing.status });
    } else {
      processing = await processFullRecording("post");
      await writeEventSidecar(capture, { type: "post_transcription_completed", status: processing.status });
    }
  } catch (error) {
    if (transcriptionMode === "live") {
      await writeEventSidecar(capture, {
        type: "live_transcription_fallback",
        message: error instanceof Error ? error.message : "unknown error"
      });
      try {
        processing = await processFullRecording("post_fallback");
        await requestJson("/api/live-transcription/" + encodeURIComponent(sessionId) + "/complete", "POST", { meetingId: upload.meetingId, mode: "post_fallback" }, 10_000).catch(() => undefined);
        await writeEventSidecar(capture, { type: "post_transcription_completed", status: processing.status, fallback: true });
      } catch (fallbackError) {
        processing = {
          status: "processing_failed",
          mode: "post_fallback",
          message: fallbackError instanceof Error ? fallbackError.message : "unknown error"
        };
        await writeEventSidecar(capture, { type: "processing_failed", message: processing.message });
      }
    } else {
      processing = {
        status: "processing_failed",
        mode: "post",
        message: error instanceof Error ? error.message : "unknown error"
      };
      await writeEventSidecar(capture, { type: "processing_failed", message: processing.message });
    }
  }
  captures.delete(sessionId);
  if (Notification.isSupported()) {
    new Notification({
      title: "Meet-X recording saved",
      body: processing.status === "processed" ? "Transcript and summary are ready." : "Recording uploaded. Open it to review processing."
    }).show();
  }

  return {
    ...upload,
    processing,
    localFilePath: capture.filePath,
    detailUrl: new URL(upload.detailUrl, API_ORIGIN).toString()
  };
});

ipcMain.handle("app:open-url", async (_event, rawUrl) => {
  const target = new URL(String(rawUrl), API_ORIGIN);
  const allowedOrigin = new URL(API_ORIGIN).origin;
  if (target.origin !== allowedOrigin) {
    throw new Error("Meet-X only opens links from the configured SaaS origin.");
  }
  await shell.openExternal(target.toString());
  return { ok: true };
});
