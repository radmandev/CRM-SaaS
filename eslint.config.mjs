import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // TEN-04: raw SQL only in src/server/db/raw/, where every tenant query is reviewed for a tenantId predicate.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/db/raw/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[property.name=/^\\$(queryRaw|executeRaw)(Unsafe)?$/]", message: "Raw SQL belongs in src/server/db/raw/ (TEN-04)." },
      ],
    },
  },
  {
    // §25.4: server code (DB, secrets, auth) must never be bundled into client components or shared lib code.
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}", "src/app/**/accept.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/server/*", "@/server", "@/modules/*", "@/generated/*"], message: "Client/shared code cannot import server modules." }] }],
    },
  },
  {
    // Underscore-prefixed bindings are deliberately unused (e.g. stripping a field via destructuring).
    files: ["src/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }] },
  },
  {
    // SEC-04: no raw HTML injection.
    files: ["src/**/*.tsx"],
    rules: { "react/no-danger": "error" },
  },
  {
    // Tests read untyped JSON responses and destructure fields away on purpose.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
