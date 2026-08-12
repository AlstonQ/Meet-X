import { describe, expect, it } from "vitest";
import { LocalFixtureTranscriptionProvider } from "./transcription-provider.js";
import { summarizeWithCitations } from "./summary.js";

const input = {
  meetingId: "mtg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  audioUrl: "memory://capture/audio.opus",
  languageHint: "en"
};

describe("summarizeWithCitations", () => {
  it("creates cited TLDR, key points, decisions, and action items", async () => {
    const provider = new LocalFixtureTranscriptionProvider();
    const transcript = await provider.transcribe(input);
    const summary = summarizeWithCitations(transcript.segments);

    expect(summary.tldr.citation.segmentId).toMatch(/^seg_/u);
    expect(summary.keyPoints.every((point) => point.citation.segmentId.startsWith("seg_"))).toBe(true);
    expect(summary.decisions[0]?.citation.segmentId).toMatch(/^seg_/u);
    expect(summary.actionItems[0]?.citation.segmentId).toMatch(/^seg_/u);
  });

  it("creates useful cited sections without explicit labels", () => {
    const summary = summarizeWithCitations([
      {
        segmentId: "seg_00000000000000000000000101",
        meetingId: input.meetingId,
        speakerId: "speaker_1",
        language: "en",
        startMs: 0,
        endMs: 4000,
        text: "We will ship the desktop recorder first for the launch customer.",
        words: [{ word: "We", startMs: 0, endMs: 1000 }]
      },
      {
        segmentId: "seg_00000000000000000000000102",
        meetingId: input.meetingId,
        speakerId: "speaker_2",
        language: "en",
        startMs: 5000,
        endMs: 9000,
        text: "Maya will prepare the Hindi and English test recording by Friday.",
        words: [{ word: "Maya", startMs: 5000, endMs: 6000 }]
      }
    ]);

    expect(summary.keyPoints.length).toBeGreaterThan(0);
    expect(summary.decisions.length).toBeGreaterThan(0);
    expect(summary.actionItems.length).toBeGreaterThan(0);
    expect(summary.actionItems[0]?.owner).toBe("Maya");
  });

  it("refuses to summarize an empty transcript", () => {
    expect(() => summarizeWithCitations([])).toThrow("empty transcript");
  });
});
