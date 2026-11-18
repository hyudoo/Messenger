// ESLint 9 flat config. eslint-config-next 16 ships flat configs natively.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores(["node_modules/**", ".next/**", ".next-e2e/**", "test-results/**", "playwright-report/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    rules: {
      // App Router only: there is no pages/ directory for this rule to check
      "@next/next/no-html-link-for-pages": "off",
    },
  },
]);
