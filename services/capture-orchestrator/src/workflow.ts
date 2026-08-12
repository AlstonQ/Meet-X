import { FakeCaptureProvider, type CaptureEvent, type CaptureProvider, type JoinRequest } from "@meet-x/capture-sdk";
import { decideAutoJoin, type AutoJoinInput, type AutoJoinDecision } from "./auto-join.js";

export type MeetingWorkflowState =
  | "scheduled"
  | "dispatching"
  | "joining"
  | "waiting_room"
  | "recording"
  | "leaving"
  | "processing"
  | "ready"
  | "failed";

export type WorkflowTimelineEntry = {
  state: MeetingWorkflowState;
  message: string;
};

export type MeetingWorkflowInput = {
  joinRequest: JoinRequest;
  autoJoin: AutoJoinInput;
};

export type MeetingWorkflowResult = {
  decision: AutoJoinDecision;
  timeline: WorkflowTimelineEntry[];
  captureEvents: CaptureEvent[];
  artifacts?: {
    video?: string;
    audio: string;
    events: string;
  };
};

export async function runMeetingWorkflowSimulation(
  provider: CaptureProvider,
  input: MeetingWorkflowInput
): Promise<MeetingWorkflowResult> {
  const timeline: WorkflowTimelineEntry[] = [
    { state: "scheduled", message: "Meeting detected from calendar event." }
  ];
  const captureEvents: CaptureEvent[] = [];
  provider.onEvent((event) => captureEvents.push(event));

  const decision = decideAutoJoin(input.autoJoin);
  if (!decision.shouldJoin) {
    timeline.push({ state: "failed", message: `Capture blocked: ${decision.reason}.` });
    return { decision, timeline, captureEvents };
  }

  timeline.push({ state: "dispatching", message: "Dispatching capture provider." });
  timeline.push({ state: "joining", message: "Creating capture session." });

  const session = await provider.createSession(input.joinRequest);
  timeline.push({ state: "recording", message: `Recording with ${session.provider}.` });
  timeline.push({ state: "leaving", message: "Leaving meeting after simulated capture window." });

  await provider.leave(session.sessionId);
  const artifacts = await provider.getArtifacts(session.sessionId);

  timeline.push({ state: "processing", message: "Artifacts checksummed and queued for ingestion." });
  timeline.push({ state: "ready", message: "Capture simulation completed." });

  return { decision, timeline, captureEvents, artifacts };
}

export async function runDefaultLocalSimulation(): Promise<MeetingWorkflowResult> {
  return runMeetingWorkflowSimulation(new FakeCaptureProvider(), {
    joinRequest: {
      organizationId: "org_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      meetingId: "mtg_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      conferenceUrl: "https://meet.example.test/demo",
      disclosureMessage: "This meeting is being recorded by Meet-X."
    },
    autoJoin: {
      workspaceRule: "all",
      audience: "external",
      consentPolicy: "explicit_opt_in",
      explicitConsent: true,
      hasConferenceUrl: true
    }
  });
}
