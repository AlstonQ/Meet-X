# ADR 0003: Tenancy and Data Residency

## Status

Accepted for Phase 0.

## Context

Meet-X must support individuals and organizations, multiple organizations per user, concurrent meetings, paid SaaS, and EU data residency at launch.

Tenant isolation must not rely only on application code. Customer content includes recordings, transcripts, summaries, notes, and AI-derived insights. EU customers must remain in EU-pinned data stores and object storage.

## Decision

Use organization-level tenancy with Postgres RLS as the enforcement boundary.

- Every tenant-scoped table carries `organization_id`.
- Application transactions set `app.organization_id` before accessing tenant-scoped rows.
- RLS policies compare row `organization_id` with the current tenant setting.
- Users can belong to multiple organizations through memberships.
- Region is stored on organizations and used for routing to region-pinned stacks.
- EU is a launch region, not a later migration.
- Media objects are stored under region and tenant prefixes.
- Future data residency expansion uses separate regional stacks rather than a single global database.

## Consequences

- Queries that forget tenant filters are still blocked by RLS.
- Cross-organization users are modeled explicitly through memberships.
- Analytics and support tooling must be tenant-aware from the beginning.
- Region migration is intentionally hard and must be handled as a controlled data operation.
- Local development must set tenant context when testing tenant-scoped reads/writes.

## Alternatives rejected

### App-code-only tenant filters

This fails the security requirement. A missing `where organization_id = ...` could expose data.

### One database schema per tenant

Schema-per-tenant can isolate strongly but becomes operationally painful for many small organizations and individual customers.

### Single global region first, EU later

EU residency is launch-blocking. Retrofitting residency after customer content exists creates legal and operational risk.
