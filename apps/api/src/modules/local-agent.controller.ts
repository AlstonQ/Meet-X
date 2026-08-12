import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Controller, Get, Post } from "@nestjs/common";

const execFileAsync = promisify(execFile);

type RawWindow = {
  ProcessName?: string;
  MainWindowTitle?: string;
};

type MeetingCandidate = {
  sourceApp: "Microsoft Teams" | "Zoom" | "Google Meet" | "Browser meeting";
  title: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const browserProcessNames = new Set(["chrome", "msedge", "firefox"]);
const confidenceRank = { high: 0, medium: 1, low: 2 } as const;

function isMeetXWindow(processName: string, haystack: string): boolean {
  return browserProcessNames.has(processName) && (haystack.includes("meet-x") || haystack.includes("localhost:3001"));
}

function classifyWindow(raw: RawWindow): MeetingCandidate | undefined {
  const processName = (raw.ProcessName ?? "").toLowerCase();
  const title = raw.MainWindowTitle ?? "";
  const haystack = `${processName} ${title}`.toLowerCase();

  if (isMeetXWindow(processName, haystack)) {
    return undefined;
  }
  if (haystack.includes("teams") && /\b(meeting|call|compact view|lobby|pre-join)\b/iu.test(title)) {
    return { sourceApp: "Microsoft Teams", title: title || "Microsoft Teams meeting", confidence: "high", reason: "Teams meeting/call window detected" };
  }
  if (haystack.includes("zoom") && /\b(zoom meeting|zoom webinar|waiting room|in meeting)\b/iu.test(title)) {
    return { sourceApp: "Zoom", title: title || "Zoom meeting", confidence: "high", reason: "Zoom meeting window detected" };
  }
  if (haystack.includes("meet.google") || haystack.includes("google meet")) {
    return { sourceApp: "Google Meet", title: title || "Google Meet", confidence: "high", reason: "Google Meet browser title detected" };
  }
  if (browserProcessNames.has(processName) && /\b(meeting|meet|call|zoom|teams)\b/iu.test(title)) {
    return { sourceApp: "Browser meeting", title: title || "Browser meeting", confidence: "medium", reason: "Browser tab/window title looks like a meeting" };
  }
  return undefined;
}

@Controller()
export class LocalAgentController {
  @Post("/api/local-agent/launch")
  async launchDesktopAgent(): Promise<{ status: "launched" | "running" | "unavailable"; message: string }> {
    if (process.platform !== "win32") {
      return { status: "unavailable", message: "The Meet-X desktop recorder currently supports Windows only." };
    }

    const runningScript = "if (Get-Process | Where-Object { $_.MainWindowTitle -eq 'Meet-X Desktop Recorder' }) { 'running' }";
    const isRunning = async (): Promise<boolean> => {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", runningScript], { timeout: 5000 });
      return stdout.trim() === "running";
    };
    if (await isRunning()) {
      return { status: "running", message: "Meet-X Desktop Recorder is already open." };
    }

    const candidates = [resolve(process.cwd(), "apps", "desktop-agent"), resolve(process.cwd(), "..", "desktop-agent")];
    const desktopAgentPath = candidates.find((candidate) => existsSync(join(candidate, "package.json")));
    if (desktopAgentPath === undefined) {
      return { status: "unavailable", message: "The local Meet-X desktop recorder files were not found." };
    }
    const electronCliPath = join(desktopAgentPath, "node_modules", "electron", "cli.js");
    if (!existsSync(electronCliPath)) {
      return { status: "unavailable", message: "Electron is not installed. Run pnpm install first." };
    }

    spawn(process.execPath, [electronCliPath, "."], { cwd: desktopAgentPath, detached: true, stdio: "ignore", windowsHide: true }).unref();
    await new Promise((resolveLaunch) => setTimeout(resolveLaunch, 1500));
    if (!(await isRunning())) {
      return { status: "unavailable", message: "The desktop recorder exited before its window opened." };
    }
    return { status: "launched", message: "Meet-X Desktop Recorder opened." };
  }
  @Get("/api/local-agent/meetings")
  async detectMeetings(): Promise<{ available: boolean; candidates: MeetingCandidate[]; note: string }> {
    if (process.platform !== "win32") {
      return { available: false, candidates: [], note: "Local meeting detection is currently implemented for Windows only." };
    }

    const script = "Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and ($_.ProcessName -match 'Teams|ms-teams|Zoom|chrome|msedge|firefox') } | Select-Object ProcessName,MainWindowTitle | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 5000 });
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
      return { available: true, candidates: [], note: "No active meeting windows were detected." };
    }

    const parsed = JSON.parse(trimmed) as RawWindow | RawWindow[];
    const windows = Array.isArray(parsed) ? parsed : [parsed];
    const seen = new Set<string>();
    const candidates: MeetingCandidate[] = [];
    for (const window of windows) {
      const candidate = classifyWindow(window);
      if (candidate === undefined) continue;
      const key = `${candidate.sourceApp}:${candidate.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }

    candidates.sort((left, right) => confidenceRank[left.confidence] - confidenceRank[right.confidence]);

    return {
      available: true,
      candidates,
      note: candidates.length === 0 ? "Meeting-capable apps are open, but no active meeting title was detected." : "Detected local meeting candidates from Windows app/window titles."
    };
  }
}



