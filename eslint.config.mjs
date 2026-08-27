import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // The launcher scripts in bin/ are plain CommonJS Node scripts on purpose: they run before
    // (and without) the bundler, and the package has no "type": "module".
    files: ["bin/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
