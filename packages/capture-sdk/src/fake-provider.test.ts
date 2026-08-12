import { describe, expect, it } from "vitest";
import { FakeCaptureProvider, type CaptureEvent } from "./index.js";

const joinRequest = {
  organizationId: "org_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  meetingId: "mtg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  conferenceUrl: "https://meet.example.test/demo",
  disclosureMessage: "This meeting is being recorded by Meet-X."
};

describe("FakeCaptureProvider contract", () => {
  it("creates a session, emits lifecycle events, leaves, and exposes artifacts", async () => {
    const provider = new FakeCaptureProvider();
    const events: CaptureEvent[] = [];
    provider.onEvent((event) => events.push(event));

    const session = await provider.createSession(joinRequest);
    await provider.leave(session.sessionId);
    const artifacts = await provider.getArtifacts(session.sessionId);

    expect(session.provider).toBe("fake");
    expect(events.map((event) => event.type)).toEqual([
      "joined",
      "participant_join",
      "speaking_started",
      "caption",
      "speaking_stopped",
      "ended"
    ]);
    expect(artifacts.audio).toContain(session.sessionId);
    expect(artifacts.events).toContain(session.sessionId);
  });
});
