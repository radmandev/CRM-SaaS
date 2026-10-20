import type { NextConfig } from "next";

const securityHeaders = [
  // SEC-02 / SEC-03. CSP (with a per-request nonce) is set in src/proxy.ts.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // ADR-07: every page is per-user/per-tenant, so Cache Components stays off.
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "pino"],
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
