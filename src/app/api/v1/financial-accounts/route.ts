import { z } from "zod";
import { tenantRoute, created } from "@/server/api";
import { can } from "@/server/context";
import { forbidden } from "@/server/errors";
import { financialAccountSchema } from "@/lib/schemas-finance";
import { validIban } from "@/lib/travel";
import { accountBalances, createAccount } from "@/modules/finance/payables";

const body = financialAccountSchema.extend({ iban: z.string().trim().toUpperCase().refine(validIban, "v.iban").nullable().optional() });
export const GET = tenantRoute({}, async ({ ctx }) => {
  // Names are needed by anyone who records money movements; balances only with report:financial.
  if (!["payment:record", "expense:write", "supplierpayment:write", "report:financial"].some((p) => can(ctx, p as never))) throw forbidden();
  const rows = await accountBalances(ctx.db);
  const finance = can(ctx, "report:financial");
  return { data: rows.map((r) => (finance ? r : { ...r, balance: null, openingBalance: null })) };
});
export const POST = tenantRoute({ permission: "tenant:settings", body }, async ({ ctx, body }) => created({ data: await createAccount(ctx, body) }));
