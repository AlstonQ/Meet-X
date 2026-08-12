import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, Post, Req, UnprocessableEntityException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { LocalWhisperTranscriptionProvider, summarizeWithCitations, transcriptSegmentSchema, type TranscriptSegment } from "@meet-x/transcription";
import { z } from "zod";
import { getPrototypeMeeting, updatePrototypeMeeting, type PrototypeMeeting } from "./prototype-store.js";

const sessionIdSchema = z.string().regex(/^cap_[0-9a-f]{32}$/);
const meetingIdSchema = z.string().regex(/^mtg_[0-9A-HJKMNP-TV-Z]{26}$/);
const languageSchema = z.enum(["auto", "en", "hi"]);
const startBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  audience: z.array(z.string().trim().min(1).max(320)).max(100).default([]),
  sourceApp: z.string().trim().min(1).max(100),
  languageHint: languageSchema.default("auto"),
  screenVideo: z.boolean().default(false),
  microphone: z.boolean().default(false),
  systemAudio: z.boolean().default(false),
  localUserName: z.string().trim().min(1).max(80).optional()
});
const finalizeBodySchema = z.object({ meetingId: meetingIdSchema });
const completeBodySchema = z.object({ meetingId: meetingIdSchema, mode: z.enum(["post_fallback", "post"]).default("post_fallback") });
const crockfordAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const maxChunkBytes = 32 * 1024 * 1024;
const liveRoot = join(process.cwd(), "data", "prototype", "live-transcription");
const chunksRoot = join(liveRoot, "chunks");

const liveChunkStateSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  segments: z.array(transcriptSegmentSchema)
});
const liveStateSchema = z.object({
  sessionId: sessionIdSchema,
  status: z.enum(["recording", "finalizing", "completed", "failed"]),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: startBodySchema,
  chunks: z.array(liveChunkStateSchema),
  meetingId: meetingIdSchema.optional(),
  detailUrl: z.string().startsWith("/").optional(),
  error: z.string().max(1000).optional()
});

type LiveState = z.infer<typeof liveStateSchema>;
type LiveSessionResponse = {
  sessionId: string;
  status: LiveState["status"];
  startedAt: string;
  updatedAt: string;
  metadata: LiveState["metadata"];
  segments: TranscriptSegment[];
  meetingId?: string;
  detailUrl?: string;
  error?: string;
};

function prefixedStableId(prefix: "mtg" | "seg", value: string): string {
  const digest = createHash("sha256").update(value).digest();
  let suffix = "";
  for (let index = 0; index < 26; index += 1) {
    const byte = digest[index % digest.length] ?? 0;
    suffix += crockfordAlphabet[byte % crockfordAlphabet.length] ?? "0";
  }
  return prefix + "_" + suffix;
}

function parseIntegerHeader(value: string | undefined, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(name + " must be an integer between " + String(minimum) + " and " + String(maximum) + ".");
  }
  return parsed;
}

function liveStatePath(sessionId: string): string {
  return join(liveRoot, sessionId + ".json");
}

async function ensureLiveStore(): Promise<void> {
  await mkdir(chunksRoot, { recursive: true });
}

function createLiveState(sessionId: string, metadata?: LiveState["metadata"]): LiveState {
  const now = new Date().toISOString();
  return {
    sessionId,
    status: "recording",
    startedAt: now,
    updatedAt: now,
    metadata: metadata ?? {
      title: "Live meeting",
      audience: [],
      sourceApp: "Meet-X Desktop Recorder",
      languageHint: "auto",
      screenVideo: false,
      microphone: false,
      systemAudio: false
    },
    chunks: []
  };
}

async function readLiveState(sessionId: string): Promise<LiveState | undefined> {
  try {
    const raw = await readFile(liveStatePath(sessionId), "utf8");
    return liveStateSchema.parse(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

async function writeLiveState(state: LiveState): Promise<void> {
  await ensureLiveStore();
  await writeFile(liveStatePath(state.sessionId), JSON.stringify(liveStateSchema.parse(state), null, 2), "utf8");
}

async function listLiveStates(): Promise<LiveState[]> {
  await ensureLiveStore();
  const files = await readdir(liveRoot).catch(() => []);
  const states = await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
    const parsed = sessionIdSchema.safeParse(file.slice(0, -5));
    return parsed.success ? readLiveState(parsed.data) : undefined;
  }));
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return states
    .filter((state): state is LiveState => state !== undefined && Date.parse(state.updatedAt) >= cutoff)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function segmentsFor(state: LiveState): TranscriptSegment[] {
  return [...state.chunks]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .flatMap((chunk) => chunk.segments)
    .sort((left, right) => left.startMs - right.startMs);
}

function publicSession(state: LiveState): LiveSessionResponse {
  const response: LiveSessionResponse = {
    sessionId: state.sessionId,
    status: state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    metadata: state.metadata,
    segments: segmentsFor(state)
  };
  if (state.meetingId !== undefined) response.meetingId = state.meetingId;
  if (state.detailUrl !== undefined) response.detailUrl = state.detailUrl;
  if (state.error !== undefined) response.error = state.error;
  return response;
}

async function writeRequestChunk(request: IncomingMessage, filePath: string): Promise<void> {
  const declaredLength = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxChunkBytes) {
    throw new BadRequestException("Live transcription chunk exceeded the 32MB limit.");
  }
  const file = await open(filePath, "w");
  let totalBytes = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
      totalBytes += buffer.length;
      if (totalBytes > maxChunkBytes) throw new BadRequestException("Live transcription chunk exceeded the 32MB limit.");
      await file.write(buffer);
    }
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    throw error;
  } finally {
    await file.close().catch(() => undefined);
  }
  if (totalBytes === 0) {
    await unlink(filePath).catch(() => undefined);
    throw new BadRequestException("Live transcription chunk was empty.");
  }
}

function offsetSegments(input: {
  segments: TranscriptSegment[];
  sessionId: string;
  chunkIndex: number;
  startMs: number;
  durationMs: number;
}): TranscriptSegment[] {
  const segmentCount = Math.max(1, input.segments.length);
  return input.segments.map((segment, segmentIndex) => {
    const relativeStart = Math.floor((segmentIndex * input.durationMs) / segmentCount);
    const relativeEnd = Math.max(relativeStart + 1, Math.floor(((segmentIndex + 1) * input.durationMs) / segmentCount));
    const wordCount = Math.max(1, segment.words.length);
    return {
      ...segment,
      segmentId: prefixedStableId("seg", input.sessionId + ":" + String(input.chunkIndex) + ":" + String(segmentIndex)),
      startMs: input.startMs + relativeStart,
      endMs: input.startMs + relativeEnd,
      words: segment.words.map((word, wordIndex) => {
        const wordStart = relativeStart + Math.floor((wordIndex * (relativeEnd - relativeStart)) / wordCount);
        const wordEnd = relativeStart + Math.max(1, Math.floor(((wordIndex + 1) * (relativeEnd - relativeStart)) / wordCount));
        return { ...word, startMs: input.startMs + wordStart, endMs: input.startMs + wordEnd };
      })
    };
  });
}

function isExpectedSilentChunk(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("did not detect spoken meeting audio") || error.message.includes("empty transcript"));
}

@Controller("api/live-transcription")
export class LiveTranscriptionController {
  @Get()
  async list(): Promise<{ sessions: LiveSessionResponse[] }> {
    return { sessions: (await listLiveStates()).map(publicSession) };
  }

  @Get(":sessionId")
  async get(@Param("sessionId") rawSessionId: string): Promise<LiveSessionResponse> {
    const sessionId = sessionIdSchema.parse(rawSessionId);
    const state = await readLiveState(sessionId);
    if (state === undefined) throw new NotFoundException("Live meeting not found.");
    return publicSession(state);
  }

  @Post(":sessionId/start")
  @HttpCode(201)
  async start(@Param("sessionId") rawSessionId: string, @Body() rawBody: unknown): Promise<{ sessionId: string; status: "recording"; liveUrl: string }> {
    const sessionId = sessionIdSchema.parse(rawSessionId);
    const metadata = startBodySchema.parse(rawBody);
    const existing = await readLiveState(sessionId);
    await writeLiveState({ ...(existing ?? createLiveState(sessionId, metadata)), status: "recording", updatedAt: new Date().toISOString(), metadata });
    return { sessionId, status: "recording", liveUrl: "/live/" + sessionId };
  }

  @Post(":sessionId/chunks")
  @HttpCode(200)
  async transcribeChunk(
    @Param("sessionId") rawSessionId: string,
    @Headers("x-chunk-index") rawChunkIndex: string | undefined,
    @Headers("x-start-ms") rawStartMs: string | undefined,
    @Headers("x-duration-ms") rawDurationMs: string | undefined,
    @Headers("x-language-hint") rawLanguageHint: string | undefined,
    @Req() request: IncomingMessage
  ): Promise<{ status: "transcribed" | "silence"; segments: TranscriptSegment[]; totalSegments: number }> {
    const sessionId = sessionIdSchema.parse(rawSessionId);
    const chunkIndex = parseIntegerHeader(rawChunkIndex, "x-chunk-index", 0, 100_000);
    const startMs = parseIntegerHeader(rawStartMs, "x-start-ms", 0, 24 * 60 * 60 * 1000);
    const durationMs = parseIntegerHeader(rawDurationMs, "x-duration-ms", 250, 60_000);
    const languageHint = languageSchema.parse(rawLanguageHint?.trim() || "auto");
    await ensureLiveStore();
    const chunkPath = join(chunksRoot, sessionId + "-" + String(chunkIndex) + ".webm");
    await writeRequestChunk(request, chunkPath);
    const state = await readLiveState(sessionId) ?? createLiveState(sessionId);

    let segments: TranscriptSegment[];
    try {
      const transcript = await new LocalWhisperTranscriptionProvider().transcribe({
        meetingId: prefixedStableId("mtg", sessionId),
        audioUrl: "/live-transcription/" + sessionId + "/chunks/" + String(chunkIndex),
        localMediaPath: chunkPath,
        languageHint,
        allowShortUtterances: true,
        speakerHints: { localUserName: state.metadata.localUserName, microphone: state.metadata.microphone, systemAudio: state.metadata.systemAudio }
      });
      segments = offsetSegments({ segments: transcript.segments, sessionId, chunkIndex, startMs, durationMs });
    } catch (error) {
      if (isExpectedSilentChunk(error)) {
        await writeLiveState({ ...state, updatedAt: new Date().toISOString() });
        return { status: "silence", segments: [], totalSegments: segmentsFor(state).length };
      }
      throw error;
    } finally {
      await unlink(chunkPath).catch(() => undefined);
    }

    const chunks = [...state.chunks.filter((chunk) => chunk.chunkIndex !== chunkIndex), { chunkIndex, startMs, durationMs, segments }]
      .sort((left, right) => left.chunkIndex - right.chunkIndex);
    await writeLiveState({ ...state, status: "recording", updatedAt: new Date().toISOString(), chunks });
    return { status: "transcribed", segments, totalSegments: chunks.flatMap((chunk) => chunk.segments).length };
  }

  @Post(":sessionId/finalize")
  @HttpCode(200)
  async finalize(@Param("sessionId") rawSessionId: string, @Body() rawBody: unknown): Promise<{ meetingId: string; status: "processed"; mode: "live"; segmentCount: number; detailUrl: string }> {
    const sessionId = sessionIdSchema.parse(rawSessionId);
    const body = finalizeBodySchema.parse(rawBody);
    const meeting = await getPrototypeMeeting(body.meetingId);
    if (meeting === undefined) throw new NotFoundException("Meeting not found.");
    const state = await readLiveState(sessionId) ?? createLiveState(sessionId);
    await writeLiveState({ ...state, status: "finalizing", updatedAt: new Date().toISOString() });

    const processingMeeting: PrototypeMeeting = { ...meeting, status: "processing" };
    delete processingMeeting.processingError;
    await updatePrototypeMeeting(processingMeeting);
    const segments = segmentsFor(state).map((segment) => ({ ...segment, meetingId: body.meetingId }));
    if (segments.length === 0) {
      const message = "No live speech was transcribed. Retry with post-recording processing.";
      await updatePrototypeMeeting({ ...processingMeeting, status: "processing_failed", processingError: message });
      await writeLiveState({ ...state, status: "failed", updatedAt: new Date().toISOString(), error: message });
      throw new UnprocessableEntityException(message);
    }

    await updatePrototypeMeeting({ ...processingMeeting, status: "processed", transcript: segments, summary: summarizeWithCitations(segments) });
    const detailUrl = "/meetings/" + body.meetingId;
    const completed: LiveState = { ...state, status: "completed", updatedAt: new Date().toISOString(), meetingId: body.meetingId, detailUrl };
    delete completed.error;
    await writeLiveState(completed);
    return { meetingId: body.meetingId, status: "processed", mode: "live", segmentCount: segments.length, detailUrl };
  }

  @Post(":sessionId/complete")
  @HttpCode(200)
  async complete(@Param("sessionId") rawSessionId: string, @Body() rawBody: unknown): Promise<{ meetingId: string; status: "completed"; detailUrl: string }> {
    const sessionId = sessionIdSchema.parse(rawSessionId);
    const body = completeBodySchema.parse(rawBody);
    const state = await readLiveState(sessionId) ?? createLiveState(sessionId);
    const detailUrl = "/meetings/" + body.meetingId;
    const completed: LiveState = { ...state, status: "completed", updatedAt: new Date().toISOString(), meetingId: body.meetingId, detailUrl };
    delete completed.error;
    await writeLiveState(completed);
    return { meetingId: body.meetingId, status: "completed", detailUrl };
  }

  @Delete(":sessionId")
  @HttpCode(204)
  async discard(@Param("sessionId") rawSessionId: string): Promise<void> {
    await rm(liveStatePath(sessionIdSchema.parse(rawSessionId)), { force: true });
  }
}



