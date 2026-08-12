import { describe, expect, it } from "vitest";
import { DesktopSdkProvider, type CaptureEvent, type DesktopAgentBridge, type JoinRequest } from "./index.js";

const request: JoinRequest = {
  organizationId: "org_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  meetingId: "mtg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  conferenceUrl: "https://teams.example.test/meeting",
  disclosureMessage: "This meeting is being recorded by Meet-X."
};

describe("DesktopSdkProvider contract", () => {
  it("delegates lifecycle and artifacts through the desktop bridge", async () => {
    let eventHandler: ((event: CaptureEvent) => void) | undefined;
    const bridge: DesktopAgentBridge = {
      start: (input) => Promise.resolve({ sessionId: "cap_desktop_" + input.meetingId }),
      stop: (sessionId) => {
        eventHandler?.({ type: "ended", sessionId });
        return Promise.resolve();
      },
      artifacts: (sessionId) => Promise.resolve({
        audio: "file:///recordings/" + sessionId + ".webm",
        events: "file:///recordings/" + sessionId + ".jsonl"
      }),
      onEvent: (handler) => {
        eventHandler = handler;
        return () => {
          eventHandler = undefined;
        };
      }
    };

    const provider = new DesktopSdkProvider(bridge);
    const events: CaptureEvent[] = [];
    provider.onEvent((event) => events.push(event));
    const session = await provider.createSession(request);
    await provider.leave(session.sessionId);
    const artifacts = await provider.getArtifacts(session.sessionId);

    expect(session.provider).toBe("desktop_sdk");
    expect(events).toEqual([{ type: "ended", sessionId: session.sessionId }]);
    expect(artifacts.audio).toContain(session.sessionId);
    provider.dispose();
  });
});