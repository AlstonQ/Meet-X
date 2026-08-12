import { describe, expect, it } from "vitest";
import { FakeCaptureProvider } from "@meet-x/capture-sdk";
import { runMeetingWorkflowSimulation } from "./workflow.js";

const joinRequest = {
  organizationId: "org_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  meetingId: "mtg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  conferenceUrl: "https://meet.example.test/demo",
  disclosureMessage: "This meeting is being recorded by Meet-X."
};

describe("runMeetingWorkflowSimulation", () => {
  it("runs scheduled to ready for an allowed capture", async () => {
    const result = await runMeetingWorkflowSimulation(new FakeCaptureProvider(), {
      joinRequest,
      autoJoin: {
        workspaceRule: "all",
        audience: "external",
        consentPolicy: "explicit_opt_in",
        explicitConsent: true,
        hasConferenceUrl: true
      }
    });

    expect(result.timeline.map((entry) => entry.state)).toEqual([
      "scheduled",
      "dispatching",
      "joining",
      "recording",
      "leaving",
      "processing",
      "ready"
    ]);
    expect(result.captureEvents.map((event) => event.type)).toContain("caption");
    expect(result.artifacts?.audio).toContain("cap_fake_");
  });

  it("blocks external capture when explicit consent is missing", async () => {
    const result = await runMeetingWorkflowSimulation(new FakeCaptureProvider(), {
      joinRequest,
      autoJoin: {
        workspaceRule: "all",
        audience: "external",
        consentPolicy: "explicit_opt_in",
        explicitConsent: false,
        hasConferenceUrl: true
      }
    });

    expect(result.decision.shouldJoin).toBe(false);
    expect(result.timeline.at(-1)?.state).toBe("failed");
    expect(result.captureEvents).toEqual([]);
  });
});
