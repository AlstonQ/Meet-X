import { Body, Controller, Get, Header, Headers, HttpException, HttpStatus, Param, Post, Query, Req, Res } from "@nestjs/common";
import { LocalWhisperTranscriptionProvider, LocalWhisperUnavailableError, summarizeWithCitations } from "@meet-x/transcription";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { requirePrototypeSession, renderSaasShell } from "./auth.controller.js";
import { addPrototypeNote, deletePrototypeMeeting, getPrototypeMeeting, listPrototypeMeetings, saveUploadedMeeting, updatePrototypeMeeting, type PrototypeMeeting, type PrototypeNote } from "./prototype-store.js";

const execFileAsync = promisify(execFile);

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatBytes(sizeBytes: number): string {
  return sizeBytes < 1024 * 1024 ? `${String(Math.max(1, Math.round(sizeBytes / 1024)))} KB` : `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function safeDownloadName(meeting: PrototypeMeeting, extension: "webm" | "mp4" = "webm"): string {
  const cleanTitle = meeting.title.replace(/[^a-z0-9-_]+/giu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || meeting.id;
  return `${cleanTitle}.${extension}`;
}

function playableArtifactPath(meeting: PrototypeMeeting): string {
  return meeting.artifactPath.replace(/\.webm$/u, ".playback.webm");
}

function legacyMp4ArtifactPath(meeting: PrototypeMeeting): string {
  return meeting.artifactPath.replace(/\.webm$/u, ".playback.mp4");
}

function playbackMimeType(meeting: PrototypeMeeting): string {
  const mimeType = meeting.mimeType.split(";")[0] ?? "";
  return mimeType.trim().length > 0 ? mimeType.trim() : "application/octet-stream";
}

function resolveFfmpegPath(): string {
  const configured = process.env["MEETX_FFMPEG_PATH"]?.trim();
  return configured !== undefined && configured.length > 0 ? configured : "ffmpeg";
}

async function ensureFastPlayableCopy(meeting: PrototypeMeeting): Promise<void> {
  if (meeting.screenVideo !== true || meeting.mimeType.toLowerCase().startsWith("audio/")) return;
  const outputPath = playableArtifactPath(meeting);
  if (await stat(outputPath).then((fileInfo) => fileInfo.size > 0).catch(() => false)) return;
  const ffmpegPath = resolveFfmpegPath();
  await execFileAsync(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-i", meeting.artifactPath, "-c", "copy", outputPath], { timeout: 60_000, windowsHide: true });
}

function parseBooleanHeader(value: string | undefined): boolean | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  return ["1", "true", "yes", "on"].includes(trimmed);
}

function speakerDisplayName(speakerId: string): string {
  if (speakerId === "speaker_user") return "You";
  const numbered = /^speaker_(\d+)$/u.exec(speakerId);
  if (numbered?.[1] !== undefined) return "Speaker " + numbered[1];
  if (speakerId.startsWith("speaker_")) {
    return speakerId.slice(8).split("_").filter((part) => part.length > 0).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }
  return speakerId;
}
function parseHeaderList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(/[;,\n]/u).map((item) => item.trim()).filter((item) => item.length > 0);
}

type MeetingMetadataBody = { title?: string; audience?: string; meetingUrl?: string; sourceApp?: string };
type ProcessMeetingBody = { languageHint?: string };
type MeetingNoteBody = { text?: string; timestampMs?: number; kind?: PrototypeNote["kind"] };
type ActionItemStatusBody = { completed?: boolean };
type AskMeetingBody = { question?: string };

const processingMeetings = new Set<string>();
type ProcessStatusPayload = {
  meetingId: string;
  status: PrototypeMeeting["status"] | "processing_interrupted";
  transcriptCount: number;
  summaryReady: boolean;
  processingError?: string;
};

function processStatusFor(meeting: PrototypeMeeting): ProcessStatusPayload {
  const status = meeting.status === "processing" && !processingMeetings.has(meeting.id) ? "processing_interrupted" : meeting.status;
  const payload: ProcessStatusPayload = {
    meetingId: meeting.id,
    status,
    transcriptCount: meeting.transcript?.length ?? 0,
    summaryReady: meeting.summary !== undefined
  };
  if (meeting.processingError !== undefined) payload.processingError = meeting.processingError;
  return payload;
}

async function runMeetingProcessing(id: string, languageHint: string): Promise<void> {
  const meeting = await getPrototypeMeeting(id);
  if (meeting === undefined) {
    processingMeetings.delete(id);
    return;
  }

  const processingMeeting: PrototypeMeeting = { ...meeting, status: "processing" };
  delete processingMeeting.processingError;
  await updatePrototypeMeeting(processingMeeting);
  try {
    const transcript = await new LocalWhisperTranscriptionProvider().transcribe({
      meetingId: processingMeeting.id,
      audioUrl: "/meetings/" + processingMeeting.id + "/recording",
      localMediaPath: processingMeeting.artifactPath,
      languageHint,
      speakerHints: { localUserName: processingMeeting.localUserName, microphone: processingMeeting.microphone, systemAudio: processingMeeting.systemAudio }
    });
    const updated: PrototypeMeeting = { ...processingMeeting, status: "processed", transcript: transcript.segments, summary: summarizeWithCitations(transcript.segments) };
    await updatePrototypeMeeting(updated);
  } catch (error) {
    const message = error instanceof LocalWhisperUnavailableError ? error.message + " Configure MEETX_WHISPER_CLI_PATH, MEETX_WHISPER_MODEL_PATH, and MEETX_FFMPEG_PATH to process real audio." : error instanceof Error ? error.message : "Unknown transcription failure.";
    const latest = await getPrototypeMeeting(id);
    const updated: PrototypeMeeting = { ...(latest ?? meeting), status: "processing_failed", processingError: message };
    await updatePrototypeMeeting(updated);
  } finally {
    processingMeetings.delete(id);
  }
}

function normalizeQuestion(value: string | undefined): string {
  return value?.trim().slice(0, 240) ?? "";
}

function scoreSegmentForQuestion(segment: NonNullable<PrototypeMeeting["transcript"]>[number], question: string): number {
  const terms = question.toLowerCase().split(/[^a-z0-9\p{L}]+/u).filter((term) => term.length > 2);
  const text = segment.text.toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function answerMeetingQuestion(meeting: PrototypeMeeting, question: string): { answer: string; citations: Array<{ segmentId: string; startMs: number; endMs: number; text: string }> } {
  const transcript = meeting.transcript ?? [];
  if (transcript.length === 0) {
    return { answer: "I need a completed transcript before I can answer questions about this meeting.", citations: [] };
  }
  const ranked = transcript
    .map((segment) => ({ segment, score: scoreSegmentForQuestion(segment, question) }))
    .sort((left, right) => right.score - left.score || left.segment.startMs - right.segment.startMs)
    .slice(0, 4)
    .map((item) => item.segment);
  const useful = ranked.length > 0 ? ranked : transcript.slice(0, 4);
  const answer = `Based on ${String(useful.length)} cited moment${useful.length === 1 ? "" : "s"}, the meeting indicates: ${useful.map((segment) => segment.text).join(" ")}`;
  return {
    answer,
    citations: useful.map((segment) => ({ segmentId: segment.segmentId, startMs: segment.startMs, endMs: segment.endMs, text: segment.text }))
  };
}

function decodeMetadataHeader(value: string | undefined, encoded: string | undefined): string | undefined {
  if (value === undefined || encoded !== "1") return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function optionalHeader(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}


function statusClass(status: PrototypeMeeting["status"]): string {
  return status === "processing_failed" ? "status warn" : status === "uploaded" || status === "processing" ? "status blue" : "status";
}

function summarySearchText(meeting: PrototypeMeeting): string {
  if (meeting.summary === undefined) return "";
  return [
    meeting.summary.tldr.text,
    ...meeting.summary.keyPoints.map((point) => point.text),
    ...meeting.summary.decisions.map((decision) => decision.text),
    ...meeting.summary.actionItems.map((item) => `${item.owner} ${item.task}`)
  ].join(" ");
}

function meetingSearchText(meeting: PrototypeMeeting): string {
  return [
    meeting.title,
    meeting.sourceApp ?? "",
    meeting.meetingUrl ?? "",
    meeting.audience.join(" "),
    meeting.transcript?.map((segment) => segment.text).join(" ") ?? "",
    summarySearchText(meeting),
    meeting.notes.map((note) => note.text).join(" ")
  ].join(" ").toLowerCase();
}

function meetingLanguageText(meeting: PrototypeMeeting): string {
  return meeting.transcript?.map((segment) => segment.language).join(" ").toLowerCase() ?? "";
}

function renderLibraryFilters(query: string, status: string, language: string): string {
  return `<form method="get" action="/library" class="card subtle"><div class="setting-row"><div><h2>Search meetings</h2><p>Search title, audience, source, transcript, summary, and notes.</p></div><div><label>Search</label><input name="q" value="${escapeHtml(query)}" placeholder="Search transcripts, people, decisions..." /><label>Status</label><select name="status"><option value="">Any status</option><option value="processed" ${status === "processed" ? "selected" : ""}>Processed</option><option value="uploaded" ${status === "uploaded" ? "selected" : ""}>Uploaded</option><option value="processing">Processing</option><option value="processing_failed" ${status === "processing_failed" ? "selected" : ""}>Needs attention</option></select><label>Language</label><select name="language"><option value="">Any language</option><option value="en" ${language === "en" ? "selected" : ""}>English</option><option value="hi" ${language === "hi" ? "selected" : ""}>Hindi</option><option value="auto" ${language === "auto" ? "selected" : ""}>Auto / mixed</option></select><p><button type="submit">Search library</button> <a class="button secondary" href="/library">Clear</a></p></div></div></form>`;
}

function parseNoteKind(value: PrototypeNote["kind"] | undefined): PrototypeNote["kind"] {
  return value === "question" || value === "decision" || value === "action" ? value : "note";
}
function renderMeetingRow(meeting: PrototypeMeeting): string {
  const audience = meeting.audience.length === 0 ? "Audience not added" : meeting.audience.join(", ");
  const source = meeting.sourceApp ?? "manual";
  return `<tr><td><a href="/meetings/${escapeHtml(meeting.id)}">${escapeHtml(meeting.title)}</a><br><small>${escapeHtml(meeting.id)}</small></td><td><span class="${statusClass(meeting.status)}">${escapeHtml(meeting.status.replaceAll("_", " "))}</span></td><td>${escapeHtml(source)}</td><td>${escapeHtml(audience)}</td><td>${formatBytes(meeting.sizeBytes)}</td><td>${escapeHtml(new Date(meeting.createdAt).toLocaleString())}</td><td><button class="danger mini-delete" data-meeting-id="${escapeHtml(meeting.id)}" data-meeting-title="${escapeHtml(meeting.title)}" type="button">Delete</button></td></tr>`;
}


function renderCitationAnchor(citation: { segmentId: string; startMs: number }): string {
  return `<a class="seek-link" data-start-ms="${String(citation.startMs)}" href="#${escapeHtml(citation.segmentId)}">${formatTime(citation.startMs)}</a>`;
}

function renderSummaryForMeeting(meeting: PrototypeMeeting): string {
  const summary = meeting.summary;
  if (summary === undefined) return `<div class="intel-stack"><section><h2>Executive summary</h2><p>No summary yet. Process the recording to generate cited meeting intelligence.</p></section><section><h2>Action items</h2><p class="mini">No checkbox action items yet. They will appear here after summary generation.</p></section><section><h2>Decisions</h2><p class="mini">No decisions detected yet.</p></section><section><h2>Risks / blockers</h2><p class="mini">No risks detected yet.</p></section><section><h2>Follow-up draft</h2><p class="mini">Follow-up email draft will appear after transcription and summary.</p></section><section class="ask-box"><h2>Ask this meeting</h2><p class="mini">Ask Meeting becomes useful after transcript processing. If a transcript exists, it answers locally with timestamp citations.</p><div class="ask-row"><input id="askQuestion" placeholder="Ask about objections, decisions, next steps..." /><button id="askButton" class="secondary" type="button">Ask</button></div><div id="askAnswer" class="answer-box mini"></div></section></div>`;
  const compatibilitySummary: Partial<typeof summary> = summary;
  const risks = compatibilitySummary.risks ?? [];
  const openQuestions = compatibilitySummary.openQuestions ?? [];
  const followUpDraft = compatibilitySummary.followUpDraft;
  const actionItems = summary.actionItems.length === 0 ? `<p class="mini">No action items detected yet. Add timestamped action notes or reprocess after correcting transcript text.</p>` : summary.actionItems.map((item, index) => {
    const compatibilityItem: Partial<typeof item> = item;
    const actionId = compatibilityItem.id ?? `legacy_${String(index)}`;
    const priority = compatibilityItem.priority ?? "medium";
    const dueDate = compatibilityItem.dueDate === undefined ? "No due date" : compatibilityItem.dueDate;
    const completed = compatibilityItem.completed ?? false;
    return `<li class="task-item ${completed ? "done" : ""}"><label class="task-check"><input class="action-toggle" data-action-id="${escapeHtml(actionId)}" type="checkbox" ${completed ? "checked" : ""} /><span><strong>${escapeHtml(speakerDisplayName(item.owner))}</strong> — ${escapeHtml(item.task)} <small>${escapeHtml(priority)} priority · ${escapeHtml(dueDate)} · ${renderCitationAnchor(item.citation)}</small></span></label></li>`;
  }).join("");
  const followUpHtml = followUpDraft === undefined ? `<p class="mini">Follow-up draft will appear after reprocessing this meeting.</p>` : `<div class="followup"><h3>${escapeHtml(followUpDraft.subject)}</h3><pre>${escapeHtml(followUpDraft.body)}</pre><p class="mini">Evidence: ${renderCitationAnchor(followUpDraft.citation)}</p><button class="secondary copy-followup" type="button">Copy follow-up</button></div>`;
  return `<div class="intel-stack"><section><h2>Executive summary</h2><p>${escapeHtml(summary.tldr.text)} ${renderCitationAnchor(summary.tldr.citation)}</p></section><section><h2>Action items</h2><ul class="task-list">${actionItems}</ul></section><section><h2>Key points</h2><ul>${summary.keyPoints.map((point) => `<li>${escapeHtml(point.text)} ${renderCitationAnchor(point.citation)}</li>`).join("")}</ul></section><section><h2>Decisions</h2><ul>${summary.decisions.length === 0 ? "<li>No explicit decisions detected.</li>" : summary.decisions.map((decision) => `<li>${escapeHtml(decision.text)} ${renderCitationAnchor(decision.citation)}</li>`).join("")}</ul></section><section><h2>Risks / blockers</h2><ul>${risks.length === 0 ? "<li>No major risks detected.</li>" : risks.map((risk) => `<li>${escapeHtml(risk.text)} ${renderCitationAnchor(risk.citation)}</li>`).join("")}</ul></section><section><h2>Open questions</h2><ul>${openQuestions.length === 0 ? "<li>No open questions detected.</li>" : openQuestions.map((question) => `<li>${escapeHtml(question.text)} ${renderCitationAnchor(question.citation)}</li>`).join("")}</ul></section><section><h2>Follow-up draft</h2>${followUpHtml}</section><section class="ask-box"><h2>Ask this meeting</h2><p class="mini">Local cited Q&A over this transcript. It does not call an external LLM.</p><div class="ask-row"><input id="askQuestion" placeholder="Ask about objections, decisions, next steps..." /><button id="askButton" class="secondary" type="button">Ask</button></div><div id="askAnswer" class="answer-box mini"></div></section></div>`;
}

type ActionItemProjection = {
  meetingId: string;
  meetingTitle: string;
  actionId: string;
  owner: string;
  task: string;
  priority: "low" | "medium" | "high";
  completed: boolean;
  dueDate: string;
  citation: { segmentId: string; startMs: number; endMs: number };
};

function actionItemsForMeeting(meeting: PrototypeMeeting): ActionItemProjection[] {
  const summary = meeting.summary;
  if (summary === undefined) return [];
  return summary.actionItems.map((item, index) => {
    const compatibilityItem: Partial<typeof item> = item;
    return {
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      actionId: compatibilityItem.id ?? `legacy_${String(index)}`,
      owner: speakerDisplayName(item.owner),
      task: item.task,
      priority: compatibilityItem.priority ?? "medium",
      completed: compatibilityItem.completed ?? false,
      dueDate: compatibilityItem.dueDate ?? "No due date",
      citation: item.citation
    };
  });
}

function allActionItems(meetings: PrototypeMeeting[]): ActionItemProjection[] {
  return meetings.flatMap(actionItemsForMeeting).sort((left, right) => {
    const completionDelta = Number(left.completed) - Number(right.completed);
    if (completionDelta !== 0) return completionDelta;
    const priorityOrder: Record<ActionItemProjection["priority"], number> = { high: 0, medium: 1, low: 2 };
    return priorityOrder[left.priority] - priorityOrder[right.priority];
  });
}

function accountNameFor(meeting: PrototypeMeeting): string {
  const audienceWithDomain = meeting.audience.find((person) => person.includes("@"));
  const domain = audienceWithDomain?.split("@").at(1)?.split(/[>\s,;]/u).at(0);
  if (domain !== undefined && domain.length > 0 && !domain.includes("meet-x.local")) {
    return domain.replace(/\.(com|co|in|org|net|io)$/iu, "").split(/[.-]/u).filter((part) => part.length > 1).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }
  const titleMatch = /(?:with|for|-)\s+([^|–—]+?)(?:\s+team|\s+call|\s+meeting|\s*$)/iu.exec(meeting.title);
  const titleAccount = titleMatch?.[1]?.trim();
  if (titleAccount !== undefined && titleAccount.length > 2) return titleAccount;
  return meeting.sourceApp ?? "Manual recordings";
}

function summarizeAccountTheme(meetings: PrototypeMeeting[]): string {
  const snippets = meetings.flatMap((meeting) => [
    meeting.summary?.tldr.text,
    ...(meeting.summary?.keyPoints.map((point) => point.text) ?? [])
  ]).filter((item): item is string => item !== undefined && item.length > 0);
  return snippets[0] ?? "No processed intelligence yet. Process recordings to build account memory.";
}

function renderActionItemRow(item: ActionItemProjection): string {
  return `<tr><td><label class="task-check"><input class="action-toggle" data-meeting-id="${escapeHtml(item.meetingId)}" data-action-id="${escapeHtml(item.actionId)}" type="checkbox" ${item.completed ? "checked" : ""} /><span><strong>${escapeHtml(item.owner)}</strong><br>${escapeHtml(item.task)}</span></label></td><td><span class="priority-${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span></td><td>${escapeHtml(item.dueDate)}</td><td><a href="/meetings/${escapeHtml(item.meetingId)}">${escapeHtml(item.meetingTitle)}</a></td><td><a href="/meetings/${escapeHtml(item.meetingId)}#${escapeHtml(item.citation.segmentId)}">${formatTime(item.citation.startMs)}</a></td></tr>`;
}

function renderActionsScript(): string {
  return `<script>document.querySelectorAll(".action-toggle").forEach((checkbox) => { checkbox.addEventListener("change", async () => { const meetingId = checkbox.getAttribute("data-meeting-id"); const actionId = checkbox.getAttribute("data-action-id"); if (!meetingId || !actionId) return; const checked = checkbox.checked === true; const response = await fetch("/api/meetings/" + encodeURIComponent(meetingId) + "/action-items/" + encodeURIComponent(actionId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: checked }) }); if (!response.ok) { checkbox.checked = !checked; } }); });</script>`;
}

function renderAccountCard(name: string, meetings: PrototypeMeeting[]): string {
  const processed = meetings.filter((meeting) => meeting.status === "processed").length;
  const actions = allActionItems(meetings);
  const openActions = actions.filter((item) => !item.completed);
  const latest = meetings[0];
  const latestHtml = latest === undefined ? "No meetings" : `<a href="/meetings/${escapeHtml(latest.id)}">${escapeHtml(latest.title)}</a>`;
  const actionHtml = openActions.slice(0, 3).map((item) => `<li>${escapeHtml(item.owner)}: ${escapeHtml(item.task)} <a href="/meetings/${escapeHtml(item.meetingId)}#${escapeHtml(item.citation.segmentId)}">${formatTime(item.citation.startMs)}</a></li>`).join("") || "<li>No open action items.</li>";
  return `<article class="account-card"><h2>${escapeHtml(name)}</h2><p>${escapeHtml(summarizeAccountTheme(meetings))}</p><p><span class="muted-pill">${String(meetings.length)} meetings</span><span class="muted-pill">${String(processed)} processed</span><span class="muted-pill">${String(openActions.length)} open actions</span></p><h3>Latest meeting</h3><p>${latestHtml}</p><h3>Open work</h3><ul>${actionHtml}</ul></article>`;
}
@Controller()
export class PrototypeController {
  @Get("/library")
  @Header("Content-Type", "text/html; charset=utf-8")
  async library(@Headers("cookie") cookieHeader: string | undefined, @Query("q") query: string | undefined, @Query("status") statusQuery: string | undefined, @Query("language") languageQuery: string | undefined): Promise<string> {
    const session = requirePrototypeSession(cookieHeader);
    const queryText = query?.trim().toLowerCase() ?? "";
    const status = statusQuery?.trim() ?? "";
    const language = languageQuery?.trim().toLowerCase() ?? "";
    const allMeetings = await listPrototypeMeetings();
    const meetings = allMeetings.filter((meeting) => (queryText.length === 0 || meetingSearchText(meeting).includes(queryText)) && (status.length === 0 || meeting.status === status) && (language.length === 0 || meetingLanguageText(meeting).includes(language)));
    const rows = meetings.length === 0 ? `<tr><td colspan="7">No recordings yet. Start with the <a href="/recorder">recorder</a>.</td></tr>` : meetings.map(renderMeetingRow).join("");
    return renderSaasShell({ title: "Meeting library", active: "library", session, body: `<section class="card"><p>Your local recordings appear here. Add or correct title, audience, source, and URL from each meeting page after recording.</p><p><a class="button" href="/recorder">Record a meeting</a></p></section><section class="card subtle"><h2>Live now</h2><p>Active desktop-recorder transcripts appear here during recording, then become completed recordings in this same library.</p><p><a class="button secondary" href="/live">View active live transcripts</a></p></section>${renderLibraryFilters(queryText, status, language)}<section class="card"><p class="mini">Showing ${String(meetings.length)} of ${String(allMeetings.length)} recordings.</p><table><thead><tr><th>Meeting</th><th>Status</th><th>Source</th><th>Audience</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table><script>for (const button of document.querySelectorAll(".mini-delete")) { button.addEventListener("click", async () => { const title = button.getAttribute("data-meeting-title") || "this recording"; const id = button.getAttribute("data-meeting-id"); if (!id || !confirm("Delete " + title + "? This removes the local recording file and transcript from this prototype.")) { return; } button.textContent = "Deleting..."; const response = await fetch("/api/meetings/" + encodeURIComponent(id) + "/delete", { method: "POST" }); if (!response.ok) { button.textContent = "Delete failed"; return; } window.location.reload(); }); }</script></section>` });
  }


  @Get("/actions")
  @Header("Content-Type", "text/html; charset=utf-8")
  async actions(@Headers("cookie") cookieHeader: string | undefined, @Query("status") statusQuery: string | undefined): Promise<string> {
    const session = requirePrototypeSession(cookieHeader);
    const meetings = await listPrototypeMeetings();
    const status = statusQuery?.trim() ?? "open";
    const allItems = allActionItems(meetings);
    const items = allItems.filter((item) => status === "all" || (status === "done" ? item.completed : !item.completed));
    const rows = items.length === 0 ? `<tr><td colspan="5">No action items yet. Process a recording to generate tasks.</td></tr>` : items.map(renderActionItemRow).join("");
    const openCount = allItems.filter((item) => !item.completed).length;
    const doneCount = allItems.filter((item) => item.completed).length;
    const body = `<section class="grid"><div class="card"><h2>Open</h2><div class="metric">${String(openCount)}</div><p>Action items waiting on someone.</p></div><div class="card"><h2>Done</h2><div class="metric">${String(doneCount)}</div><p>Completed follow-ups across meetings.</p></div><div class="card"><h2>Source</h2><div class="metric">AI</div><p>Generated from cited transcripts and editable via meeting pages.</p></div></section><section class="card subtle"><h2>Filter</h2><p><a class="button ${status === "open" ? "" : "secondary"}" href="/actions?status=open">Open</a> <a class="button ${status === "done" ? "" : "secondary"}" href="/actions?status=done">Done</a> <a class="button ${status === "all" ? "" : "secondary"}" href="/actions?status=all">All</a></p></section><section class="card"><h2>My action items</h2><table><thead><tr><th>Task</th><th>Priority</th><th>Due</th><th>Meeting</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>${renderActionsScript()}</section>`;
    return renderSaasShell({ title: "My action items", active: "actions", session, body });
  }

  @Get("/accounts")
  @Header("Content-Type", "text/html; charset=utf-8")
  async accounts(@Headers("cookie") cookieHeader: string | undefined): Promise<string> {
    const session = requirePrototypeSession(cookieHeader);
    const meetings = await listPrototypeMeetings();
    const grouped = new Map<string, PrototypeMeeting[]>();
    for (const meeting of meetings) {
      const accountName = accountNameFor(meeting);
      grouped.set(accountName, [...(grouped.get(accountName) ?? []), meeting]);
    }
    const cards = [...grouped.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0])).map(([name, accountMeetings]) => renderAccountCard(name, accountMeetings)).join("");
    const body = `<section class="card"><h2>Account memory</h2><p>Meet-X groups local recordings by audience domain, meeting title, and source so follow-ups do not stay trapped inside one recording.</p><p class="mini">This is local inference for the prototype. SaaS version will use CRM/account records when integrations are enabled.</p></section><section class="insight-grid">${cards || '<div class="card">No meetings yet. <a href="/recorder">Record one</a>.</div>'}</section>`;
    return renderSaasShell({ title: "Accounts", active: "accounts", session, body });
  }

  @Post("/api/recordings")
  async uploadRecording(@Req() request: IncomingMessage, @Headers("x-meeting-title") titleHeader: string | undefined, @Headers("x-meeting-audience") audienceHeader: string | undefined, @Headers("x-meeting-url") meetingUrlHeader: string | undefined, @Headers("x-source-app") sourceAppHeader: string | undefined, @Headers("x-file-name") fileNameHeader: string | undefined, @Headers("x-meetx-encoded-metadata") encodedMetadataHeader: string | undefined, @Headers("content-type") contentTypeHeader: string | undefined, @Headers("x-local-user-name") localUserNameHeader: string | undefined, @Headers("x-microphone-captured") microphoneHeader: string | undefined, @Headers("x-system-audio-captured") systemAudioHeader: string | undefined, @Headers("x-screen-video-captured") screenVideoHeader: string | undefined): Promise<{ meetingId: string; detailUrl: string; libraryUrl: string }> {
    const title = decodeMetadataHeader(titleHeader, encodedMetadataHeader);
    const audience = decodeMetadataHeader(audienceHeader, encodedMetadataHeader);
    const fileName = decodeMetadataHeader(fileNameHeader, encodedMetadataHeader);
    const localUserName = optionalHeader(decodeMetadataHeader(localUserNameHeader, encodedMetadataHeader));
    const uploadInput: Parameters<typeof saveUploadedMeeting>[0] = { request, title: title?.trim() || "Untitled meeting recording", audience: parseHeaderList(audience), originalFileName: fileName?.trim() || "recording.webm", mimeType: contentTypeHeader?.trim() || "video/webm" };
    const meetingUrl = optionalHeader(decodeMetadataHeader(meetingUrlHeader, encodedMetadataHeader));
    if (meetingUrl !== undefined) uploadInput.meetingUrl = meetingUrl;
    const sourceApp = optionalHeader(decodeMetadataHeader(sourceAppHeader, encodedMetadataHeader));
    if (sourceApp !== undefined) uploadInput.sourceApp = sourceApp;
    if (localUserName !== undefined) uploadInput.localUserName = localUserName;
    const microphone = parseBooleanHeader(microphoneHeader);
    if (microphone !== undefined) uploadInput.microphone = microphone;
    const systemAudio = parseBooleanHeader(systemAudioHeader);
    if (systemAudio !== undefined) uploadInput.systemAudio = systemAudio;
    const screenVideo = parseBooleanHeader(screenVideoHeader);
    if (screenVideo !== undefined) uploadInput.screenVideo = screenVideo;
    const meeting = await saveUploadedMeeting(uploadInput);
    await ensureFastPlayableCopy(meeting).catch(() => undefined);
    return { meetingId: meeting.id, detailUrl: `/meetings/${meeting.id}`, libraryUrl: "/library" };
  }

  @Post("/api/meetings/:id/metadata")
  async updateMeetingMetadata(@Param("id") id: string, @Body() body: MeetingMetadataBody): Promise<{ meetingId: string; detailUrl: string }> {
    const meeting = await getPrototypeMeeting(id);
    if (meeting === undefined) throw new HttpException("Meeting not found", HttpStatus.NOT_FOUND);
    const title = body.title?.trim();
    const meetingUrl = body.meetingUrl?.trim();
    const sourceApp = body.sourceApp?.trim();
    const updated: PrototypeMeeting = { ...meeting, title: title === undefined || title.length === 0 ? meeting.title : title, audience: parseHeaderList(body.audience) };
    if (meetingUrl === undefined || meetingUrl.length === 0) delete updated.meetingUrl; else updated.meetingUrl = meetingUrl;
    if (sourceApp === undefined || sourceApp.length === 0) delete updated.sourceApp; else updated.sourceApp = sourceApp;
    await updatePrototypeMeeting(updated);
    return { meetingId: updated.id, detailUrl: `/meetings/${updated.id}` };
  }




  @Post("/api/meetings/:id/notes")
  async addNote(@Param("id") id: string, @Body() body: MeetingNoteBody): Promise<{ meetingId: string; detailUrl: string }> {
    const text = body.text?.trim();
    if (text === undefined || text.length === 0) throw new HttpException("Note text is required", HttpStatus.BAD_REQUEST);
    const meeting = await addPrototypeNote(id, { text, timestampMs: typeof body.timestampMs === "number" ? body.timestampMs : 0, kind: parseNoteKind(body.kind) });
    if (meeting === undefined) throw new HttpException("Meeting not found", HttpStatus.NOT_FOUND);
    return { meetingId: meeting.id, detailUrl: `/meetings/${meeting.id}` };
  }
  @Post("/api/meetings/:id/delete")
  async deleteMeeting(@Param("id") id: string): Promise<{ ok: true; libraryUrl: string }> {
    const deleted = await deletePrototypeMeeting(id);
    if (!deleted) throw new HttpException("Meeting not found", HttpStatus.NOT_FOUND);
    return { ok: true, libraryUrl: "/library" };
  }

  @Get("/api/meetings/:id/status")
  async meetingStatus(@Param("id") id: string): Promise<ProcessStatusPayload> {
    const meeting = await getPrototypeMeeting(id);
    if (meeting === undefined) throw new HttpException("Meeting not found", HttpStatus.NOT_FOUND);
    return processStatusFor(meeting);
  }

  @Post("/api/meetings/:id/action-items/:actionId")
  async updateActionItem(@Param("id") id: string, @Param("actionId") actionId: string, @Body() body: ActionItemStatusBody): Promise<{ ok: true; completed: boolean }> {
    const meeting = await getPrototypeMeeting(id);
    if (meeting === undefined) throw new HttpException("Meeting not found", HttpStatus.NOT_FOUND);
    if (meeting.summary === undefined) throw new HttpException("Summary not found", HttpStatus.NOT_FOUND);
    const actionItems = meeting.summary.actionItems.map((item) => item.id === actionId ? { ...item, completed: body.completed === true } : item);
    if (actionItems.every((item, index) => item === meeting.summary?.actionItems[index])) throw new HttpException("Action item not found", HttpStatus.NOT_FOUND);
    const updated: PrototypeMeeting = { ...meeting, summary: { ...meeting.summary, actionItems } };
    await updatePrototypeMeeting(updated);
    return { ok: true, completed: body.completed === true };
  }

  @Post("/api/meetings/:id/ask")
  async askMeeting(@Param("id") id: string, @Body() body: AskMeetingBody): Promise<{ answer: string; citations: Array<{ segmentId: string; startMs: number; endMs: number; text: string }> }> {
    const meeting = await getPrototypeMeeting(id);
    if (meeting === undefined) throw new HttpException("Meeting not found", HttpStatus.NOT_FOUND);
    const question = normalizeQuestion(body.question);
    if (question.length === 0) throw new HttpException("Question is required", HttpStatus.BAD_REQUEST);
    return answerMeetingQuestion(meeting, question);
  }
  @Get("/meetings/:id/recording")
  async recording(@Param("id") id: string, @Headers("range") rangeHeader: string | undefined, @Res() response: ServerResponse): Promise<void> {
    await this.streamRecording(id, rangeHeader, response, "inline");
  }

  @Get("/meetings/:id/download")
  async downloadRecording(@Param("id") id: string, @Headers("range") rangeHeader: string | undefined, @Res() response: ServerResponse): Promise<void> {
    await this.streamRecording(id, rangeHeader, response, "attachment");
  }

  @Get("/meetings/:id/playback")
  async playableRecording(@Param("id") id: string, @Headers("range") rangeHeader: string | undefined, @Res() response: ServerResponse): Promise<void> {
    await this.streamRecording(id, rangeHeader, response, "inline", "playable");
  }

  private async streamRecording(id: string, rangeHeader: string | undefined, response: ServerResponse, disposition: "inline" | "attachment", variant: "raw" | "playable" = "raw"): Promise<void> {
    const meeting = await getPrototypeMeeting(id);
    if (meeting === undefined) throw new HttpException("Recording not found", HttpStatus.NOT_FOUND);
    const fileInfo = await stat(meeting.artifactPath).catch(() => undefined);
    if (fileInfo === undefined) throw new HttpException("Recording file not found", HttpStatus.NOT_FOUND);

    const mp4Path = legacyMp4ArtifactPath(meeting);
    const mp4Info = variant === "playable" ? await stat(mp4Path).catch(() => undefined) : undefined;
    const fastPlayablePath = playableArtifactPath(meeting);
    const fastPlayableInfo = variant === "playable" && mp4Info === undefined ? await stat(fastPlayablePath).catch(() => undefined) : undefined;
    const streamPath = mp4Info !== undefined ? mp4Path : fastPlayableInfo !== undefined ? fastPlayablePath : meeting.artifactPath;
    const streamInfo = mp4Info ?? fastPlayableInfo ?? fileInfo;
    const streamMimeType = mp4Info !== undefined ? "video/mp4" : fastPlayableInfo !== undefined ? "video/webm" : playbackMimeType(meeting);
    const streamExtension: "webm" | "mp4" = mp4Info !== undefined ? "mp4" : "webm";

    response.setHeader("Content-Type", streamMimeType);
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    response.setHeader("Content-Disposition", `${disposition}; filename="${safeDownloadName(meeting, streamExtension)}"`);

    if (rangeHeader === undefined) {
      response.statusCode = 200;
      response.setHeader("Content-Length", String(streamInfo.size));
      createReadStream(streamPath).pipe(response);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader.trim());
    if (match?.[1] === undefined || match[2] === undefined) {
      response.statusCode = 416;
      response.setHeader("Content-Range", `bytes */${String(streamInfo.size)}`);
      response.end();
      return;
    }

    const suffixLength = match[1].length === 0 && match[2].length > 0 ? Number(match[2]) : undefined;
    const requestedStart = suffixLength === undefined ? (match[1].length > 0 ? Number(match[1]) : 0) : Math.max(0, streamInfo.size - suffixLength);
    const requestedEnd = suffixLength === undefined && match[2].length > 0 ? Number(match[2]) : streamInfo.size - 1;
    const start = Math.max(0, Math.min(requestedStart, streamInfo.size - 1));
    const end = Math.max(start, Math.min(requestedEnd, streamInfo.size - 1));
    response.statusCode = 206;
    response.setHeader("Content-Type", streamMimeType);
    response.setHeader("Content-Range", `bytes ${String(start)}-${String(end)}/${String(streamInfo.size)}`);
    response.setHeader("Content-Length", String(end - start + 1));
    createReadStream(streamPath, { start, end }).pipe(response);
  }
  @Post("/api/meetings/:id/process")
  async processMeeting(@Param("id") id: string, @Body() body: ProcessMeetingBody | undefined): Promise<{ meetingId: string; status: PrototypeMeeting["status"]; detailUrl: string }> {
    const meeting = await getPrototypeMeeting(id);
    if (meeting === undefined) throw new HttpException("Meeting not found", HttpStatus.NOT_FOUND);
    if (processingMeetings.has(id)) {
      return { meetingId: meeting.id, status: "processing", detailUrl: "/meetings/" + meeting.id };
    }

    processingMeetings.add(id);
    const processingMeeting: PrototypeMeeting = { ...meeting, status: "processing" };
    delete processingMeeting.processingError;
    await updatePrototypeMeeting(processingMeeting);
    const languageHint = body?.languageHint?.trim();
    void runMeetingProcessing(id, languageHint === undefined || languageHint.length === 0 ? "en" : languageHint);
    return { meetingId: processingMeeting.id, status: "processing", detailUrl: "/meetings/" + processingMeeting.id };
  }

  @Get("/meetings/:id")
  @Header("Content-Type", "text/html; charset=utf-8")
  async detail(@Param("id") id: string, @Headers("cookie") cookieHeader: string | undefined): Promise<string> {
    const session = requirePrototypeSession(cookieHeader);
    const meeting = await getPrototypeMeeting(id);
    if (meeting === undefined) throw new HttpException("Meeting not found", HttpStatus.NOT_FOUND);
    const audience = meeting.audience.length === 0 ? "Not added" : meeting.audience.join(", ");
    const metadataHtml = `<dl><dt>Audience</dt><dd>${escapeHtml(audience)}</dd><dt>Source</dt><dd>${escapeHtml(meeting.sourceApp ?? "manual")}</dd><dt>Meeting URL</dt><dd>${meeting.meetingUrl === undefined ? "Not added" : `<a href="${escapeHtml(meeting.meetingUrl)}">${escapeHtml(meeting.meetingUrl)}</a>`}</dd></dl>`;
    const metadataEditorHtml = `<details class="card subtle"><summary><strong>Edit meeting metadata</strong></summary><label>Meeting title</label><input id="editTitle" value="${escapeHtml(meeting.title)}" /><label>Audience / participants</label><textarea id="editAudience">${escapeHtml(meeting.audience.join(", "))}</textarea><label>Meeting URL</label><input id="editMeetingUrl" value="${escapeHtml(meeting.meetingUrl ?? "")}" /><label>Source app</label><input id="editSourceApp" value="${escapeHtml(meeting.sourceApp ?? "")}" /><p><button id="saveMetadataButton" class="secondary">Save metadata</button></p><p class="mini" id="metadataStatus">You can add or correct metadata after the recording.</p></details>`;
    const failureHtml = meeting.processingError === undefined ? "" : `<div class="card"><h2>Processing setup needed</h2><p>${escapeHtml(meeting.processingError)}</p><code>MEETX_WHISPER_CLI_PATH=C:\\path\\to\\whisper-cli.exe\nMEETX_WHISPER_MODEL_PATH=C:\\path\\to\\ggml-base.bin or ggml-small.bin for Hindi\nMEETX_FFMPEG_PATH=C:\\path\\to\\ffmpeg.exe</code></div>`;
    const isAudioRecording = meeting.mimeType.toLowerCase().startsWith("audio/") || meeting.screenVideo !== true;
    const mp4Info = isAudioRecording ? undefined : await stat(legacyMp4ArtifactPath(meeting)).catch(() => undefined);
    const playableInfo = isAudioRecording || mp4Info !== undefined ? undefined : await stat(playableArtifactPath(meeting)).catch(() => undefined);
    const repairedCopyHtml = mp4Info !== undefined ? ` · playing standard MP4 copy` : playableInfo !== undefined ? ` · playing repaired WebM fallback` : ` · MP4 playback copy pending`;
    const mediaPlayerHtml = isAudioRecording ? `<audio id="meetingPlayer" controls preload="metadata" src="/meetings/${escapeHtml(meeting.id)}/recording"></audio><p class="mini">Audio-only recording. Enable Screen video in the desktop recorder when you need playback with visuals. <a href="/meetings/${escapeHtml(meeting.id)}/download">Download raw recording</a>.</p>` : `<video id="meetingPlayer" controls preload="metadata" src="/meetings/${escapeHtml(meeting.id)}/playback"></video><p class="mini"><a href="/meetings/${escapeHtml(meeting.id)}/playback">Open MP4 playback file</a> · <a href="/meetings/${escapeHtml(meeting.id)}/download">Download raw WebM</a>${repairedCopyHtml}</p>`;
    const transcriptHtml = meeting.transcript === undefined ? `<p>No real transcript yet. Click Process recording. If Whisper/FFmpeg are not configured, Meet-X will show setup instructions instead of fake transcript text.</p>` : meeting.transcript.map((segment) => `<article class="segment seekable-segment" data-start-ms="${String(segment.startMs)}" id="${escapeHtml(segment.segmentId)}"><div><strong>${escapeHtml(speakerDisplayName(segment.speakerId))}</strong><span>${formatTime(segment.startMs)}-${formatTime(segment.endMs)}</span></div><p>${escapeHtml(segment.text)}</p><small>${String(segment.words.length)} words - ${escapeHtml(segment.language)}</small></article>`).join("");
    const notesHtml = meeting.notes.length === 0 ? `<p>No timestamped notes yet. Play the recording, add a note, and Meet-X will save the current timestamp.</p>` : meeting.notes.sort((left, right) => left.timestampMs - right.timestampMs).map((note) => `<article class="segment"><div><strong>${escapeHtml(note.kind)}</strong><a class="seek-link" data-start-ms="${String(note.timestampMs)}" href="#">${formatTime(note.timestampMs)}</a></div><p>${escapeHtml(note.text)}</p><small>${escapeHtml(new Date(note.createdAt).toLocaleString())}</small></article>`).join("");
    const summaryHtml = renderSummaryForMeeting(meeting);
    const isProcessing = meeting.status === "processing" && processingMeetings.has(meeting.id);
    const visibleStatus = meeting.status === "processing" && !isProcessing ? "processing_interrupted" : meeting.status;
    const visibleStatusText = visibleStatus === "processing_interrupted" ? "processing interrupted" : visibleStatus.replaceAll("_", " ");
    const visibleStatusClass = visibleStatus === "processing_interrupted" ? "status warn" : statusClass(meeting.status);
    const processButtonHtml = '<button id="processButton" class="secondary"' + (isProcessing ? ' disabled' : '') + '>' + (isProcessing ? 'Processing...' : 'Process recording') + '</button>';
    const deleteButtonHtml = '<button id="deleteButton" class="danger" type="button"' + (isProcessing ? ' disabled' : '') + '>Delete recording</button>';
    const processStatusText = meeting.status === "processing" && !isProcessing ? "Processing was interrupted or the API restarted. Click Process recording to retry; existing transcript and summary will be kept until a new result is ready." : isProcessing ? "Whisper is processing this recording. You can leave this page open; Meet-X will not reload the player." : "";
    return renderSaasShell({ title: meeting.title, active: "library", session, body: `<section class="card"><p><span id="meetingStatus" data-status="${visibleStatus}" class="${visibleStatusClass}">${escapeHtml(visibleStatusText)}</span> - ${formatBytes(meeting.sizeBytes)} - ${escapeHtml(new Date(meeting.createdAt).toLocaleString())}</p>${metadataHtml}${metadataEditorHtml}${mediaPlayerHtml}<details class="card subtle" open><summary><strong>Timestamped notes</strong></summary><div class="setting-row"><div><h3>Add note at current time</h3><p class="mini">Use this for reactions, questions, decisions, or action items while reviewing playback.</p></div><div><label>Note type</label><select id="noteKind"><option value="note">Note</option><option value="question">Question</option><option value="decision">Decision</option><option value="action">Action item</option></select><label>Note</label><textarea id="noteText" placeholder="Add a timestamped note..."></textarea><p><button id="saveNoteButton" class="secondary" type="button">Save note</button></p><p id="noteStatus" class="mini"></p></div></div><div>${notesHtml}</div></details><div class="setting-row"><div><h3>Transcription language</h3><p class="mini">Choose English or Hindi for reliable results. Auto detection is experimental and rejects other detected languages.</p></div><div><select id="languageHint"><option value="en" selected>English - recommended</option><option value="hi">Hindi</option><option value="auto">Auto detect - experimental</option></select></div></div><p>${processButtonHtml} ${deleteButtonHtml} <a class="button" href="/library">Back to library</a></p><p id="processStatus">${escapeHtml(processStatusText)}</p></section>${failureHtml}<section class="two"><div class="card"><h2>Summary</h2>${summaryHtml}</div><div class="card"><h2>Transcript</h2>${transcriptHtml}</div></section><script>const player = document.getElementById("meetingPlayer"); document.querySelectorAll(".seek-link,.seekable-segment").forEach((element) => { element.addEventListener("click", (event) => { const raw = element.getAttribute("data-start-ms"); if (!raw || !player) { return; } event.preventDefault(); player.currentTime = Number(raw) / 1000; player.play().catch(() => undefined); }); }); document.getElementById("saveNoteButton")?.addEventListener("click", async () => { const status = document.getElementById("noteStatus"); const text = document.getElementById("noteText").value; status.textContent = "Saving note..."; const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, kind: document.getElementById("noteKind").value, timestampMs: Math.floor((player?.currentTime || 0) * 1000) }) }); if (!response.ok) { status.textContent = "Could not save note."; return; } window.location.reload(); }); document.getElementById("saveMetadataButton")?.addEventListener("click", async () => { const status = document.getElementById("metadataStatus"); status.textContent = "Saving metadata..."; const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: document.getElementById("editTitle").value, audience: document.getElementById("editAudience").value, meetingUrl: document.getElementById("editMeetingUrl").value, sourceApp: document.getElementById("editSourceApp").value }) }); if (!response.ok) { status.textContent = "Could not save metadata."; return; } window.location.reload(); }); const processButton = document.getElementById("processButton"); processButton?.addEventListener("click", async () => { const status = document.getElementById("processStatus"); processButton.disabled = true; processButton.textContent = "Processing..."; const badge = document.getElementById("meetingStatus"); if (badge) { badge.textContent = "processing"; badge.dataset.status = "processing"; badge.className = "status blue"; } status.textContent = "Whisper is processing this recording. You can leave this page safely."; const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ languageHint: document.getElementById("languageHint")?.value || "en" }) }); if (!response.ok) { status.textContent = "Could not start processing."; processButton.disabled = false; processButton.textContent = "Process recording"; return; } const payload = await response.json(); if (payload.status === "processing") { status.textContent = "This recording is already processing. Meet-X will not reload the player; check back from the library or click Process later."; return; } if (payload.status === "processed") { status.textContent = "Processing finished. Refresh manually when you are done watching to load the transcript and summary."; processButton.textContent = "Processed"; } else { status.textContent = "Processing ended with status: " + payload.status + ". Refresh manually when you are done watching."; processButton.disabled = false; processButton.textContent = "Process recording"; } }); document.getElementById("deleteButton")?.addEventListener("click", async () => { const status = document.getElementById("processStatus"); if (!confirm("Delete this recording? This removes the local media file, transcript, and summary from this prototype.")) { return; } status.textContent = "Deleting recording..."; const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/delete", { method: "POST" }); if (!response.ok) { status.textContent = "Delete failed."; return; } window.location.href = "/library"; }); document.querySelectorAll(".action-toggle").forEach((checkbox) => { checkbox.addEventListener("change", async () => { const actionId = checkbox.getAttribute("data-action-id"); if (!actionId) { return; } const checked = checkbox.checked === true; checkbox.closest(".task-item")?.classList.toggle("done", checked); const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/action-items/" + encodeURIComponent(actionId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: checked }) }); if (!response.ok) { checkbox.checked = !checked; checkbox.closest(".task-item")?.classList.toggle("done", !checked); } }); }); document.querySelector(".copy-followup")?.addEventListener("click", async (event) => { const text = document.querySelector(".followup pre")?.textContent || ""; await navigator.clipboard?.writeText(text).catch(() => undefined); event.target.textContent = "Copied"; }); document.getElementById("askButton")?.addEventListener("click", async () => { const box = document.getElementById("askAnswer"); const question = document.getElementById("askQuestion")?.value || ""; box.textContent = "Thinking over the transcript..."; const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) }); if (!response.ok) { box.textContent = "Ask Meeting needs a processed transcript first."; return; } const payload = await response.json(); box.innerHTML = "<p>" + payload.answer.replace(/[&<>]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[char])) + "</p>" + payload.citations.map((citation) => "<p><a class=\\"seek-link dynamic-seek\\" href=\\"#" + citation.segmentId + "\\" data-start-ms=\\"" + citation.startMs + "\\">" + Math.floor(citation.startMs / 1000) + "s</a> — " + citation.text.replace(/[&<>]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[char])) + "</p>").join(""); document.querySelectorAll(".dynamic-seek").forEach((element) => element.addEventListener("click", (event) => { event.preventDefault(); const raw = element.getAttribute("data-start-ms"); if (raw && player) { player.currentTime = Number(raw) / 1000; player.play().catch(() => undefined); } })); }); if (document.getElementById("meetingStatus")?.dataset.status === "processing") { window.setInterval(async () => { const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/status"); if (!response.ok) return; const payload = await response.json(); const badge = document.getElementById("meetingStatus"); const status = document.getElementById("processStatus"); if (badge) { badge.textContent = payload.status.replaceAll("_", " "); badge.dataset.status = payload.status; badge.className = payload.status === "processing_failed" || payload.status === "processing_interrupted" ? "status warn" : payload.status === "processed" ? "status" : "status blue"; } if (status) { status.textContent = payload.status === "processing" ? "Processing in background. Transcript segments ready: " + payload.transcriptCount + "." : payload.status === "processed" ? "Processing complete. Refresh when convenient to load the new intelligence panel." : payload.processingError || status.textContent; } }, 5000); }</script>` });
  }
}


















