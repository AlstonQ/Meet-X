# Meet-X Roadmap

Engineer-week estimates assume a small senior team and include implementation, tests, review, and operational hardening. They are planning ranges, not commitments.

## Phase 0 — Foundation

Scope:

- Architecture docs and ADRs.
- Monorepo scaffold.
- Typed config.
- Core tenancy schema and RLS migration.
- Auth/tenant-context skeleton.
- API health checks.
- Local Postgres, Redis, MinIO.
- CI.

Exit criteria:

- New engineer can run the local stack in under 10 minutes.
- CI runs lint, typecheck, and tests.
- First migration creates tenant-scoped tables and RLS policies.
- Future agents have clear standing instructions.

Estimate: 2–3 engineer-weeks.

## Phase 1 — Capture spine

Current status: the Windows DesktopSdkProvider vertical slice is working locally (detection, consent gate, loopback + microphone, recovery file, upload, and processing handoff). Signed packaging, resumable cloud upload, extension, calendars, and production consent audit remain.

Scope:

- CaptureProvider interface.
- Bot-less personal-device recorder path.
- Chrome MV3 recorder path.
- Optional managed capture provider.
- Temporal meeting lifecycle.
- Calendar sync for Google and Microsoft.
- Auto-join rule engine and consent gate.
- Artifact ingestion with checksums.
- Local meeting simulation harness.

Exit criteria:

- Simulated meeting runs scheduled → ready.
- Extension and device capture upload artifacts resumably.
- Consent gate blocks disallowed capture.
- Contract tests pass for all capture providers.

Estimate: 10–16 engineer-weeks.

## Phase 2 — Transcription and summarisation

Current status: English/Hindi local Whisper, post-recording processing, and near-real-time desktop transcription with persisted rolling chunks and full-file fallback are working locally. Diarisation, model-native timestamps, WebSocket captions, benchmark reports, and the production AI gateway remain.

Scope:

- Whisper-family local ASR baseline.
- Diarisation pipeline and word timestamps.
- Live caption stream.
- AI gateway.
- Summary templates.
- Citation enforcement.
- LLM eval harness with fixture transcripts.

Exit criteria:

- Multilingual WER and speaker attribution report published.
- Summary outputs validate against schemas.
- Every claim has citations.
- CI fails on summary regression.

Estimate: 10–14 engineer-weeks.

## Phase 3 — Library, search, clips, sharing

Scope:

- Meeting library UI.
- Playback with transcript sync.
- Timestamped notes and reactions.
- Clip rendering.
- Share links and authz test matrix.
- Hybrid search with pre-retrieval permission filters.

Exit criteria:

- 1M segment benchmark meets search target or has documented remediation.
- Timestamp seek works within tolerance.
- Clip permissions are independently tested.

Estimate: 12–18 engineer-weeks.

## Phase 4 — Meeting intelligence

Scope:

- Speaker analytics.
- Trackers.
- Playbook scoring.
- Scorecards.
- Coaching queue.
- Objection and theme detection.
- Cross-meeting insights.

Exit criteria:

- Scores are explainable and cite transcript evidence.
- Model drift ADR and score-stability tests exist.
- Manager workflow supports review and comments.

Estimate: 12–20 engineer-weeks.

## Phase 5 — Integrations and platform

Scope:

- Public REST API v1.
- API keys, scopes, rate limits.
- Signed webhooks with retries and DLQ.
- MCP server.
- Destinations: Slack, Notion, Google Docs, Jira/Linear, email drafts.
- CRM remains deferred until product need is validated.

Exit criteria:

- OpenAPI spec published.
- Webhook delivery inspector works.
- Integration writes are replay-safe.

Estimate: 10–16 engineer-weeks without CRM; 18–28 with first CRM.

## Phase 6 — Enterprise hardening and monetization

Scope:

- SAML/OIDC SSO.
- SCIM.
- Custom RBAC.
- Admin console.
- Region-pinned residency enforcement.
- BYOK envelope encryption.
- Immutable audit log.
- Retention, legal hold, DSAR.
- PII redaction and private AI routing.
- Stripe billing for SaaS.
- SOC 2 control mapping and incident runbooks.

Exit criteria:

- EU residency controls are verified end-to-end.
- DSAR export/delete is provable.
- Billing supports paid SaaS plans.
- SOC 2 mapping links controls to code.

Estimate: 18–30 engineer-weeks.
