import type { AtRule, Declaration, Node, Rule as StyleRule } from "postcss";
import stylelint from "stylelint";
import type { Rule } from "stylelint";

/** The only file allowed raw colors, sizes and radii: it defines the tokens. */
export const TOKENS_FILE = "app/render/styles/tokens.css";
/** The only class that may set caps (the brief's section labels). */
export const LABEL_CLASS = "label";
/** The only class that may move (the brief's seen toggle). */
export const SEEN_TOGGLE_CLASS = "seen-toggle";

/** Properties whose values must be tokens, as stylelint-declaration-strict-value patterns. */
export const TOKEN_PROPERTIES = {
  color: "/^(?:.+-)?color$|^(?:background|fill|stroke)$/",
  fontSize: "font-size",
  spacing:
    "/^(?:margin|padding|inset)(?:-.+)?$|^(?:top|right|bottom|left|gap|row-gap|column-gap|grid-gap|grid-row-gap|grid-column-gap)$/",
  radius: "/^border(?:-.+)?-radius$/",
} as const;

const tokenPropertyPatterns = Object.values(TOKEN_PROPERTIES).map((pattern) =>
  pattern.startsWith("/") ? new RegExp(pattern.slice(1, -1)) : new RegExp(`^${pattern}$`),
);
const isTokenProperty = (prop: string) =>
  tokenPropertyPatterns.some((pattern) => pattern.test(prop.toLowerCase()));

const {
  createPlugin,
  utils: { report, ruleMessages },
} = stylelint;

/** Splits at `separator` outside brackets and quotes. */
function splitTopLevel(text: string, separator: (char: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
    } else if (depth === 0 && separator(char)) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

type Parent = Node["parent"];
const isRule = (node: Parent): node is StyleRule => node?.type === "rule";
const isAtRule = (node: Parent): node is AtRule => node?.type === "atrule";

/** The rules and at-rules enclosing `node`, innermost first. */
function ancestors(node: Node): (StyleRule | AtRule)[] {
  const found: (StyleRule | AtRule)[] = [];
  for (let parent: Parent = node.parent; parent; parent = parent.parent) {
    if (isRule(parent) || isAtRule(parent)) found.push(parent);
  }
  return found;
}

/** The rule's selectors with CSS nesting resolved, e.g. `.a { &:hover, b {} }` → `.a:hover`, `.a b`. */
function resolvedSelectors(rule: StyleRule): string[] {
  const own = splitTopLevel(rule.selector, (char) => char === ",");
  const parent = ancestors(rule).find(isRule);
  if (!parent) return own;
  return resolvedSelectors(parent).flatMap((outer) =>
    own.map((inner) => (inner.includes("&") ? inner.replaceAll("&", outer) : `${outer} ${inner}`)),
  );
}

/** The selector outside any `:is()`, `:not()`, `:has()` or attribute brackets. */
const outsideBrackets = (selector: string) =>
  selector.replace(/\((?:[^()]|\([^()]*\))*\)|\[[^\]]*\]/g, "");

/** Compounds outside any brackets. */
function compounds(selector: string): string[] {
  return outsideBrackets(selector)
    .split(/\s*[\s>+~]\s*/)
    .filter(Boolean);
}

const hasClass = (compound: string, name: string) =>
  new RegExp(`\\.${name}(?![\\w-])`).test(compound);

/** The subject is an element with class `name` or inside one: no `+` or `~` follows that class. */
function withinClass(selector: string, name: string): boolean {
  // Compounds at even indices, the combinators between them at odd ones.
  const parts = outsideBrackets(selector)
    .trim()
    .split(/\s*([\s>+~])\s*/);
  const last = parts.findLastIndex((part, i) => i % 2 === 0 && hasClass(part, name));
  return last >= 0 && parts.slice(last + 1).every((part) => part !== "+" && part !== "~");
}

const nearestRule = (decl: Declaration) => ancestors(decl).find(isRule);

function plugin(name: string, message: string, violates: (decl: Declaration) => boolean) {
  const ruleName = `btw/${name}`;
  const messages = ruleMessages(ruleName, { rejected: message });
  const rule: Rule = (enabled: boolean) => (root, result) => {
    if (!enabled) return;
    root.walkDecls((decl) => {
      if (violates(decl)) {
        report({ ruleName, result, node: decl, message: messages.rejected, word: decl.prop });
      }
    });
  };
  rule.ruleName = ruleName;
  rule.messages = messages;
  return createPlugin(ruleName, rule);
}

const CAPS = /^(?:text-transform|font-variant(?:-caps)?)$/i;
const CAPS_VALUE = /\b(?:uppercase|(?:all-)?(?:small|petite)-caps|unicase|titling-caps)\b/i;

const capsOnlyOnLabel = plugin(
  "caps-only-on-label",
  `Caps are only for .${LABEL_CLASS}: set them in a rule on that class`,
  (decl) => {
    if (!CAPS.test(decl.prop) || !CAPS_VALUE.test(decl.value)) return false;
    const rule = nearestRule(decl);
    return (
      rule === undefined ||
      !resolvedSelectors(rule).every((selector) => {
        const subject = compounds(selector).at(-1);
        return subject !== undefined && hasClass(subject, LABEL_CLASS);
      })
    );
  },
);

const MOTION = /^(?:-webkit-)?(?:transition|animation)(?:-|$)/i;

/** `@media (prefers-reduced-motion: no-preference)`, optionally `and` more features; no `not`, `or` or comma list. */
function optsIntoMotion(params: string): boolean {
  const query = params.toLowerCase();
  return (
    splitTopLevel(query, (char) => char === ",").length === 1 &&
    !/\b(?:not|or)\b/.test(query) &&
    /\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/.test(query)
  );
}

const motionOnlyOnSeenToggle = plugin(
  "motion-only-on-seen-toggle",
  `Motion is only for .${SEEN_TOGGLE_CLASS}, inside @media (prefers-reduced-motion: no-preference)`,
  (decl) => {
    if (!MOTION.test(decl.prop)) return false;
    const outer = ancestors(decl);
    if (outer.some((node) => isAtRule(node) && /^(?:-webkit-)?keyframes$/i.test(node.name))) {
      return false;
    }
    const rule = outer.find(isRule);
    const onToggle =
      rule !== undefined &&
      resolvedSelectors(rule).every((selector) => withinClass(selector, SEEN_TOGGLE_CLASS));
    const optedIn = outer.some(
      (node) =>
        isAtRule(node) && node.name.toLowerCase() === "media" && optsIntoMotion(node.params),
    );
    return !onToggle || !optedIn;
  },
);

function varFallbacks(value: string): string[] {
  const fallbacks: string[] = [];
  for (const match of value.matchAll(/\bvar\(/gi)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (end < value.length && depth > 0) {
      if (value[end] === "(") depth += 1;
      if (value[end] === ")") depth -= 1;
      end += 1;
    }
    const [, ...rest] = splitTopLevel(value.slice(start, end - 1), (char) => char === ",");
    if (rest.length) fallbacks.push(rest.join(","));
  }
  return fallbacks;
}

const tokenFallbacks = plugin(
  "token-fallbacks",
  "A token's fallback must be another token: var(--a, var(--b))",
  (decl) =>
    isTokenProperty(decl.prop) &&
    varFallbacks(decl.value).some((fallback) => !/^var\(/i.test(fallback)),
);

const LENGTH =
  /(?<![\w.-])-?(\d*\.?\d+)(?:px|r?em|r?ex|r?ch|r?cap|r?ic|r?lh|[sdl]?v(?:[whib]|min|max)|cq(?:[whib]|min|max)|cm|mm|q|in|pt|pc)\b/gi;
const hasRawLength = (value: string) =>
  [...value.matchAll(LENGTH)].some(([, number]) => Number(number) !== 0);

const rawCustomProperties = plugin(
  "raw-custom-properties",
  `Raw lengths belong in ${TOKENS_FILE}: alias a token instead`,
  (decl) => decl.prop.startsWith("--") && hasRawLength(decl.value),
);

/** Shorthands that mix a color with other values, which the strict-value rule can't check. Custom properties are checked too. */
const COLOR_SHORTHAND =
  /^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|outline|text-decoration|column-rule|text-emphasis|-webkit-text-stroke)$/i;
/** CSS system colors, current and deprecated. */
const SYSTEM_COLOR = new RegExp(
  `(?<![\\w-])(?:${[
    "AccentColor",
    "AccentColorText",
    "ActiveText",
    "ButtonBorder",
    "ButtonFace",
    "ButtonText",
    "Canvas",
    "CanvasText",
    "Field",
    "FieldText",
    "GrayText",
    "Highlight",
    "HighlightText",
    "LinkText",
    "Mark",
    "MarkText",
    "SelectedItem",
    "SelectedItemText",
    "VisitedText",
    "ActiveBorder",
    "ActiveCaption",
    "AppWorkspace",
    "Background",
    "ButtonHighlight",
    "ButtonShadow",
    "CaptionText",
    "InactiveBorder",
    "InactiveCaption",
    "InactiveCaptionText",
    "InfoBackground",
    "InfoText",
    "Menu",
    "MenuText",
    "Scrollbar",
    "ThreeDDarkShadow",
    "ThreeDFace",
    "ThreeDHighlight",
    "ThreeDLightShadow",
    "ThreeDShadow",
    "Window",
    "WindowFrame",
    "WindowText",
  ].join("|")})(?![\\w-])`,
  "i",
);

const shorthandSystemColors = plugin(
  "shorthand-system-colors",
  `System colors belong in ${TOKENS_FILE}: use a token`,
  (decl) =>
    (decl.prop.startsWith("--") || COLOR_SHORTHAND.test(decl.prop)) &&
    SYSTEM_COLOR.test(decl.value),
);

const tokensFileDefinesOnly = plugin(
  "tokens-file-defines-only",
  "The tokens file only defines custom properties: style elements elsewhere",
  (decl) => !decl.prop.startsWith("--") && nearestRule(decl) !== undefined,
);

export default [
  capsOnlyOnLabel,
  motionOnlyOnSeenToggle,
  tokenFallbacks,
  rawCustomProperties,
  shorthandSystemColors,
  tokensFileDefinesOnly,
];
