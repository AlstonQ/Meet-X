import { Body, Controller, Get, Header, Headers, HttpException, HttpStatus, Param, Post, Query, Req, Res } from "@nestjs/common";
import { LocalWhisperTranscriptionProvider, LocalWhisperUnavailableError, summarizeWithCitations } from "@meet-x/transcription";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { requirePrototypeSession, renderSaasShell } from "./auth.controller.js";
import { addPrototypeNote, deletePrototypeMeeting, getPrototypeMeeting, listPrototypeMeetings, saveUploadedMeeting, updatePrototypeMeeting, type PrototypeMeeting, type PrototypeNote } from "./prototype-store.js";

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

const processingMeetings = new Set<string>();

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

  @Post("/api/recordings")
  async uploadRecording(@Req() request: IncomingMessage, @Headers("x-meeting-title") titleHeader: string | undefined, @Headers("x-meeting-audience") audienceHeader: string | undefined, @Headers("x-meeting-url") meetingUrlHeader: string | undefined, @Headers("x-source-app") sourceAppHeader: string | undefined, @Headers("x-file-name") fileNameHeader: string | undefined, @Headers("x-meetx-encoded-metadata") encodedMetadataHeader: string | undefined, @Headers("content-type") contentTypeHeader: string | undefined, @Headers("x-local-user-name") localUserNameHeader: string | undefined, @Headers("x-microphone-captured") microphoneHeader: string | undefined, @Headers("x-system-audio-captured") systemAudioHeader: string | undefined): Promise<{ meetingId: string; detailUrl: string; libraryUrl: string }> {
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
    const meeting = await saveUploadedMeeting(uploadInput);
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
  @Get("/meetings/:id/recording")
  async recording(@Param("id") id: string, @Headers("range") rangeHeader: string | undefined, @Res() response: ServerResponse): Promise<void> {
    const meeting = await getPrototypeMeeting(id);
    if (meeting === undefined) throw new HttpException("Recording not found", HttpStatus.NOT_FOUND);
    const fileInfo = await stat(meeting.artifactPath).catch(() => undefined);
    if (fileInfo === undefined) throw new HttpException("Recording file not found", HttpStatus.NOT_FOUND);

    response.setHeader("Content-Type", meeting.mimeType);
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

    if (rangeHeader === undefined) {
      response.statusCode = 200;
      response.setHeader("Content-Length", String(fileInfo.size));
      createReadStream(meeting.artifactPath).pipe(response);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader.trim());
    if (match?.[1] === undefined || match[2] === undefined) {
      response.statusCode = 416;
      response.setHeader("Content-Range", `bytes */${String(fileInfo.size)}`);
      response.end();
      return;
    }

    const requestedStart = match[1].length > 0 ? Number(match[1]) : 0;
    const requestedEnd = match[2].length > 0 ? Number(match[2]) : fileInfo.size - 1;
    const start = Math.max(0, Math.min(requestedStart, fileInfo.size - 1));
    const end = Math.max(start, Math.min(requestedEnd, fileInfo.size - 1));
    response.statusCode = 206;
    response.setHeader("Content-Range", `bytes ${String(start)}-${String(end)}/${String(fileInfo.size)}`);
    response.setHeader("Content-Length", String(end - start + 1));
    createReadStream(meeting.artifactPath, { start, end }).pipe(response);
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
    delete processingMeeting.transcript;
    delete processingMeeting.summary;
    try {
      await updatePrototypeMeeting(processingMeeting);
      const languageHint = body?.languageHint?.trim();
      const transcript = await new LocalWhisperTranscriptionProvider().transcribe({ meetingId: processingMeeting.id, audioUrl: "/meetings/" + processingMeeting.id + "/recording", localMediaPath: processingMeeting.artifactPath, languageHint: languageHint === undefined || languageHint.length === 0 ? "en" : languageHint, speakerHints: { localUserName: processingMeeting.localUserName, microphone: processingMeeting.microphone, systemAudio: processingMeeting.systemAudio } });
      const updated: PrototypeMeeting = { ...processingMeeting, status: "processed", transcript: transcript.segments, summary: summarizeWithCitations(transcript.segments) };
      await updatePrototypeMeeting(updated);
      return { meetingId: updated.id, status: updated.status, detailUrl: "/meetings/" + updated.id };
    } catch (error) {
      const message = error instanceof LocalWhisperUnavailableError ? error.message + " Configure MEETX_WHISPER_CLI_PATH, MEETX_WHISPER_MODEL_PATH, and MEETX_FFMPEG_PATH to process real audio." : error instanceof Error ? error.message : "Unknown transcription failure.";
      const updated: PrototypeMeeting = { ...processingMeeting, status: "processing_failed", processingError: message };
      await updatePrototypeMeeting(updated);
      return { meetingId: updated.id, status: updated.status, detailUrl: "/meetings/" + updated.id };
    } finally {
      processingMeetings.delete(id);
    }
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
    const isAudioRecording = meeting.mimeType.toLowerCase().startsWith("audio/");
    const mediaPlayerHtml = isAudioRecording ? `<audio id="meetingPlayer" controls preload="metadata" src="/meetings/${escapeHtml(meeting.id)}/recording"></audio><p class="mini">Audio-only recording. Enable Screen video in the desktop recorder when you need playback with visuals.</p>` : `<video id="meetingPlayer" controls preload="metadata" src="/meetings/${escapeHtml(meeting.id)}/recording"></video>`;
    const transcriptHtml = meeting.transcript === undefined ? `<p>No real transcript yet. Click Process recording. If Whisper/FFmpeg are not configured, Meet-X will show setup instructions instead of fake transcript text.</p>` : meeting.transcript.map((segment) => `<article class="segment seekable-segment" data-start-ms="${String(segment.startMs)}" id="${escapeHtml(segment.segmentId)}"><div><strong>${escapeHtml(speakerDisplayName(segment.speakerId))}</strong><span>${formatTime(segment.startMs)}-${formatTime(segment.endMs)}</span></div><p>${escapeHtml(segment.text)}</p><small>${String(segment.words.length)} words - ${escapeHtml(segment.language)}</small></article>`).join("");
    const notesHtml = meeting.notes.length === 0 ? `<p>No timestamped notes yet. Play the recording, add a note, and Meet-X will save the current timestamp.</p>` : meeting.notes.sort((left, right) => left.timestampMs - right.timestampMs).map((note) => `<article class="segment"><div><strong>${escapeHtml(note.kind)}</strong><a class="seek-link" data-start-ms="${String(note.timestampMs)}" href="#">${formatTime(note.timestampMs)}</a></div><p>${escapeHtml(note.text)}</p><small>${escapeHtml(new Date(note.createdAt).toLocaleString())}</small></article>`).join("");
    const summaryHtml = meeting.summary === undefined ? `<p>No summary yet. Summary is generated only after real transcription succeeds.</p>` : `<p><strong>Overview:</strong> ${escapeHtml(meeting.summary.tldr.text)} <a class="seek-link" data-start-ms="${String(meeting.summary.tldr.citation.startMs)}" href="#${escapeHtml(meeting.summary.tldr.citation.segmentId)}">${formatTime(meeting.summary.tldr.citation.startMs)}</a></p><h2>Key points</h2><ul>${meeting.summary.keyPoints.map((point) => `<li>${escapeHtml(point.text)} <a class="seek-link" data-start-ms="${String(point.citation.startMs)}" href="#${escapeHtml(point.citation.segmentId)}">${formatTime(point.citation.startMs)}</a></li>`).join("")}</ul><h2>Decisions</h2><ul>${meeting.summary.decisions.map((decision) => `<li>${escapeHtml(decision.text)} <a class="seek-link" data-start-ms="${String(decision.citation.startMs)}" href="#${escapeHtml(decision.citation.segmentId)}">${formatTime(decision.citation.startMs)}</a></li>`).join("")}</ul><h2>Action items / next steps</h2><ul>${meeting.summary.actionItems.map((item) => `<li><strong>${escapeHtml(speakerDisplayName(item.owner))}</strong>: ${escapeHtml(item.task)} <a class="seek-link" data-start-ms="${String(item.citation.startMs)}" href="#${escapeHtml(item.citation.segmentId)}">${formatTime(item.citation.startMs)}</a></li>`).join("")}</ul>`;
    const isProcessing = meeting.status === "processing";
    const processButtonHtml = '<button id="processButton" class="secondary"' + (isProcessing ? ' disabled' : '') + '>' + (isProcessing ? 'Processing...' : 'Process recording') + '</button>';
    const deleteButtonHtml = '<button id="deleteButton" class="danger" type="button"' + (isProcessing ? ' disabled' : '') + '>Delete recording</button>';
    const processStatusText = isProcessing ? "Whisper is processing this recording. You can leave this page; it will refresh automatically." : "";
    return renderSaasShell({ title: meeting.title, active: "library", session, body: `<section class="card"><p><span id="meetingStatus" data-status="${meeting.status}" class="${statusClass(meeting.status)}">${escapeHtml(meeting.status.replaceAll("_", " "))}</span> - ${formatBytes(meeting.sizeBytes)} - ${escapeHtml(new Date(meeting.createdAt).toLocaleString())}</p>${metadataHtml}${metadataEditorHtml}${mediaPlayerHtml}<details class="card subtle" open><summary><strong>Timestamped notes</strong></summary><div class="setting-row"><div><h3>Add note at current time</h3><p class="mini">Use this for reactions, questions, decisions, or action items while reviewing playback.</p></div><div><label>Note type</label><select id="noteKind"><option value="note">Note</option><option value="question">Question</option><option value="decision">Decision</option><option value="action">Action item</option></select><label>Note</label><textarea id="noteText" placeholder="Add a timestamped note..."></textarea><p><button id="saveNoteButton" class="secondary" type="button">Save note</button></p><p id="noteStatus" class="mini"></p></div></div><div>${notesHtml}</div></details><div class="setting-row"><div><h3>Transcription language</h3><p class="mini">Choose English or Hindi for reliable results. Auto detection is experimental and rejects other detected languages.</p></div><div><select id="languageHint"><option value="en" selected>English - recommended</option><option value="hi">Hindi</option><option value="auto">Auto detect - experimental</option></select></div></div><p>${processButtonHtml} ${deleteButtonHtml} <a class="button" href="/library">Back to library</a></p><p id="processStatus">${escapeHtml(processStatusText)}</p></section>${failureHtml}<section class="two"><div class="card"><h2>Summary</h2>${summaryHtml}</div><div class="card"><h2>Transcript</h2>${transcriptHtml}</div></section><script>const player = document.getElementById("meetingPlayer"); document.querySelectorAll(".seek-link,.seekable-segment").forEach((element) => { element.addEventListener("click", (event) => { const raw = element.getAttribute("data-start-ms"); if (!raw || !player) { return; } event.preventDefault(); player.currentTime = Number(raw) / 1000; player.play().catch(() => undefined); }); }); document.getElementById("saveNoteButton")?.addEventListener("click", async () => { const status = document.getElementById("noteStatus"); const text = document.getElementById("noteText").value; status.textContent = "Saving note..."; const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, kind: document.getElementById("noteKind").value, timestampMs: Math.floor((player?.currentTime || 0) * 1000) }) }); if (!response.ok) { status.textContent = "Could not save note."; return; } window.location.reload(); }); document.getElementById("saveMetadataButton")?.addEventListener("click", async () => { const status = document.getElementById("metadataStatus"); status.textContent = "Saving metadata..."; const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: document.getElementById("editTitle").value, audience: document.getElementById("editAudience").value, meetingUrl: document.getElementById("editMeetingUrl").value, sourceApp: document.getElementById("editSourceApp").value }) }); if (!response.ok) { status.textContent = "Could not save metadata."; return; } window.location.reload(); }); const processButton = document.getElementById("processButton"); processButton?.addEventListener("click", async () => { const status = document.getElementById("processStatus"); processButton.disabled = true; processButton.textContent = "Processing..."; const badge = document.getElementById("meetingStatus"); if (badge) { badge.textContent = "processing"; badge.dataset.status = "processing"; badge.className = "status blue"; } status.textContent = "Whisper is processing this recording. You can leave this page safely."; const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ languageHint: document.getElementById("languageHint")?.value || "en" }) }); if (!response.ok) { status.textContent = "Could not start processing."; processButton.disabled = false; processButton.textContent = "Process recording"; return; } const payload = await response.json(); if (payload.status === "processing") { status.textContent = "This recording is already processing. The page will refresh automatically."; setTimeout(() => window.location.reload(), 3000); return; } window.location.reload(); }); if (document.getElementById("meetingStatus")?.dataset.status === "processing") { setTimeout(() => window.location.reload(), 3000); } document.getElementById("deleteButton")?.addEventListener("click", async () => { const status = document.getElementById("processStatus"); if (!confirm("Delete this recording? This removes the local media file, transcript, and summary from this prototype.")) { return; } status.textContent = "Deleting recording..."; const response = await fetch("/api/meetings/${escapeHtml(meeting.id)}/delete", { method: "POST" }); if (!response.ok) { status.textContent = "Delete failed."; return; } window.location.href = "/library"; });</script>` });
  }
}







