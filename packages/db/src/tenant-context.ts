import { sql, type SQL } from "drizzle-orm";

export function setTenantContextStatement(organizationId: string): SQL {
  return sql`select set_config('app.organization_id', ${organizationId}, true)`;
}
