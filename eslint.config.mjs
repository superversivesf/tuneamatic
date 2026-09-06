import globals from "globals";
import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    settings: {
      react: {
        version: "19.2.8",
      },
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["lib/**/*.{ts,mts}", "tests/**/*.ts", "instrumentation.ts", "*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", ".worktrees/**", "data/**", "storage/**", "samples/**", "next-env.d.ts", "scripts/**"],
  },
];

export default config;