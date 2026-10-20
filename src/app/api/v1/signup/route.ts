import { publicRoute, created } from "@/server/api";
import { signupSchema } from "@/lib/schemas";
import { signup } from "@/modules/tenancy/service";

export const POST = publicRoute({ body: signupSchema }, async ({ req, body }) =>
  created(await signup(body, req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown")),
);
