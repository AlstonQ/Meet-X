import { describe, expect, it } from "vitest";
import { buildWhisperLanguageArgs, isLikelySpeech, LocalFixtureTranscriptionProvider, normalizeLanguageHint, parseWhisperDetectedLanguage, speakerIdForTranscriptTurn } from "./transcription-provider.js";

const input = {
  meetingId: "mtg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  audioUrl: "memory://capture/audio.opus",
  languageHint: "en"
};

describe("Whisper language handling", () => {
  it("passes explicit auto-detection to whisper.cpp", () => {
    expect(normalizeLanguageHint(undefined)).toBe("auto");
    expect(buildWhisperLanguageArgs("auto")).toEqual(["-l", "auto"]);
    expect(buildWhisperLanguageArgs("Hindi")).toEqual(["-l", "hi"]);
  });

  it("rejects Whisper foreign-language placeholders as speech", () => {
    expect(isLikelySpeech("(speaking in foreign language)")).toBe(false);
    expect(isLikelySpeech("We should ship this fix today.")).toBe(true);
    expect(isLikelySpeech("हमें यह सुधार आज जारी करना चाहिए।")).toBe(true);
    expect(isLikelySpeech("लगे लगे लगे लगे लगे लगे लगे लगे लगे लगे")).toBe(false);
    expect(isLikelySpeech("They will get a library concert and they will get a library concert and they will get a library concert.")).toBe(false);
  });


  it("assigns useful local speaker labels from capture hints", () => {
    expect(speakerIdForTranscriptTurn(0, { localUserName: "Alston Quadros", microphone: true, systemAudio: false })).toBe("speaker_alston_quadros");
    expect(speakerIdForTranscriptTurn(0, { localUserName: "Alston Quadros", microphone: true, systemAudio: true })).toBe("speaker_alston_quadros");
    expect(speakerIdForTranscriptTurn(1, { localUserName: "Alston Quadros", microphone: true, systemAudio: true })).toBe("speaker_2");
    expect(speakerIdForTranscriptTurn(0, { microphone: false, systemAudio: true })).toBe("speaker_1");
  });
  it("reads whisper.cpp auto-detection output", () => {
    expect(parseWhisperDetectedLanguage("auto-detected language: ml (p = 0.365434)")).toEqual({ language: "ml", confidence: 0.365434 });
  });
});

describe("LocalFixtureTranscriptionProvider", () => {
  it("returns diarised segments with word timestamps", async () => {
    const provider = new LocalFixtureTranscriptionProvider();
    const result = await provider.transcribe(input);

    expect(result.detectedLanguage).toBe("en");
    expect(result.segments.length).toBeGreaterThanOrEqual(4);
    expect(result.segments[0]?.speakerId).toContain("speaker_");
    expect(result.segments[0]?.words.length).toBeGreaterThan(3);
    expect(result.segments[0]?.words[0]?.startMs).toBe(0);
  });
});








