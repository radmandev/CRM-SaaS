import type { Role } from "@/generated/prisma/enums";

export type Scope = "ALL" | "BRANCH" | "OWN";

const ROLES = ["OWNER", "ADMIN", "BRANCH_MANAGER", "SALES_AGENT", "OPERATIONS_AGENT", "ACCOUNTANT", "VIEWER"] as const;

// SPEC §4.7, one column per role in ROLES order. A = all, B = assigned branches, O = own/assigned, - = none.
// "Read-only" cells of the spec are expressed by granting only the :read permission.
const MATRIX = {
  "tenant:settings":            "AA-----",
  "tenant:billing":             "A------",
  "tenant:delete":              "A------",
  "owner:transfer":             "A------",
  "user:invite":                "AAB----",
  "user:manage":                "AAB----",
  "branch:manage":              "AA-----",
  "customer:read":              "AABBBAB",
  "customer:write":             "AABBB--",
  "customer:export":            "AAB--A-",
  "traveldoc:read":             "AABBB--",
  "traveldoc:reveal":           "AABOB--",
  "supplier:read":              "AABBBAB",
  "supplier:write":             "AAB-BA-",
  "product:write":              "AAB-B--",
  "quotation:read":             "AABBBAB",
  "quotation:write":            "AABO---",
  "quotation:approve-discount": "AAB----",
  "booking:read":               "AABBBAB",
  "booking:write":              "AABOB--",
  "booking:cancel":             "AABOB--",
  "booking:amend":              "AABOB--",
  "invoice:read":               "AABBBA-",
  "invoice:issue":              "AAB--A-",
  "creditnote:issue":           "AAB--A-",
  "payment:record":             "AABB-A-",
  "refund:request":             "AABOBA-",
  "refund:approve":             "AAB--A-",
  "supplierbill:write":         "AAB-BA-",
  "supplierpayment:write":      "AAB--A-",
  "expense:write":              "AAB--A-",
  "report:operational":         "AABOBAB",
  "report:financial":           "AAB--A-",
  "ledger:read":                "AA---A-",
  "ledger:post":                "A----A-",
  "document:read":              "AABBBAB",
  "document:write":             "AABBBA-",
  "audit:read":                 "AAB--A-",
  "ai:use":                     "AABBBA-",
  "integration:manage":         "AA-----",
} as const satisfies Record<string, string>;

export type Permission = keyof typeof MATRIX;
export const PERMISSIONS = Object.keys(MATRIX) as Permission[];

const CODE: Record<string, Scope | null> = { A: "ALL", B: "BRANCH", O: "OWN", "-": null };

/** The scope a role holds for a permission, or null when it has none (AUTHZ-01, §4.6). */
export function scopeOf(role: Role, permission: Permission): Scope | null {
  return CODE[MATRIX[permission][ROLES.indexOf(role)]];
}

// AUTH-19 / AUTH-23: which roles a role may grant. Only an owner creates owners; admins grant up to admin;
// branch managers grant front-line roles only.
const GRANTABLE: Record<Role, Role[]> = {
  OWNER: [...ROLES],
  ADMIN: ["ADMIN", "BRANCH_MANAGER", "SALES_AGENT", "OPERATIONS_AGENT", "ACCOUNTANT", "VIEWER"],
  BRANCH_MANAGER: ["SALES_AGENT", "OPERATIONS_AGENT", "VIEWER"],
  SALES_AGENT: [],
  OPERATIONS_AGENT: [],
  ACCOUNTANT: [],
  VIEWER: [],
};

export function canGrantRole(actor: Role, target: Role): boolean {
  return GRANTABLE[actor].includes(target);
}

export const ALL_ROLES: readonly Role[] = ROLES;
