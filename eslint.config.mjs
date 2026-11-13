// ESLint 9 flat config (replaces .eslintrc.json and `next lint`, which Next 16 drops).
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // App Router only: there is no pages/ directory for this rule to check
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];

export default eslintConfig;
