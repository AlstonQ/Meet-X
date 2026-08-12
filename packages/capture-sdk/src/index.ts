export type Url = string;

export type CaptureProviderKind =
  | "desktop_sdk"
  | "chrome_extension"
  | "managed_bot"
  | "self_hosted_bot"
  | "fake";

export type JoinRequest = {
  organizationId: string;
  meetingId: string;
  conferenceUrl: Url;
  disclosureMessage: string;
};

export type CaptureSession = {
  sessionId: string;
  provider: CaptureProviderKind;
};

export type CaptureEvent =
  | { type: "joined"; sessionId: string }
  | { type: "participant_join"; sessionId: string; participantId: string }
  | { type: "participant_leave"; sessionId: string; participantId: string }
  | { type: "speaking_started"; sessionId: string; participantId: string; atMs: number }
  | { type: "speaking_stopped"; sessionId: string; participantId: string; atMs: number }
  | { type: "caption"; sessionId: string; participantId: string; text: string; atMs: number }
  | { type: "waiting_room"; sessionId: string }
  | { type: "removed"; sessionId: string; reason: string }
  | { type: "ended"; sessionId: string }
  | { type: "error"; sessionId: string; code: string; message: string };

export interface CaptureProvider {
  createSession(input: JoinRequest): Promise<CaptureSession>;
  leave(sessionId: string): Promise<void>;
  onEvent(handler: (event: CaptureEvent) => void): void;
  getArtifacts(sessionId: string): Promise<{ video?: Url; audio: Url; events: Url }>;
}

export type DesktopAgentBridge = {
  start(input: JoinRequest): Promise<{ sessionId: string }>;
  stop(sessionId: string): Promise<void>;
  artifacts(sessionId: string): Promise<{ video?: Url; audio: Url; events: Url }>;
  onEvent(handler: (event: CaptureEvent) => void): () => void;
};

export class DesktopSdkProvider implements CaptureProvider {
  private readonly handlers: Array<(event: CaptureEvent) => void> = [];
  private readonly unsubscribe: () => void;

  constructor(private readonly bridge: DesktopAgentBridge) {
    this.unsubscribe = bridge.onEvent((event) => {
      this.emit(event);
    });
  }

  async createSession(input: JoinRequest): Promise<CaptureSession> {
    const session = await this.bridge.start(input);
    return { sessionId: session.sessionId, provider: "desktop_sdk" };
  }

  leave(sessionId: string): Promise<void> {
    return this.bridge.stop(sessionId);
  }

  onEvent(handler: (event: CaptureEvent) => void): void {
    this.handlers.push(handler);
  }

  getArtifacts(sessionId: string): Promise<{ video?: Url; audio: Url; events: Url }> {
    return this.bridge.artifacts(sessionId);
  }

  dispose(): void {
    this.unsubscribe();
  }

  private emit(event: CaptureEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

type SessionRecord = {
  input: JoinRequest;
  session: CaptureSession;
  left: boolean;
};

export class FakeCaptureProvider implements CaptureProvider {
  private readonly handlers: Array<(event: CaptureEvent) => void> = [];
  private readonly sessions = new Map<string, SessionRecord>();

  createSession(input: JoinRequest): Promise<CaptureSession> {
    const session: CaptureSession = {
      sessionId: `cap_fake_${input.meetingId}`,
      provider: "fake"
    };

    this.sessions.set(session.sessionId, {
      input,
      session,
      left: false
    });

    this.emit({ type: "joined", sessionId: session.sessionId });
    this.emit({ type: "participant_join", sessionId: session.sessionId, participantId: "speaker_host" });
    this.emit({ type: "speaking_started", sessionId: session.sessionId, participantId: "speaker_host", atMs: 1000 });
    this.emit({
      type: "caption",
      sessionId: session.sessionId,
      participantId: "speaker_host",
      text: "Welcome to the Meet-X capture simulation.",
      atMs: 1300
    });
    this.emit({ type: "speaking_stopped", sessionId: session.sessionId, participantId: "speaker_host", atMs: 3200 });

    return Promise.resolve(session);
  }

  leave(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (record === undefined) {
      this.emit({ type: "error", sessionId, code: "session_not_found", message: "Capture session was not found." });
      return Promise.resolve();
    }

    record.left = true;
    this.emit({ type: "ended", sessionId });
    return Promise.resolve();
  }

  onEvent(handler: (event: CaptureEvent) => void): void {
    this.handlers.push(handler);
  }

  getArtifacts(sessionId: string): Promise<{ video?: Url; audio: Url; events: Url }> {
    if (!this.sessions.has(sessionId)) {
      return Promise.reject(new Error(`Capture session ${sessionId} was not found.`));
    }

    return Promise.resolve({
      video: `memory://${sessionId}/recording.webm`,
      audio: `memory://${sessionId}/audio.opus`,
      events: `memory://${sessionId}/events.jsonl`
    });
  }

  private emit(event: CaptureEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

// TODO(phase-1): Replace the local recorder page with a DesktopSdkProvider bridge that can stream artifacts into object storage. Tracking: docs/roadmap.md#phase-1--capture-spine
// TODO(phase-1): Add Chrome MV3 ExtensionCaptureProvider once extension background/service-worker upload is implemented. Tracking: docs/roadmap.md#phase-1--capture-spine
// TODO(phase-1): Add ManagedBotProvider adapter after selecting a compliant provider and DPA posture. Tracking: docs/roadmap.md#phase-1--capture-spine
