# AGENTS.md — Meet-X Standing Instructions

Meet-X is a compliance-first, multi-tenant meeting intelligence SaaS. Every future agent session must preserve tenant isolation, consent requirements, and provider-abstraction boundaries.

## Read these files first

1. AGENTS.md
2. docs/architecture.md
3. docs/adr/0001-capture-strategy.md
4. docs/adr/0002-stack-selection.md
5. docs/adr/0003-tenancy-and-data-residency.md
6. docs/adr/0004-windows-desktop-capture.md
7. docs/roadmap.md

## Product decisions already made

- Product name: Meet-X.
- Capture launch direction: bot-less personal-device capture and Chrome extension are required; managed capture remains optional.
- The Windows desktop agent is the primary local recorder for system sound without browser screen sharing.
- Data residency: EU is launch-blocking.
- Deployment: paid SaaS plus personal-device capture.
- CRM: deferred.
- ASR: free/open multilingual Whisper-family models first; benchmark before production lock-in.

## Repo map

- /apps/api — API service and current SaaS UI.
- /apps/desktop-agent — Electron Windows loopback recorder.
- /apps/web — future Next.js user app.
- /apps/admin — future admin console.
- /apps/extension — future Chrome MV3 capture fallback.
- /services — capture workflow and transcription workers.
- /packages/config — typed env schema.
- /packages/core — domain types and result primitives.
- /packages/auth — auth and tenant context.
- /packages/db — Drizzle schema and migrations.
- /packages/ai-gateway — mandatory path for future customer-content AI calls.
- /packages/capture-sdk — capture provider interfaces and implementations.
- /infra — Docker, Terraform, and deployment assets.
- /docs — architecture, ADRs, runbooks, compliance, and API docs.

## Commands

~~~powershell
pnpm dev
pnpm desktop:dev
pnpm test
pnpm lint
pnpm typecheck
pnpm migrate
pnpm phase1:harness
pnpm phase2:harness
~~~

## Engineering conventions

- TypeScript strict everywhere it is used.
- No any and no unchecked non-null assertions.
- Validate boundaries with Zod.
- Domain code returns typed results for expected failures.
- IDs use prefixes such as org_, usr_, mtg_, and cap_.
- Conventional Commits only.
- Short-lived branches; default branch prefix is codex/.
- Major architecture choices require an ADR using Context / Decision / Consequences / Alternatives rejected.

## Security and privacy rules

- Never commit secrets or .env.
- Use typed config plus a production secret manager.
- All tenant-scoped data includes organization_id.
- Tenant isolation is enforced with Postgres RLS.
- Customer-content AI calls go through packages/ai-gateway.
- Summary and insight claims require timestamp citations.
- Permission filtering for RAG/search happens before retrieval.
- No silent or invisible recording mode.
- The desktop recorder requires a user gesture and explicit disclosure confirmation.
- Consent decisions must enter immutable audit logs once the audit table exists.
- Explicit-opt-in policies block external recording until consent is present.

## Definition of done

- Scope is vertical and narrow.
- Tests cover domain logic, capture contracts, and tenant/security behavior.
- Migrations are forward-only and reviewed.
- Public boundaries are validated.
- Logs include tenant context where applicable.
- Docs and ADRs change with architecture behavior.
- CI passes lint, typecheck, tests, and relevant migration checks.

## Phase tracking

Phase 0 is green. Phase 1 desktop capture has a working Windows vertical slice. Phase 2 now includes working English/Hindi local Whisper in both rolling live mode and full-file post mode, with automatic fallback; diarisation, model-native timestamps, and production streaming remain. Continue Phase 1 with signed packaging, resumable cloud upload, immutable consent records, Chrome MV3 capture, and calendar sync before declaring the full phase complete.