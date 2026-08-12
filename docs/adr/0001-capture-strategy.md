# ADR 0001: Capture Strategy

## Status

Accepted for Phase 0.

## Context

Meet-X must capture Google Meet, Zoom, and Microsoft Teams meetings while supporting consent, auditability, tenant policy, EU data residency, and a launch requirement for bot-less system sound plus a Chrome extension recorder.

Reliable server-side meeting bots are operationally expensive. Browser automation can break because of waiting rooms, host permission gates, captcha, UI drift, meeting passwords, breakout rooms, and platform-specific media behavior. Official meeting SDKs reduce some ToS risk but create uneven platform coverage and complex permission models.

## Decision

Build a `CaptureProvider` abstraction and keep all capture implementations behind it.

```ts
interface CaptureProvider {
  createSession(input: JoinRequest): Promise<CaptureSession>;
  leave(sessionId: string): Promise<void>;
  onEvent(handler: (event: CaptureEvent) => void): void;
  getArtifacts(sessionId: string): Promise<{ video?: Url; audio: Url; events: Url }>;
}
```

Phase 1 will prioritize:

1. Bot-less personal-device capture for system sound and screen/application capture.
2. Chrome MV3 extension capture for browser-based meetings.
3. Managed server-side capture as an optional enterprise/provider path.

Self-hosted browser bots remain behind a feature flag until legal, operational, and reliability risks are accepted per customer and platform.

## Consequences

- Product workflows never import a concrete capture provider directly.
- Consent policy and disclosure requirements are enforced above providers.
- Personal-device and extension capture become launch-critical surfaces.
- Managed capture can still accelerate enterprise/server-side use cases.
- Self-hosted bot work must include explicit ToS risk review and on-call ownership.

## Alternatives rejected

### Managed capture API only

Managed capture reduces time to market and on-call load, but it does not satisfy the launch requirement for bot-less system sound and personal-device capture. It also introduces provider cost per bot-hour and subprocessor/data residency review.

### Official platform SDKs only

Official SDKs reduce ToS uncertainty for supported use cases, but coverage is uneven across platforms. Teams real-time media bots require Azure Bot and Graph permissions, Zoom SDK behavior differs by account and meeting settings, and browser-based Meet capture does not provide a simple universal server SDK path.

### Self-hosted browser bots from day one

Self-hosted bots maximize control but carry high operational burden: UI drift, captcha, waiting rooms, host approval, resource-heavy browser sessions, audio/video device emulation, and platform policy risk. This is not the right Phase 1 default.

### Single recorder implementation

A single implementation would force product policy into provider-specific code and make future enterprise, extension, and personal-device modes harder to support.

## Phase recommendations

- Phase 1: bot-less personal-device and Chrome extension capture first, with managed capture available where legally and contractually acceptable.
- Phase 3: add managed/server-side capture depth for enterprise scheduling and large teams if customer demand justifies provider cost.
- Later: consider self-hosted browser bots only with explicit ToS acceptance, region-pinned workers, and dedicated on-call coverage.
