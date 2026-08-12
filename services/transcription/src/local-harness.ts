import { LocalFixtureTranscriptionProvider } from "./transcription-provider.js";
import { summarizeWithCitations } from "./summary.js";

const provider = new LocalFixtureTranscriptionProvider();
const transcript = await provider.transcribe({
  meetingId: "mtg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  audioUrl: "memory://cap_fake_mtg_01ARZ3NDEKTSV4RRFFQ69G5FAV/audio.opus",
  languageHint: "en"
});
const summary = summarizeWithCitations(transcript.segments);

console.log(JSON.stringify({ transcript, summary }, null, 2));
