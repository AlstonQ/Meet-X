## Summary

## Security and privacy checklist

- [ ] No secrets or `.env` files committed.
- [ ] Tenant-scoped data includes `organization_id`.
- [ ] RLS implications reviewed for database changes.
- [ ] Consent behavior reviewed for capture-related changes.
- [ ] Customer-content AI calls go through the AI gateway.
- [ ] Logs avoid sensitive content and include tenant context where applicable.

## Tests

