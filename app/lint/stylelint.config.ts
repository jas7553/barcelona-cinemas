import type { Config } from "stylelint";
import strictValue from "stylelint-declaration-strict-value";
import guardrails, { TOKEN_PROPERTIES, TOKENS_FILE } from "./stylelint-plugin.ts";

// Keywords that defer to the cascade rather than pick a value.
const CSS_WIDE = ["inherit", "initial", "unset", "revert", "revert-layer"];
// `-1 × token`, for pulling an element back by a spacing step.
const NEGATED_TOKEN = "/^calc\\(\\s*-1\\s*\\*\\s*var\\(--[\\w-]+\\)\\s*\\)$/";

const config: Config = {
  // Test scaffolding for the page checks; the bad stubs break the rules on purpose.
  ignoreFiles: ["app/e2e/stub/**"],
  plugins: [strictValue, ...guardrails],
  rules: {
    // The visual system's "these values and nothing else".
    "scale-unlimited/declaration-strict-value": [
      Object.values(TOKEN_PROPERTIES),
      {
        ignoreFunctions: false,
        ignoreValues: {
          [TOKEN_PROPERTIES.color]: [...CSS_WIDE, "/^currentcolor$/i", "transparent", "none"],
          [TOKEN_PROPERTIES.fontSize]: CSS_WIDE,
          [TOKEN_PROPERTIES.spacing]: [...CSS_WIDE, "0", "auto", NEGATED_TOKEN],
          [TOKEN_PROPERTIES.radius]: [...CSS_WIDE, "0"],
        },
        message: `Use a token, var(--…), for \${property}, not "\${value}". Raw values live in ${TOKENS_FILE}.`,
      },
    ],
    "btw/token-fallbacks": true,
    "btw/raw-custom-properties": true,
    // Colors in any property, including shorthands like `border` and custom properties.
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": [
      "rgb",
      "rgba",
      "hsl",
      "hsla",
      "hwb",
      "lab",
      "lch",
      "oklab",
      "oklch",
      "color",
      "color-mix",
      "light-dark",
      "contrast-color",
      "device-cmyk",
    ],
    "btw/shorthand-system-colors": true,
    // The shorthand sets font-size; form controls still need `font: inherit`.
    "declaration-property-value-allowed-list": { font: CSS_WIDE },

    // Bans, everywhere including the tokens file.
    "declaration-no-important": true,
    "keyframe-declaration-no-important": true,
    "property-disallowed-list": [
      "/^(?:-webkit-)?box-shadow$/i",
      "text-shadow",
      "/^(?:-webkit-)?line-clamp$/i",
      "view-transition-name",
      "view-transition-class",
    ],
    "at-rule-disallowed-list": ["view-transition"],
    "declaration-property-value-disallowed-list": {
      position: ["/^(?:-webkit-)?(?:sticky|fixed)$/i"],
      "text-overflow": ["/ellipsis/i"],
      "/^(?:-webkit-)?(?:backdrop-)?filter$/i": ["/\\b(?:blur|drop-shadow)\\(/i"],
      "/.*/": ["/gradient\\(/i"],
      "scroll-behavior": ["smooth"],
    },
    "btw/caps-only-on-label": true,
    "btw/motion-only-on-seen-toggle": true,
  },
  overrides: [
    {
      files: [TOKENS_FILE],
      rules: {
        "scale-unlimited/declaration-strict-value": null,
        "btw/token-fallbacks": null,
        "btw/raw-custom-properties": null,
        "color-no-hex": null,
        "color-named": null,
        "function-disallowed-list": null,
        "btw/shorthand-system-colors": null,
        "btw/tokens-file-defines-only": true,
      },
    },
  ],
};

export default config;
