# ADR 0002: Stack Selection

## Status

Accepted for Phase 0.

## Context

Meet-X needs multi-tenant SaaS foundations, long-running meeting workflows, local-device capture paths, strict TypeScript boundaries, EU launch residency, and eventual enterprise controls.

## Decision

Use:

- Monorepo: pnpm workspaces + Turborepo.
- Language: TypeScript strict.
- Web: Next.js App Router, React, TailwindCSS, TanStack Query, Zustand.
- API: NestJS for modular service boundaries, OpenAPI ergonomics, guards, and health checks.
- Internal calls: typed internal clients; tRPC can be introduced for web-to-API ergonomics after core auth boundaries are stable.
- Workers: Temporal for meeting lifecycle; BullMQ or SQS for short jobs.
- Database: Postgres 16, Drizzle, RLS, pgvector.
- Cache/locks/rate limits: Redis.
- Object storage: S3-compatible storage with KMS and presigned URLs.
- Search: OpenSearch for lexical search plus pgvector for semantic search.
- ASR: local Whisper-family baseline first; managed providers remain pluggable.
- LLM: provider abstraction through a mandatory AI gateway.
- Infra: AWS, EKS/ECS depending on workload, Terraform, region-pinned stacks.
- Observability: OpenTelemetry, Prometheus/Grafana, Sentry, structured JSON logs.

## Consequences

- NestJS gives a conventional enterprise API shape and health/readiness patterns.
- Drizzle keeps SQL and RLS visible rather than hiding tenancy rules behind an ORM abstraction.
- Temporal adds operational weight but is justified by long-running meeting lifecycle durability.
- AWS is selected because EU region coverage, managed Postgres, object storage, KMS, queues, and container options are mature.
- Local Whisper-family ASR reduces early vendor cost but requires GPU/runtime benchmarking.

## Alternatives rejected

### Fastify-only API

Fastify is lighter, but NestJS provides stronger conventions for a larger team and enterprise module boundaries.

### Prisma

Prisma is productive, but Drizzle keeps SQL migrations and RLS policies closer to source control review.

### Single queue for every workload

Short jobs and meeting workflows have different failure and retry semantics. Meeting lifecycle needs Temporal-grade durability.

### GCP or Azure as default

Both are viable, but AWS is the default for Phase 0 because of broad service availability and straightforward multi-region SaaS patterns. Azure remains relevant for Microsoft integration workloads later.
