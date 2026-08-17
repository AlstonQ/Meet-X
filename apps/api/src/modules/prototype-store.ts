import { createReadStream } from "node:fs";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { StreamableFile } from "@nestjs/common";
import type { MeetingSummary, TranscriptSegment } from "@meet-x/transcription";

const apiRoot = basename(process.cwd()) === "api" ? process.cwd() : join(process.cwd(), "apps", "api");
const storeRoot = join(apiRoot, "data", "prototype");
const uploadsRoot = join(storeRoot, "uploads");
const indexPath = join(storeRoot, "meetings.json");
const crockfordAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type PrototypeNote = {
  id: string;
  text: string;
  timestampMs: number;
  createdAt: string;
  kind: "note" | "question" | "decision" | "action";
};

export type PrototypeMeeting = {
  id: string;
  title: string;
  audience: string[];
  meetingUrl?: string;
  sourceApp?: string;
  localUserName?: string;
  microphone?: boolean;
  systemAudio?: boolean;
  screenVideo?: boolean;
  status: "uploaded" | "processing" | "processed" | "processing_failed";
  processingError?: string;
  createdAt: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  artifactPath: string;
  transcript?: TranscriptSegment[];
  summary?: MeetingSummary;
  notes: PrototypeNote[];
};

async function ensureStore(): Promise<void> {
  await mkdir(uploadsRoot, { recursive: true });
}

function createPrefixedUlid(prefix: "mtg" | "note"): string {
  const bytes = randomBytes(16);
  let value = "";
  for (let index = 0; index < 26; index += 1) {
    const byte = bytes[index % bytes.length] ?? 0;
    value += crockfordAlphabet[byte % crockfordAlphabet.length] ?? "0";
  }
  return `${prefix}_${value}`;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function normalizeNote(value: unknown): PrototypeNote | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Partial<PrototypeNote>;
  if (typeof record.id !== "string" || typeof record.text !== "string" || typeof record.timestampMs !== "number") {
    return undefined;
  }
  const kind = record.kind === "question" || record.kind === "decision" || record.kind === "action" ? record.kind : "note";
  return {
    id: record.id,
    text: record.text,
    timestampMs: Math.max(0, Math.floor(record.timestampMs)),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    kind
  };
}

function normalizeMeeting(value: unknown): PrototypeMeeting | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Partial<PrototypeMeeting>;
  if (typeof record.id !== "string" || typeof record.title !== "string" || typeof record.artifactPath !== "string") {
    return undefined;
  }
  const status = record.status === "processing" || record.status === "processed" || record.status === "processing_failed" ? record.status : "uploaded";
  const meeting: PrototypeMeeting = {
    id: record.id,
    title: record.title,
    audience: parseStringArray(record.audience),
    status,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    originalFileName: typeof record.originalFileName === "string" ? record.originalFileName : "recording.webm",
    mimeType: typeof record.mimeType === "string" ? record.mimeType : "video/webm",
    sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : 0,
    artifactPath: record.artifactPath,
    notes: Array.isArray(record.notes) ? record.notes.map(normalizeNote).filter((note): note is PrototypeNote => note !== undefined) : []
  };
  if (typeof record.meetingUrl === "string" && record.meetingUrl.length > 0) {
    meeting.meetingUrl = record.meetingUrl;
  }
  if (typeof record.sourceApp === "string" && record.sourceApp.length > 0) {
    meeting.sourceApp = record.sourceApp;
  }
  if (typeof record.localUserName === "string" && record.localUserName.length > 0) {
    meeting.localUserName = record.localUserName;
  }
  if (typeof record.microphone === "boolean") {
    meeting.microphone = record.microphone;
  }
  if (typeof record.systemAudio === "boolean") {
    meeting.systemAudio = record.systemAudio;
  }
  if (typeof record.screenVideo === "boolean") {
    meeting.screenVideo = record.screenVideo;
  }
  if (typeof record.processingError === "string" && record.processingError.length > 0) {
    meeting.processingError = record.processingError;
  }
  if (record.transcript !== undefined) {
    meeting.transcript = record.transcript;
  }
  if (record.summary !== undefined) {
    meeting.summary = record.summary;
  }
  return meeting;
}

async function readMeetings(): Promise<PrototypeMeeting[]> {
  await ensureStore();
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeMeeting).filter((meeting): meeting is PrototypeMeeting => meeting !== undefined);
  } catch {
    return [];
  }
}

async function writeMeetings(meetings: PrototypeMeeting[]): Promise<void> {
  await ensureStore();
  await writeFile(indexPath, JSON.stringify(meetings, null, 2), "utf8");
}

export async function listPrototypeMeetings(): Promise<PrototypeMeeting[]> {
  const meetings = await readMeetings();
  return meetings.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getPrototypeMeeting(id: string): Promise<PrototypeMeeting | undefined> {
  const meetings = await readMeetings();
  return meetings.find((meeting) => meeting.id === id);
}

export async function saveUploadedMeeting(input: {
  request: IncomingMessage;
  title: string;
  audience: string[];
  meetingUrl?: string;
  sourceApp?: string;
  localUserName?: string;
  microphone?: boolean;
  systemAudio?: boolean;
  screenVideo?: boolean;
  originalFileName: string;
  mimeType: string;
}): Promise<PrototypeMeeting> {
  await ensureStore();
  const id = createPrefixedUlid("mtg");
  const artifactPath = join(uploadsRoot, `${id}.webm`);
  let totalBytes = 0;
  const maxBytes = 500 * 1024 * 1024;

  const artifactFile = await open(artifactPath, "wx");
  try {
    for await (const chunk of input.request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        throw new Error("Recording upload exceeded the 500MB local prototype limit.");
      }
      await artifactFile.write(buffer);
    }
  } catch (error) {
    await artifactFile.close();
    await unlink(artifactPath).catch(() => undefined);
    throw error;
  } finally {
    await artifactFile.close().catch(() => undefined);
  }

  const fileInfo = await stat(artifactPath);
  const meeting: PrototypeMeeting = {
    id,
    title: input.title,
    audience: input.audience,
    status: "uploaded",
    createdAt: new Date().toISOString(),
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    sizeBytes: fileInfo.size,
    artifactPath,
    notes: []
  };
  if (input.meetingUrl !== undefined) {
    meeting.meetingUrl = input.meetingUrl;
  }
  if (input.sourceApp !== undefined) {
    meeting.sourceApp = input.sourceApp;
  }
  if (input.localUserName !== undefined) {
    meeting.localUserName = input.localUserName;
  }
  if (input.microphone !== undefined) {
    meeting.microphone = input.microphone;
  }
  if (input.systemAudio !== undefined) {
    meeting.systemAudio = input.systemAudio;
  }
  if (input.screenVideo !== undefined) {
    meeting.screenVideo = input.screenVideo;
  }

  const meetings = await readMeetings();
  meetings.push(meeting);
  await writeMeetings(meetings);
  return meeting;
}

export async function updatePrototypeMeeting(meeting: PrototypeMeeting): Promise<void> {
  const meetings = await readMeetings();
  const nextMeetings = meetings.map((existing) => existing.id === meeting.id ? meeting : existing);
  await writeMeetings(nextMeetings);
}



export async function addPrototypeNote(id: string, input: { text: string; timestampMs: number; kind: PrototypeNote["kind"] }): Promise<PrototypeMeeting | undefined> {
  const meeting = await getPrototypeMeeting(id);
  if (meeting === undefined) {
    return undefined;
  }

  const note: PrototypeNote = {
    id: createPrefixedUlid("note"),
    text: input.text.trim(),
    timestampMs: Math.max(0, Math.floor(input.timestampMs)),
    createdAt: new Date().toISOString(),
    kind: input.kind
  };
  const updated: PrototypeMeeting = { ...meeting, notes: [...meeting.notes, note] };
  await updatePrototypeMeeting(updated);
  return updated;
}
export async function deletePrototypeMeeting(id: string): Promise<boolean> {
  const meetings = await readMeetings();
  const meeting = meetings.find((existing) => existing.id === id);
  if (meeting === undefined) {
    return false;
  }

  const nextMeetings = meetings.filter((existing) => existing.id !== id);
  await writeMeetings(nextMeetings);
  try {
    await unlink(meeting.artifactPath);
  } catch {
    // The local index is the source of truth; missing files are already effectively deleted.
  }
  return true;
}
export async function getRecordingStream(id: string): Promise<{ file: StreamableFile; mimeType: string } | undefined> {
  const meeting = await getPrototypeMeeting(id);
  if (meeting === undefined) {
    return undefined;
  }

  return {
    file: new StreamableFile(createReadStream(meeting.artifactPath)),
    mimeType: meeting.mimeType
  };
}



