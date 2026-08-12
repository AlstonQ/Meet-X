import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export const wordTimestampSchema = z.object({
  word: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive()
});

export const transcriptSegmentSchema = z.object({
  segmentId: z.string().regex(/^seg_[0-9A-HJKMNP-TV-Z]{26}$/),
  meetingId: z.string().regex(/^mtg_[0-9A-HJKMNP-TV-Z]{26}$/),
  speakerId: z.string().min(1),
  language: z.string().min(2),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string().min(1),
  words: z.array(wordTimestampSchema).min(1)
});

export const transcriptionInputSchema = z.object({
  meetingId: z.string().regex(/^mtg_[0-9A-HJKMNP-TV-Z]{26}$/),
  audioUrl: z.string().min(1),
  localMediaPath: z.string().min(1).optional(),
  languageHint: z.string().min(2).optional(),
  allowShortUtterances: z.boolean().optional(),
  speakerHints: z.object({
    localUserName: z.string().trim().min(1).max(80).optional(),
    microphone: z.boolean().optional(),
    systemAudio: z.boolean().optional()
  }).optional()
});

export const transcriptionResultSchema = z.object({
  provider: z.string().min(1),
  detectedLanguage: z.string().min(2),
  segments: z.array(transcriptSegmentSchema).min(1)
});

export type WordTimestamp = z.infer<typeof wordTimestampSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type TranscriptionInput = z.infer<typeof transcriptionInputSchema>;
export type TranscriptionResult = z.infer<typeof transcriptionResultSchema>;

export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

const fixtureLines = [
  { speakerId: "speaker_alston", text: "We need to ship the local recorder before adding integrations.", startMs: 0, language: "en" },
  { speakerId: "speaker_maya", text: "Decision: use local Whisper first and benchmark multilingual accuracy.", startMs: 5200, language: "en" },
  { speakerId: "speaker_alston", text: "Action item: Maya will prepare the golden transcript fixtures by Friday.", startMs: 11200, language: "en" },
  { speakerId: "speaker_maya", text: "Risk: browser audio capture depends on the user enabling tab or system audio.", startMs: 18200, language: "en" }
];

function makeSegmentId(index: number): string {
  const suffix = String(index + 1).padStart(26, "0");
  return `seg_${suffix}`;
}

function wordsFor(text: string, startMs: number): WordTimestamp[] {
  const tokens = text.split(/\s+/u);
  return tokens.map((word, index) => ({
    word,
    startMs: startMs + index * 420,
    endMs: startMs + index * 420 + 320
  }));
}

export class LocalFixtureTranscriptionProvider implements TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const parsed = transcriptionInputSchema.parse(input);
    const segments = fixtureLines.map((line, index) => {
      const words = wordsFor(line.text, line.startMs);
      const lastWord = words.at(-1);
      const endMs = lastWord?.endMs ?? line.startMs + 1000;
      return transcriptSegmentSchema.parse({
        segmentId: makeSegmentId(index),
        meetingId: parsed.meetingId,
        speakerId: line.speakerId,
        language: line.language,
        startMs: line.startMs,
        endMs,
        text: line.text,
        words
      });
    });

    return Promise.resolve(
      transcriptionResultSchema.parse({
        provider: "local-fixture-whisper-compatible",
        detectedLanguage: parsed.languageHint ?? "en",
        segments
      })
    );
  }
}

export class LocalWhisperUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalWhisperUnavailableError";
  }
}

async function firstExistingPath(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Keep looking; missing optional local tools are reported by the caller.
    }
  }
  return undefined;
}

async function resolveLocalToolPath(name: string, fallbacks: string[]): Promise<string> {
  const configured = process.env[name]?.trim();
  const discovered = await firstExistingPath([...(configured === undefined || configured.length === 0 ? [] : [configured]), ...fallbacks]);
  if (discovered === undefined) {
    throw new LocalWhisperUnavailableError(`${name} is not configured and no bundled local fallback was found.`);
  }
  return discovered;
}


export function normalizeLanguageHint(languageHint: string | undefined): string {
  const normalized = languageHint?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0 || normalized === "auto") {
    return "auto";
  }
  if (normalized === "english") {
    return "en";
  }
  if (normalized === "hindi") {
    return "hi";
  }
  return normalized;
}

export function buildWhisperLanguageArgs(languageHint: string | undefined): string[] {
  return ["-l", normalizeLanguageHint(languageHint)];
}

function isEnglishOnlyModelPath(modelPath: string): boolean {
  return /(?:^|[\\/])ggml-[^\\/]+\.en\.bin$/iu.test(modelPath);
}

function assertModelSupportsLanguage(modelPath: string, languageHint: string): void {
  if (languageHint !== "en" && isEnglishOnlyModelPath(modelPath)) {
    throw new LocalWhisperUnavailableError(`Hindi/multilingual transcription needs a multilingual Whisper model. Current model is English-only: ${modelPath}. Set MEETX_WHISPER_MODEL_PATH to a free multilingual whisper.cpp model such as ggml-base.bin or ggml-small.bin.`);
  }
}
function makeTextSegmentId(index: number): string {
  return makeSegmentId(index + 100);
}


function normalizeSpeechText(text: string): string {
  return text.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/gu, " ").trim();
}

function isRepeatedPhraseHallucination(normalized: string): boolean {
  const tokens = normalized.split(" ").filter((token) => token.length > 0);
  if (tokens.length < 8) return false;
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  const dominantTokenRatio = Math.max(...frequencies.values()) / tokens.length;
  const trigrams = new Map<string, number>();
  for (let index = 0; index <= tokens.length - 3; index += 1) {
    const trigram = tokens.slice(index, index + 3).join(" ");
    trigrams.set(trigram, (trigrams.get(trigram) ?? 0) + 1);
  }
  const repeatedTrigram = Math.max(...trigrams.values()) >= 3;
  return frequencies.size / tokens.length < 0.3 || dominantTokenRatio >= 0.45 || repeatedTrigram;
}

function isSubstantiveSpeech(text: string): boolean {
  const normalized = normalizeSpeechText(text);
  if (normalized.length < 12) return false;
  const nonSpeechPhrases = ["music", "gentle music", "background music", "applause", "silence", "inaudible", "no speech", "sound effect", "speaking in foreign language", "foreign language"];
  const nonSpeech = nonSpeechPhrases.some((phrase) => normalized === phrase || normalized.split(" ").every((token) => phrase.includes(token)));
  return !nonSpeech && !isRepeatedPhraseHallucination(normalized);
}

export function isLikelySpeech(text: string): boolean {
  const normalized = normalizeSpeechText(text);
  const nonSpeechPhrases = ["music", "gentle music", "background music", "applause", "silence", "inaudible", "no speech", "sound effect", "speaking in foreign language", "foreign language"];
  return /[\p{L}\p{N}]/u.test(normalized) && !nonSpeechPhrases.includes(normalized) && !isRepeatedPhraseHallucination(normalized);
}
export function parseWhisperDetectedLanguage(output: string): { language: string; confidence: number } | undefined {
  const match = /auto-detected language:\s*([a-z]{2,3})\s*\(p\s*=\s*([0-9.]+)\)/iu.exec(output);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { language: match[1].toLowerCase(), confidence: Number(match[2]) };
}

function assertContainsSpeech(transcriptText: string, allowShortUtterances: boolean): string[] {
  const lines = transcriptText.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
  const substantiveLines = lines.filter((line) => allowShortUtterances ? isLikelySpeech(line) : isSubstantiveSpeech(line));
  if (substantiveLines.length === 0) {
    throw new Error("Whisper did not detect intelligible spoken meeting audio. Re-record with system audio and/or microphone enabled, then choose English or Hindi explicitly.");
  }
  const occurrenceCounts = new Map<string, number>();
  const deduplicatedLines = substantiveLines.filter((line) => {
    const normalized = normalizeSpeechText(line);
    const count = occurrenceCounts.get(normalized) ?? 0;
    occurrenceCounts.set(normalized, count + 1);
    return count < 2 && !normalized.includes("for watching") && !normalized.includes("bell icon") && !normalized.includes("subscribe");
  });
  if (deduplicatedLines.length === 0) {
    throw new Error("Whisper produced only repeated or known hallucinated phrases, so Meet-X rejected the transcript.");
  }
  const normalizedLines = deduplicatedLines.map(normalizeSpeechText);
  if (normalizedLines.length >= 6) {
    const frequencies = new Map<string, number>();
    for (const line of normalizedLines) frequencies.set(line, (frequencies.get(line) ?? 0) + 1);
    const dominantLineRatio = Math.max(...frequencies.values()) / normalizedLines.length;
    if (frequencies.size / normalizedLines.length < 0.2 || dominantLineRatio >= 0.5) {
      throw new Error("Whisper output was dominated by repeated phrases and was rejected as a low-confidence hallucination. Choose English or Hindi explicitly, verify the captured audio is clear, or use the multilingual small model.");
    }
  }
  return deduplicatedLines;
}
function speakerIdFromName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 32);
  return normalized.length > 0 ? `speaker_${normalized}` : "speaker_user";
}

export function speakerIdForTranscriptTurn(index: number, speakerHints: TranscriptionInput["speakerHints"] | undefined): string {
  const localUserName = speakerHints?.localUserName?.trim();
  const localUserSpeakerId = localUserName === undefined || localUserName.length === 0 ? "speaker_user" : speakerIdFromName(localUserName);
  const microphone = speakerHints?.microphone === true;
  const systemAudio = speakerHints?.systemAudio === true;
  if (microphone && !systemAudio) return localUserSpeakerId;
  if (microphone && index === 0) return localUserSpeakerId;
  return `speaker_${index % 2 === 0 ? "1" : "2"}`;
}

function segmentsFromPlainText(meetingId: string, text: string, language: string, speakerHints?: TranscriptionInput["speakerHints"]): TranscriptSegment[] {
  const paragraphs = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const usableParagraphs = paragraphs.length > 0 ? paragraphs : [text.trim()].filter((line) => line.length > 0);
  return usableParagraphs.map((paragraph, index) => {
    const startMs = index * 15_000;
    const words = wordsFor(paragraph, startMs);
    const lastWord = words.at(-1);
    return transcriptSegmentSchema.parse({
      segmentId: makeTextSegmentId(index),
      meetingId,
      speakerId: speakerIdForTranscriptTurn(index, speakerHints),
      language,
      startMs,
      endMs: lastWord?.endMs ?? startMs + 1000,
      text: paragraph,
      words
    });
  });
}

export class LocalWhisperTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const parsed = transcriptionInputSchema.parse(input);
    if (parsed.localMediaPath === undefined) {
      throw new LocalWhisperUnavailableError("localMediaPath is required for local Whisper transcription.");
    }

    const fallbackRoot = "C:\\Users\\AlstonQuadros\\.codex\\.chatgpt-projects\\g-p-6a609bcb8b848191b42a1af1ecbb259e\\meeting-mom-electron\\local-whisper";
    const whisperPath = await resolveLocalToolPath("MEETX_WHISPER_CLI_PATH", [join(fallbackRoot, "bin", "whisper-cli.exe")]);
    const modelPath = await resolveLocalToolPath("MEETX_WHISPER_MODEL_PATH", [join(fallbackRoot, "models", "ggml-base.bin"), join(process.cwd(), "models", "whisper", "ggml-small.bin"), join(fallbackRoot, "models", "ggml-small.bin"), join(fallbackRoot, "models", "ggml-base.en.bin")]);
    const ffmpegPath = await resolveLocalToolPath("MEETX_FFMPEG_PATH", [join(fallbackRoot, "bin", "ffmpeg.exe"), "ffmpeg"]);
    const languageHint = normalizeLanguageHint(parsed.languageHint);
    assertModelSupportsLanguage(modelPath, languageHint);
    const workDir = await mkdtemp(join(tmpdir(), "meetx-whisper-"));
    const wavPath = join(workDir, `${basename(parsed.localMediaPath)}.wav`);
    const outputBase = join(workDir, "transcript");

    try {
      await execFileAsync(ffmpegPath, [
        "-y",
        "-i",
        parsed.localMediaPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        wavPath
      ]);

      const languageArgs = buildWhisperLanguageArgs(languageHint);
      const whisperResult = await execFileAsync(whisperPath, [
        "-m",
        modelPath,
        "-f",
        wavPath,
        "-otxt",
        "-of",
        outputBase,
        ...languageArgs,
        "-mc",
        "0",
        "-sns",
        "-nf"
      ]);

      const transcriptText = (await readFile(`${outputBase}.txt`, "utf8")).trim();
      if (transcriptText.length === 0) {
        throw new Error("Whisper produced an empty transcript.");
      }
      const transcriptLines = assertContainsSpeech(transcriptText, parsed.allowShortUtterances === true);

      const autoDetection = languageHint === "auto" ? parseWhisperDetectedLanguage(`${whisperResult.stdout}\n${whisperResult.stderr}`) : undefined;
      if (autoDetection !== undefined && !["en", "hi"].includes(autoDetection.language)) {
        throw new Error(`Auto detected ${autoDetection.language} at ${String(Math.round(autoDetection.confidence * 100))}% confidence, outside this English/Hindi mode. Choose English or Hindi explicitly.`);
      }
      const detectedLanguage = autoDetection?.language ?? languageHint;
      return transcriptionResultSchema.parse({
        provider: "local-whisper.cpp",
        detectedLanguage,
        segments: segmentsFromPlainText(parsed.meetingId, transcriptLines.join("\n"), detectedLanguage, parsed.speakerHints)
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}


















