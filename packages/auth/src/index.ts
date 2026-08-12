import { z } from "zod";
import { organizationIdSchema, userIdSchema } from "@meet-x/core";

export const tenantContextSchema = z.object({
  organizationId: organizationIdSchema,
  userId: userIdSchema,
  role: z.enum(["owner", "admin", "manager", "member", "guest"])
});

export type TenantContext = z.infer<typeof tenantContextSchema>;

export function assertTenantContext(input: unknown): TenantContext {
  return tenantContextSchema.parse(input);
}
