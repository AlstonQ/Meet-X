import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { Controller, Get, Header, Headers, Res } from "@nestjs/common";
import { escapeHtml, requirePrototypeSession, renderSaasShell } from "./auth.controller.js";
import { listPrototypeMeetings } from "./prototype-store.js";

function statusClass(status: string): string {
  return status === "processing_failed" ? "status warn" : status === "uploaded" || status === "processing" ? "status blue" : "status";
}

@Controller()
export class AppController {
  @Get("/manifest.webmanifest")
  @Header("Content-Type", "application/manifest+json; charset=utf-8")
  manifest(): string {
    return JSON.stringify({
      name: "Meet-X Local Recorder",
      short_name: "Meet-X",
      id: "/app",
      start_url: "/app?source=pwa",
      scope: "/",
      display: "standalone",
      background_color: "#f5f5f7",
      theme_color: "#f5f5f7",
      description: "Installable local meeting recorder shell for Meet-X.",
      categories: ["productivity", "business"],
      icons: [
        { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        { src: "/pwa-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }
      ]
    });
  }

  @Get("/pwa-icon.svg")
  @Header("Content-Type", "image/svg+xml; charset=utf-8")
  pwaIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="120" fill="#f5f5f7"/><circle cx="256" cy="256" r="168" fill="#0071e3"/><path d="M156 292c48 48 152 48 200 0" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round"/><circle cx="196" cy="218" r="24" fill="#fff"/><circle cx="316" cy="218" r="24" fill="#fff"/></svg>`;
  }


  @Get("/pwa-icon-192.png")
  pwaIcon192(@Res() response: ServerResponse): void {
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Cache-Control", "public, max-age=86400");
    response.end(readFileSync(join(process.cwd(), "public", "pwa-icon-192.png")));
  }

  @Get("/pwa-icon-512.png")
  pwaIcon512(@Res() response: ServerResponse): void {
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Cache-Control", "public, max-age=86400");
    response.end(readFileSync(join(process.cwd(), "public", "pwa-icon-512.png")));
  }
  @Get("/sw.js")
  @Header("Content-Type", "application/javascript; charset=utf-8")
  serviceWorker(): string {
    return `self.addEventListener("install", (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", () => undefined);`;
  }

  @Get("/app")
  @Header("Content-Type", "text/html; charset=utf-8")
  async dashboard(@Headers("cookie") cookieHeader: string | undefined): Promise<string> {
    const session = requirePrototypeSession(cookieHeader);
    const meetings = await listPrototypeMeetings();
    const processed = meetings.filter((meeting) => meeting.status === "processed").length;
    const needsProcessing = meetings.filter((meeting) => meeting.status === "uploaded" || meeting.status === "processing_failed").length;
    const latestRows = meetings.slice(0, 5).map((meeting) => `<tr><td><a href="/meetings/${escapeHtml(meeting.id)}">${escapeHtml(meeting.title)}</a><div class="mini">${escapeHtml(meeting.sourceApp ?? "Manual capture")}</div></td><td><span class="${statusClass(meeting.status)}">${escapeHtml(meeting.status.replaceAll("_", " "))}</span></td><td>${escapeHtml(new Date(meeting.createdAt).toLocaleString())}</td></tr>`).join("");
    const body = `<section class="grid"><div class="card"><h2>Total meetings</h2><div class="metric">${String(meetings.length)}</div><p>Recordings saved in this workspace.</p></div><div class="card"><h2>Processed</h2><div class="metric">${String(processed)}</div><p>Meetings with transcript and summary.</p></div><div class="card"><h2>Needs attention</h2><div class="metric">${String(needsProcessing)}</div><p>Recordings waiting for transcription or local setup.</p></div></section><section class="card"><h2>Recent meetings</h2><table><thead><tr><th>Meeting</th><th>Status</th><th>Created</th></tr></thead><tbody>${latestRows || '<tr><td colspan="3">No meetings yet. <a href="/recorder">Record your first meeting</a>.</td></tr>'}</tbody></table></section><section class="grid"><div class="card subtle"><h2>PWA shell</h2><p>Install Meet-X for a focused app window, quick launch, and access to shared live transcripts.</p><span class="status blue">available</span></div><div class="card subtle"><h2>Browser recorder</h2><p>Records selected tabs/windows with shared audio. Best for browser-based Meet, Zoom, and Teams.</p><span class="status">active</span></div><div class="card subtle"><h2>Desktop agent</h2><p>Records Windows system audio and microphone, with optional primary-screen video and shared live transcription.</p><span class="status">active</span></div></section>`;
    return renderSaasShell({ title: "Dashboard", active: "dashboard", session, body });
  }

  @Get("/settings")
  @Header("Content-Type", "text/html; charset=utf-8")
  settings(@Headers("cookie") cookieHeader: string | undefined): string {
    const session = requirePrototypeSession(cookieHeader);
    const body = `<section class="card"><h2>Workspace</h2><div class="setting-row"><div><h3>Identity</h3><p>Shown on local recordings and future SaaS workspace screens.</p></div><div><label>Workspace name</label><input id="workspaceName" value="${escapeHtml(session.organization)}" /><label>Default recorder display name</label><input id="recorderName" value="Meet-X Recorder" /></div></div><div class="setting-row"><div><h3>Consent policy</h3><p>Controls how Meet-X reminds you to disclose recording.</p></div><div><select id="consentPolicy"><option value="announce">Announce recording</option><option value="explicit_opt_in">Require explicit opt-in</option><option value="implicit">Implicit internal policy</option></select><p class="mini">Silent/invisible recording is intentionally not supported.</p></div></div><div class="setting-row"><div><h3>Region</h3><p>Default data residency for the paid SaaS workspace.</p></div><div><select id="dataRegion"><option value="eu">EU launch region</option><option value="us">US</option><option value="apac">APAC</option></select></div></div></section><section class="card"><h2>Recorder mode</h2><div class="grid"><div class="card subtle"><h3>PWA shell</h3><p>Installable browser app. Good for local library, playback, and browser capture.</p><span class="status">enabled</span></div><div class="card subtle"><h3>Browser capture</h3><p>Uses screen/tab picker because browsers require explicit user selection for capture.</p><span class="status">active</span></div><div class="card subtle"><h3>Desktop agent</h3><p>Captures system audio, microphone, and optional primary-screen video; no browser tab selection is required.</p><span class="status">active</span></div></div></section><section class="card"><h2>Local transcription</h2><div class="setting-row"><div><h3>Whisper + FFmpeg</h3><p>Meet-X auto-discovers the bundled multilingual Whisper and FFmpeg tools; these fields remain available for custom model overrides.</p></div><div><label>Whisper CLI path</label><input id="whisperPath" placeholder="C:\\tools\\whisper-cli.exe" /><label>Model path</label><input id="modelPath" placeholder="C:\\models\\ggml-base.bin" /><label>FFmpeg path</label><input id="ffmpegPath" placeholder="C:\\tools\\ffmpeg.exe" /></div></div></section><section class="card"><h2>Meeting metadata defaults</h2><div class="setting-row"><div><h3>After recording edits</h3><p>You can edit title, audience, URL, and source from each meeting page after recording.</p></div><div><label>Default audience</label><textarea id="defaultAudience" placeholder="Names or emails to prefill for manual recordings"></textarea><button id="saveSettingsButton">Save local settings</button><p class="mini" id="settingsStatus">Settings are saved in this browser for now.</p></div></div></section><script>
const fields = ["workspaceName", "recorderName", "consentPolicy", "dataRegion", "whisperPath", "modelPath", "ffmpegPath", "defaultAudience"];
for (const id of fields) { const element = document.getElementById(id); const value = localStorage.getItem("meetx.settings." + id); if (element && value) { element.value = value; } }
document.getElementById("saveSettingsButton")?.addEventListener("click", () => { for (const id of fields) { const element = document.getElementById(id); if (element) { localStorage.setItem("meetx.settings." + id, element.value); } } document.getElementById("settingsStatus").textContent = "Saved on this device."; });
</script>`;
    return renderSaasShell({ title: "Settings", active: "settings", session, body });
  }

  @Get("/billing")
  @Header("Content-Type", "text/html; charset=utf-8")
  billing(@Headers("cookie") cookieHeader: string | undefined): string {
    const session = requirePrototypeSession(cookieHeader);
    const body = `<section class="card"><h2>Billing</h2><p>Paid SaaS billing is not connected yet, but the product shell now has a place for plans, seats, metered AI usage, and invoices.</p><div class="grid"><div class="card subtle"><h2>Plan</h2><div class="metric">Trial</div></div><div class="card subtle"><h2>Seats</h2><div class="metric">1</div></div><div class="card subtle"><h2>AI usage</h2><div class="metric">Local</div></div></div></section>`;
    return renderSaasShell({ title: "Billing", active: "billing", session, body });
  }
}


