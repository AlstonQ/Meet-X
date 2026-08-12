const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const browserProcessNames = new Set(["chrome", "msedge", "firefox"]);
const confidenceRank = { high: 0, medium: 1, low: 2 };
const teamsProcessNames = new Set(["teams", "msteams", "ms-teams"]);

function isTeamsWindow(processName, title) {
  const lowerTitle = title.toLowerCase();
  return teamsProcessNames.has(processName) || lowerTitle.includes("microsoft teams") || lowerTitle.includes("teams meeting");
}

function isTeamsNonMeetingWindow(title) {
  return /\b(calendar|chat|activity|teams and channels|files|settings|meet-x)\b/iu.test(title);
}

function classifyWindow(raw) {
  const processName = String(raw.ProcessName || "").toLowerCase();
  const title = String(raw.MainWindowTitle || "").trim();
  const haystack = (processName + " " + title).toLowerCase();

  if (browserProcessNames.has(processName) && (haystack.includes("meet-x") || haystack.includes("localhost:3001"))) {
    return null;
  }
  if (isTeamsWindow(processName, title) && isTeamsNonMeetingWindow(title)) {
    return null;
  }
  if (isTeamsWindow(processName, title) && /\b(meeting|call|compact view|lobby|pre-join|presenting|sharing|participants|muted|unmuted)\b/iu.test(title)) {
    return { sourceApp: "Microsoft Teams", title: title || "Microsoft Teams meeting", confidence: "high", reason: "Teams meeting/call window detected" };
  }
  if (isTeamsWindow(processName, title) && title) {
    return { sourceApp: "Microsoft Teams", title, confidence: "medium", reason: "Microsoft Teams window detected; confirm this is the active meeting" };
  }
  if (haystack.includes("zoom") && /\b(zoom meeting|zoom webinar|waiting room|in meeting)\b/iu.test(title)) {
    return { sourceApp: "Zoom", title: title || "Zoom meeting", confidence: "high", reason: "Zoom meeting window detected" };
  }
  if (haystack.includes("meet.google") || haystack.includes("google meet")) {
    return { sourceApp: "Google Meet", title: title || "Google Meet", confidence: "high", reason: "Google Meet window detected" };
  }
  if (browserProcessNames.has(processName) && /\b(meeting|meet|call|webinar)\b/iu.test(title)) {
    return { sourceApp: "Browser meeting", title: title || "Browser meeting", confidence: "medium", reason: "Browser window title looks like a meeting" };
  }
  return null;
}

async function detectMeetings() {
  if (process.platform !== "win32") {
    return { available: false, candidates: [], note: "Desktop meeting detection is currently available on Windows." };
  }

  const script = "Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and ($_.ProcessName -match 'Teams|MSTeams|ms-teams|Zoom|chrome|msedge|firefox') } | Select-Object ProcessName,MainWindowTitle | ConvertTo-Json -Compress";
  const result = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  const trimmed = result.stdout.trim();
  if (!trimmed) {
    return { available: true, candidates: [], note: "No active Teams, Zoom, or Meet window was detected." };
  }

  const parsed = JSON.parse(trimmed);
  const windows = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Set();
  const candidates = [];
  for (const window of windows) {
    const candidate = classifyWindow(window);
    if (!candidate) continue;
    const key = candidate.sourceApp + ":" + candidate.title;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  candidates.sort((left, right) => confidenceRank[left.confidence] - confidenceRank[right.confidence]);
  return {
    available: true,
    candidates,
    note: candidates.length ? "Detected active meeting windows locally." : "Meeting apps are open, but no active call title was detected."
  };
}

module.exports = { classifyWindow, detectMeetings };