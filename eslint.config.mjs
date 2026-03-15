import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", ".next/", "out/", "coverage/", "src/kpi/appsScript.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-control-regex": "off",
      "no-useless-escape": "warn",
      "no-useless-catch": "off",
      "eqeqeq": ["error", "smart"],
      "prefer-error-cause": "off",
      "preserve-caught-error": "off",
    },
  },
);
