import { z } from "zod";
import { tenantRoute } from "@/server/api";
import { listQuery } from "@/lib/schemas";
import { listAuditLogs } from "@/modules/audit/service";

const query = listQuery.extend({ entityType: z.string().max(50).optional(), entityId: z.uuid().optional() });

export const GET = tenantRoute({ permission: "audit:read", query }, async ({ ctx, query }) => listAuditLogs(ctx, query));
