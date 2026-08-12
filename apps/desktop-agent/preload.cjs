const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("meetxDesktop", {
  getStatus: () => ipcRenderer.invoke("agent:status"),
  detectMeetings: () => ipcRenderer.invoke("meeting:detect"),
  listDisplaySources: () => ipcRenderer.invoke("capture:list-sources"),
  beginCapture: (input) => ipcRenderer.invoke("capture:begin", input),
  appendCapture: (sessionId, bytes) => ipcRenderer.invoke("capture:append", sessionId, bytes),
  transcribeLiveChunk: (sessionId, input) => ipcRenderer.invoke("transcription:live-chunk", sessionId, input),
  finishCapture: (sessionId, input) => ipcRenderer.invoke("capture:finish", sessionId, input),
  cancelCapture: (sessionId) => ipcRenderer.invoke("capture:cancel", sessionId),
  openUrl: (url) => ipcRenderer.invoke("app:open-url", url)
});