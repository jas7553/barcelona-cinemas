import { builtinModules } from "node:module";
import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

const preactPaths = [
  { name: "preact", message: "Preact is server-only: import it under app/render." },
  {
    name: "preact-render-to-string",
    message: "Preact is server-only: import it under app/render.",
  },
];
const preactPatterns = [
  { group: ["preact/*"], message: "Preact is server-only: import it under app/render." },
];
const nodeBuiltins = builtinModules.filter((m) => !m.startsWith("_"));

export default tseslint.config(
  { ignores: ["app/**/node_modules/"] },
  {
    files: ["app/**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-restricted-imports": ["error", { paths: preactPaths, patterns: preactPatterns }],
    },
  },
  {
    files: ["app/**/*.test.{ts,tsx}", "app/e2e/**"],
    rules: { "@typescript-eslint/consistent-type-assertions": "off" },
  },
  {
    files: ["app/render/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["app/render/**/*.tsx"],
    ...jsxA11y.flatConfigs.strict,
  },
  {
    files: ["app/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...preactPaths,
            ...nodeBuiltins.map((name) => ({
              name,
              message: "domain is pure: no Node APIs.",
            })),
          ],
          patterns: [
            ...preactPatterns,
            { group: ["node:*"], message: "domain is pure: no Node APIs." },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "time is passed in: take `now: Date` as a parameter.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "time is passed in: take `now: Date` as a parameter.",
        },
      ],
    },
  },
);
