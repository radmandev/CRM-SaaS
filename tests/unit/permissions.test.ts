import { describe, expect, it } from "vitest";
import { canGrantRole, PERMISSIONS, scopeOf } from "@/server/permissions";

describe("permission matrix (SPEC §4.7)", () => {
  it("matches representative cells of the spec table", () => {
    expect(scopeOf("OWNER", "tenant:billing")).toBe("ALL");
    expect(scopeOf("ADMIN", "tenant:billing")).toBeNull();
    expect(scopeOf("BRANCH_MANAGER", "user:invite")).toBe("BRANCH");
    expect(scopeOf("SALES_AGENT", "traveldoc:reveal")).toBe("OWN");
    expect(scopeOf("SALES_AGENT", "quotation:write")).toBe("OWN");
    expect(scopeOf("OPERATIONS_AGENT", "quotation:write")).toBeNull();
    expect(scopeOf("ACCOUNTANT", "invoice:issue")).toBe("ALL");
    expect(scopeOf("ACCOUNTANT", "customer:write")).toBeNull();
    expect(scopeOf("ADMIN", "ledger:post")).toBeNull();
    expect(scopeOf("VIEWER", "traveldoc:read")).toBeNull();
    expect(scopeOf("VIEWER", "customer:export")).toBeNull();
  });

  it("gives the owner every permission and the viewer no write permission", () => {
    for (const p of PERMISSIONS) expect(scopeOf("OWNER", p), p).toBe("ALL");
    const viewerWrites = PERMISSIONS.filter((p) => !/:(read|operational)$/.test(p) && scopeOf("VIEWER", p));
    expect(viewerWrites).toEqual([]);
  });

  it("limits who can grant which role (AUTH-19, AUTH-23)", () => {
    expect(canGrantRole("OWNER", "OWNER")).toBe(true);
    expect(canGrantRole("ADMIN", "OWNER")).toBe(false);
    expect(canGrantRole("ADMIN", "ADMIN")).toBe(true);
    expect(canGrantRole("BRANCH_MANAGER", "SALES_AGENT")).toBe(true);
    expect(canGrantRole("BRANCH_MANAGER", "ACCOUNTANT")).toBe(false);
    expect(canGrantRole("SALES_AGENT", "VIEWER")).toBe(false);
  });
});
