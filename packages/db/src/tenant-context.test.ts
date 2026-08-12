import { describe, expect, it } from "vitest";
import { setTenantContextStatement } from "./tenant-context.js";

describe("setTenantContextStatement", () => {
  it("creates a statement for app organization context", () => {
    const statement = setTenantContextStatement("org_01ARZ3NDEKTSV4RRFFQ69G5FAV");

    expect(statement).toBeDefined();
  });
});
