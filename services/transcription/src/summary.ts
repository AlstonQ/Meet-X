import { z } from "zod";
import type { TranscriptSegment } from "./transcription-provider.js";

export const citationSchema = z.object({
  segmentId: z.string().regex(/^seg_[0-9A-HJKMNP-TV-Z]{26}$/),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive()
});

export const citedTextSchema = z.object({
  text: z.string().min(1),
  citation: citationSchema
});

export const meetingSummarySchema = z.object({
  tldr: citedTextSchema,
  keyPoints: z.array(citedTextSchema).min(1),
  decisions: z.array(citedTextSchema),
  actionItems: z.array(
    z.object({
      task: z.string().min(1),
      owner: z.string().min(1),
      citation: citationSchema
    })
  )
});

export type MeetingSummary = z.infer<typeof meetingSummarySchema>;

function citationFor(segment: TranscriptSegment): z.infer<typeof citationSchema> {
  return {
    segmentId: segment.segmentId,
    startMs: segment.startMs,
    endMs: segment.endMs
  };
}

function sentenceCase(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function cleanSummaryText(text: string): string {
  return text
    .replace(/^\s*(decision|action item|risk|key point|summary)\s*:\s*/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function uniqueByText(segments: TranscriptSegment[]): TranscriptSegment[] {
  const seen = new Set<string>();
  return segments.filter((segment) => {
    const key = cleanSummaryText(segment.text).toLowerCase();
    if (key.length === 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function segmentTextLength(segment: TranscriptSegment): number {
  return cleanSummaryText(segment.text).length;
}

function matchingSegments(segments: TranscriptSegment[], pattern: RegExp): TranscriptSegment[] {
  return uniqueByText(segments.filter((segment) => pattern.test(segment.text)));
}

function chooseKeyPointSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const explicit = matchingSegments(segments, /\b(key point|important|priority|risk|blocker|issue|problem|customer|requirement|deadline|timeline|budget|pricing|proposal|rfp|launch|ship)\b/iu);
  const fallback = uniqueByText([...explicit, ...segments].sort((left, right) => segmentTextLength(right) - segmentTextLength(left)));
  return fallback.slice(0, Math.min(5, Math.max(1, fallback.length)));
}

function chooseDecisionSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return matchingSegments(segments, /\b(decision|decided|agreed|approved|confirmed|final|we will|we'll|let's|going to|chosen|choose|use|ship)\b/iu).slice(0, 5);
}

function chooseActionSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return matchingSegments(segments, /\b(action item|follow up|todo|to do|will|need to|needs to|send|share|prepare|create|schedule|review|call|email|update|deliver|finish)\b/iu).slice(0, 7);
}

function ownerFor(segment: TranscriptSegment): string {
  const text = cleanSummaryText(segment.text);
  const explicitOwner = /\b([A-Z][a-zA-Z]{1,30})\s+(?:will|to|needs to|should|can)\b/u.exec(text);
  const owner = explicitOwner?.[1];
  if (owner !== undefined && !["I", "We", "You", "They"].includes(owner)) return owner;
  return segment.speakerId;
}

function hasNamedOwner(segment: TranscriptSegment): boolean {
  return ownerFor(segment) !== segment.speakerId;
}

function asOutcome(segment: TranscriptSegment): string {
  const text = cleanSummaryText(segment.text);
  if (/\b(decision|decided|agreed|approved|confirmed)\b/iu.test(segment.text)) return sentenceCase(text);
  return "The team aligned that " + text.replace(/^we\s+/iu, "they ").replace(/^i\s+/iu, "the speaker ");
}

function asKeyPoint(segment: TranscriptSegment): string {
  const text = cleanSummaryText(segment.text);
  if (/\b(risk|blocker|issue|problem)\b/iu.test(segment.text)) return "Risk to track: " + text;
  if (/\b(customer|requirement|deadline|timeline|budget|pricing|proposal|launch|ship)\b/iu.test(segment.text)) return "Important context: " + text;
  return sentenceCase(text);
}

function asActionTask(segment: TranscriptSegment): string {
  const text = cleanSummaryText(segment.text);
  const withoutOwner = text.replace(/^([A-Z][a-zA-Z]{1,30})\s+(?:will|to|needs to|should|can)\s+/u, "");
  return sentenceCase(withoutOwner);
}

export function summarizeWithCitations(segments: TranscriptSegment[]): MeetingSummary {
  const firstSegment = segments[0];
  if (firstSegment === undefined) {
    throw new Error("Cannot summarize an empty transcript.");
  }

  const orderedSegments = uniqueByText(segments).sort((left, right) => left.startMs - right.startMs);
  const decisions = chooseDecisionSegments(orderedSegments).map((segment) => ({
    text: asOutcome(segment),
    citation: citationFor(segment)
  }));
  const actionItems = chooseActionSegments(orderedSegments).sort((left, right) => Number(hasNamedOwner(right)) - Number(hasNamedOwner(left))).map((segment) => ({
    task: asActionTask(segment),
    owner: ownerFor(segment),
    citation: citationFor(segment)
  }));
  const keyPoints = chooseKeyPointSegments(orderedSegments).map((segment) => ({
    text: asKeyPoint(segment),
    citation: citationFor(segment)
  }));
  const tldrSource = decisions[0] ?? keyPoints[0] ?? { text: "The meeting centered on " + cleanSummaryText(firstSegment.text), citation: citationFor(firstSegment) };

  return meetingSummarySchema.parse({
    tldr: tldrSource,
    keyPoints,
    decisions,
    actionItems
  });
}
