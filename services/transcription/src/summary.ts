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
      id: z.string().min(1),
      task: z.string().min(1),
      owner: z.string().min(1),
      priority: z.enum(["low", "medium", "high"]),
      completed: z.boolean(),
      dueDate: z.string().optional(),
      citation: citationSchema
    })
  ),
  risks: z.array(citedTextSchema),
  openQuestions: z.array(citedTextSchema),
  followUpDraft: z.object({
    subject: z.string().min(1),
    body: z.string().min(1),
    citation: citationSchema
  })
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
  const explicit = matchingSegments(segments, /\b(key point|important|priority|risk|blocker|issue|problem|customer|requirement|deadline|timeline|budget|pricing|proposal|rfp|launch|ship|baseline|value|decision|next step)\b/iu);
  const fallback = uniqueByText([...explicit, ...segments].sort((left, right) => segmentTextLength(right) - segmentTextLength(left)));
  return fallback.slice(0, Math.min(6, Math.max(1, fallback.length)));
}

function chooseDecisionSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return matchingSegments(segments, /\b(decision|decided|agreed|approved|confirmed|final|we will|we'll|let's|going to|chosen|choose|use|ship|baseline|proposal)\b/iu).slice(0, 6);
}

function chooseActionSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return matchingSegments(segments, /\b(action item|follow up|todo|to do|will|need to|needs to|send|share|prepare|create|schedule|review|call|email|update|deliver|finish|confirm|baseline)\b/iu).slice(0, 8);
}

function chooseRiskSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return matchingSegments(segments, /\b(risk|blocker|blocked|concern|issue|problem|delay|depends|dependency|missing|not ready|cannot|can't|won't|failed|failure|gap|baseline)\b/iu).slice(0, 5);
}

function chooseQuestionSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return matchingSegments(segments, /\?|\b(what|why|how|when|who|which|can we|should we|do we|are we|is there)\b/iu).slice(0, 5);
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

function stripLeadingPlanningPhrase(text: string): string {
  return text
    .replace(/^we\s+(?:need to|should|must|will|are going to|have to)\s+/iu, "")
    .replace(/^i\s+(?:need to|should|must|will|am going to|have to)\s+/iu, "")
    .trim();
}

function asOutcome(segment: TranscriptSegment): string {
  const text = cleanSummaryText(segment.text);
  if (/\b(decision|decided|agreed|approved|confirmed)\b/iu.test(segment.text)) return "Decision: " + sentenceCase(text);
  if (/\b(need to|must|should|priority|launch|ship|chosen|choose|use|baseline)\b/iu.test(segment.text)) return "Decision: " + sentenceCase(stripLeadingPlanningPhrase(text));
  return "Direction: " + sentenceCase(text);
}

function asKeyPoint(segment: TranscriptSegment): string {
  const text = cleanSummaryText(segment.text);
  if (/\b(risk|blocker|issue|problem|depends on|concern|gap)\b/iu.test(segment.text)) return "Risk: " + sentenceCase(text.replace(/^risk\s*:\s*/iu, ""));
  if (/\b(customer|requirement|deadline|timeline|budget|pricing|proposal|rfp|launch|ship|baseline|value)\b/iu.test(segment.text)) return "Context: " + sentenceCase(text);
  if (/\b(need to|must|should|priority)\b/iu.test(segment.text)) return "Priority: " + sentenceCase(stripLeadingPlanningPhrase(text));
  return "Observation: " + sentenceCase(text);
}

function asActionTask(segment: TranscriptSegment): string {
  const text = cleanSummaryText(segment.text);
  const withoutOwner = text
    .replace(/^([A-Z][a-zA-Z]{1,30})\s+(?:will|to|needs to|should|can)\s+/u, "")
    .replace(/^action item\s*:\s*/iu, "")
    .replace(/^we\s+(?:need to|should|must|will)\s+/iu, "")
    .trim();
  return sentenceCase(withoutOwner);
}

function priorityFor(segment: TranscriptSegment): "low" | "medium" | "high" {
  if (/\b(urgent|critical|blocker|blocked|must|today|asap|immediately|launch|customer)\b/iu.test(segment.text)) return "high";
  if (/\b(soon|this week|friday|tomorrow|need to|needs to|should|baseline)\b/iu.test(segment.text)) return "medium";
  return "low";
}

function dueDateFor(segment: TranscriptSegment): string | undefined {
  const match = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|next week|this week|eod)\b/iu.exec(segment.text);
  return match?.[1];
}

function asRisk(segment: TranscriptSegment): string {
  return "Risk: " + sentenceCase(cleanSummaryText(segment.text).replace(/^risk\s*:\s*/iu, ""));
}

function asQuestion(segment: TranscriptSegment): string {
  const text = cleanSummaryText(segment.text);
  return text.endsWith("?") ? sentenceCase(text) : "Open question: " + sentenceCase(text);
}

function composeExecutiveSummary(input: { keyPoints: z.infer<typeof citedTextSchema>[]; decisions: z.infer<typeof citedTextSchema>[]; actionItems: MeetingSummary["actionItems"]; fallback: TranscriptSegment }): z.infer<typeof citedTextSchema> {
  const firstDecision = input.decisions[0];
  const firstAction = input.actionItems[0];
  const firstPoint = input.keyPoints[0];
  if (firstDecision !== undefined && firstAction !== undefined) {
    return { text: `${firstDecision.text} Next step: ${firstAction.owner} to ${firstAction.task.charAt(0).toLowerCase() + firstAction.task.slice(1)}.`, citation: firstDecision.citation };
  }
  if (firstDecision !== undefined) return firstDecision;
  if (firstAction !== undefined) return { text: `Next step: ${firstAction.owner} to ${firstAction.task.charAt(0).toLowerCase() + firstAction.task.slice(1)}.`, citation: firstAction.citation };
  if (firstPoint !== undefined) return firstPoint;
  return { text: "Discussion focus: " + cleanSummaryText(input.fallback.text), citation: citationFor(input.fallback) };
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
    id: `act_${segment.segmentId.slice(4)}`,
    task: asActionTask(segment),
    owner: ownerFor(segment),
    priority: priorityFor(segment),
    completed: false,
    dueDate: dueDateFor(segment),
    citation: citationFor(segment)
  }));
  const keyPoints = chooseKeyPointSegments(orderedSegments).map((segment) => ({
    text: asKeyPoint(segment),
    citation: citationFor(segment)
  }));
  const risks = chooseRiskSegments(orderedSegments).map((segment) => ({
    text: asRisk(segment),
    citation: citationFor(segment)
  }));
  const openQuestions = chooseQuestionSegments(orderedSegments).map((segment) => ({
    text: asQuestion(segment),
    citation: citationFor(segment)
  }));
  const tldrSource = composeExecutiveSummary({ keyPoints, decisions, actionItems, fallback: firstSegment });
  const followUpCitation = actionItems[0]?.citation ?? decisions[0]?.citation ?? keyPoints[0]?.citation ?? citationFor(firstSegment);
  const followUpBody = [
    "Hi team,",
    "",
    `Thanks for the discussion. The main takeaway was: ${tldrSource.text}`,
    decisions.length > 0 ? `Decisions: ${decisions.map((decision) => decision.text).join("; ")}` : "",
    actionItems.length > 0 ? `Next steps: ${actionItems.map((item) => `${item.owner} to ${item.task}`).join("; ")}` : "",
    risks.length > 0 ? `Risks to watch: ${risks.map((risk) => risk.text).join("; ")}` : "",
    "",
    "Best,"
  ].filter((part) => part.length > 0).join("\n");

  return meetingSummarySchema.parse({
    tldr: tldrSource,
    keyPoints,
    decisions,
    actionItems,
    risks,
    openQuestions,
    followUpDraft: {
      subject: `Follow-up: ${tldrSource.text.slice(0, 72)}`,
      body: followUpBody,
      citation: followUpCitation
    }
  });
}
