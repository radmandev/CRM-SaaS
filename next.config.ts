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
  // Shared hosting (Hostinger/CloudLinux) caps threads per account and reports 48 CPUs. By default the build
  // sizes its thread pools, CSS-loader Node processes and static-generation workers to the CPU count, which
  // exceeds the cap ("pthread_create: Resource temporarily unavailable"). These two settings, plus the
  // thread-pool limits exported by `npm run build`, keep it under the cap. Every page is dynamic, so one
  // static-generation worker costs nothing.
  experimental: {
    turbopackPluginRuntimeStrategy: "workerThreads",
    cpus: 1,
  },
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
