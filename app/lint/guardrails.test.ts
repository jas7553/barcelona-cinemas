import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ICruiseResult, IConfiguration } from "dependency-cruiser";
import { cruise } from "dependency-cruiser";
import { ESLint } from "eslint";
import stylelint from "stylelint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "./stylelint.config.ts";
import { LABEL_CLASS, SEEN_TOGGLE_CLASS, TOKENS_FILE } from "./stylelint-plugin.ts";

const root = resolve(import.meta.dirname, "../..");

describe("stylelint", () => {
  async function lint(code: string, file = "app/render/styles/card.css") {
    const { results } = await stylelint.lint({
      code,
      codeFilename: join(root, file),
      config,
      configBasedir: root,
    });
    return results;
  }
  const rules = async (code: string, file?: string) =>
    (await lint(code, file)).flatMap((result) => result.warnings.map((warning) => warning.rule));

  const STRICT = "scale-unlimited/declaration-strict-value";
  const VALUE_BAN = "declaration-property-value-disallowed-list";
  const PROPERTY_BAN = "property-disallowed-list";
  const CAPS = "btw/caps-only-on-label";
  const MOTION = "btw/motion-only-on-seen-toggle";
  const SYSTEM_COLORS = "btw/shorthand-system-colors";
  const motionQuery = "@media (prefers-reduced-motion: no-preference)";

  it("passes a clean, token-using stylesheet with valid options", async () => {
    const results = await lint(`
      .card {
        color: var(--ink);
        background: var(--surface);
        border: 1px solid var(--rule);
        border-radius: var(--radius-poster);
        padding-block: var(--space-2) 0;
        margin-inline: auto;
        margin-block-start: calc(-1 * var(--space-1));
        gap: var(--space-3);
        font-size: var(--step-1);
        --chain: var(--mooby);
        --fade: 0.4;
        &:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
        & .label { font-size: var(--step--1); text-transform: uppercase; color: var(--muted); }
      }
      button { font: inherit; color: currentColor; background: transparent; }
      svg { fill: none; stroke: currentColor; }
      .${SEEN_TOGGLE_CLASS} {
        ${motionQuery} {
          transition: scale 0.2s;
          &:active svg { animation: pop 0.3s; }
        }
      }
      @keyframes pop { 50% { scale: 1.1; animation-timing-function: ease-out; } }
    `);
    expect(results.flatMap((result) => result.invalidOptionWarnings)).toEqual([]);
    expect(results.flatMap((result) => result.warnings)).toEqual([]);
  });

  it.each([
    ["position: sticky", VALUE_BAN],
    ["position: fixed", VALUE_BAN],
    ["position: -webkit-sticky", VALUE_BAN],
    ["box-shadow: 0 0 0 1px var(--rule)", PROPERTY_BAN],
    ["-webkit-box-shadow: 0 0 0 1px var(--rule)", PROPERTY_BAN],
    ["background-image: linear-gradient(var(--a), var(--b))", VALUE_BAN],
    ["background: repeating-radial-gradient(var(--a), var(--b))", VALUE_BAN],
    ["mask-image: conic-gradient(var(--a), var(--b))", VALUE_BAN],
    ["--sheen: linear-gradient(var(--a), var(--b))", VALUE_BAN],
    ["filter: blur(4px)", VALUE_BAN],
    ["filter: grayscale(1) blur(2px)", VALUE_BAN],
    ["backdrop-filter: blur(4px)", VALUE_BAN],
    ["-webkit-backdrop-filter: blur(4px)", VALUE_BAN],
    ["filter: drop-shadow(0 0 1px var(--ink))", VALUE_BAN],
    ["text-overflow: ellipsis", VALUE_BAN],
    ["-webkit-line-clamp: 2", PROPERTY_BAN],
    ["line-clamp: 2", PROPERTY_BAN],
    ["display: none !important", "declaration-no-important"],
    ["view-transition-name: card", PROPERTY_BAN],
    ["scroll-behavior: smooth", VALUE_BAN],
    ["text-shadow: 0 1px 0 var(--rule)", PROPERTY_BAN],
  ])("bans %s", async (declaration, rule) => {
    expect(await rules(`.card { ${declaration}; }`)).toContain(rule);
  });

  it("bans @view-transition", async () => {
    expect(await rules("@view-transition { navigation: auto; }")).toContain(
      "at-rule-disallowed-list",
    );
  });

  it.each([
    "color",
    "background",
    "background-color",
    "border-color",
    "border-top-color",
    "border-inline-start-color",
    "border-block-color",
    "outline-color",
    "fill",
    "stroke",
    "text-decoration-color",
    "accent-color",
    "caret-color",
    "column-rule-color",
    "-webkit-tap-highlight-color",
  ])("requires a color token for %s", async (property) => {
    // A system color: no hex, name or function for the other color rules to catch.
    expect(await rules(`.card { ${property}: CanvasText; }`)).toContain(STRICT);
  });

  it.each([
    ["border: 1px solid #000", "color-no-hex"],
    ["outline: 2px solid black", "color-named"],
    ["text-decoration: underline rgb(0 0 0)", "function-disallowed-list"],
    ["border-inline-start: 1px solid oklch(0.5 0.1 200)", "function-disallowed-list"],
    ["color: color-mix(in oklab, var(--ink), var(--page))", "function-disallowed-list"],
    ["color: color-mix(in oklab, var(--ink), var(--page))", STRICT],
    ["color: light-dark(var(--ink), var(--page))", "function-disallowed-list"],
    ["color: light-dark(var(--ink), var(--page))", STRICT],
    ["--tint: #f4f3ef", "color-no-hex"],
    ["--tint: white", "color-named"],
    ["--tint: oklch(0.5 0.12 180)", "function-disallowed-list"],
    ["color: var(--ink, #000)", "btw/token-fallbacks"],
    ["border: 1px solid CanvasText", SYSTEM_COLORS],
    ["border-block-end: 1px solid buttonborder", SYSTEM_COLORS],
    ["outline: 2px solid Highlight", SYSTEM_COLORS],
    ["text-decoration: underline LinkText", SYSTEM_COLORS],
    ["column-rule: 1px solid GrayText", SYSTEM_COLORS],
    ["text-emphasis: dot CanvasText", SYSTEM_COLORS],
    ["-webkit-text-stroke: 1px CanvasText", SYSTEM_COLORS],
    ["--tint: CanvasText", SYSTEM_COLORS],
  ])("closes the color loophole %s", async (declaration, rule) => {
    expect(await rules(`.card { ${declaration}; }`)).toContain(rule);
  });

  it.each([
    ["font-size: 16px", STRICT],
    ["font-size: 1.2rem", STRICT],
    ["font-size: larger", STRICT],
    ["font-size: calc(var(--step-1) * 1.2)", STRICT],
    ["font-size: clamp(var(--step-0), 2vw, var(--step-1))", STRICT],
    ["font-size: var(--step-1, 19px)", "btw/token-fallbacks"],
    ["font: 16px/1.6 serif", "declaration-property-value-allowed-list"],
    ["font: var(--step-0) serif", "declaration-property-value-allowed-list"],
  ])("requires a type-scale token: %s", async (declaration, rule) => {
    expect(await rules(`.card { ${declaration}; }`)).toContain(rule);
  });

  it.each([
    "margin",
    "margin-top",
    "margin-inline",
    "margin-inline-start",
    "margin-block",
    "margin-block-end",
    "padding",
    "padding-left",
    "padding-inline",
    "padding-block-start",
    "gap",
    "row-gap",
    "column-gap",
    "grid-gap",
    "inset",
    "inset-inline",
    "inset-block",
    "inset-inline-end",
    "top",
    "right",
    "bottom",
    "left",
  ])("requires a spacing token for %s", async (property) => {
    expect(await rules(`.card { ${property}: 4px; }`)).toContain(STRICT);
  });

  it.each([
    ["margin: var(--space-1) 4px", STRICT],
    ["padding-inline: var(--space-1) 1em", STRICT],
    ["margin-block: calc(var(--space-1) * 2)", STRICT],
    ["gap: var(--space-1, 4px)", "btw/token-fallbacks"],
    ["--gutter: 13px", "btw/raw-custom-properties"],
    ["--gutter: calc(var(--space-1) + 0.5rem)", "btw/raw-custom-properties"],
  ])("closes the spacing loophole %s", async (declaration, rule) => {
    expect(await rules(`.card { ${declaration}; }`)).toContain(rule);
  });

  it.each([
    "border-radius",
    "border-top-left-radius",
    "border-start-start-radius",
    "border-end-end-radius",
  ])("requires a radius token for %s", async (property) => {
    expect(await rules(`.card { ${property}: 4px; }`)).toContain(STRICT);
  });

  it("requires a radius token for a percentage", async () => {
    expect(await rules(".card { border-radius: 50%; }")).toContain(STRICT);
  });

  it.each([
    [".title", "text-transform: uppercase"],
    [`.card .${LABEL_CLASS} span`, "text-transform: uppercase"],
    [`.${LABEL_CLASS}, .title`, "text-transform: uppercase"],
    [`.title:not(.${LABEL_CLASS})`, "text-transform: uppercase"],
    [`.${LABEL_CLASS}-ish`, "text-transform: uppercase"],
    [".title", "font-variant-caps: all-small-caps"],
    [".title", "font-variant: small-caps"],
  ])("rejects caps on %s { %s }", async (selector, declaration) => {
    expect(await rules(`${selector} { ${declaration}; }`)).toContain(CAPS);
  });

  it("rejects caps nested under the label class but on another element", async () => {
    expect(await rules(`.${LABEL_CLASS} { & span { text-transform: uppercase; } }`)).toContain(
      CAPS,
    );
  });

  it.each([
    `.${LABEL_CLASS}`,
    `.card .${LABEL_CLASS}`,
    `.${LABEL_CLASS}:hover`,
    `h2.${LABEL_CLASS}`,
  ])("allows caps on %s", async (selector) => {
    expect(await rules(`${selector} { text-transform: uppercase; }`)).toEqual([]);
  });

  it("allows caps in a rule nested to the label class", async () => {
    expect(await rules(`.card { & .${LABEL_CLASS} { text-transform: uppercase; } }`)).toEqual([]);
  });

  it.each([
    ["outside the media query", `.${SEEN_TOGGLE_CLASS} { transition: scale 0.2s; }`],
    ["off the seen toggle", `${motionQuery} { .card { transition: opacity 0.2s; } }`],
    ["off the seen toggle, nested", `.card { ${motionQuery} { animation: pop 1s; } }`],
    [
      "on a parent of the seen toggle",
      `${motionQuery} { .card:has(.${SEEN_TOGGLE_CLASS}) { transition: opacity 0.2s; } }`,
    ],
    [
      "on a list that includes another class",
      `${motionQuery} { .${SEEN_TOGGLE_CLASS}, .card { transition: scale 0.2s; } }`,
    ],
    [
      "under reduced motion",
      `@media (prefers-reduced-motion: reduce) { .${SEEN_TOGGLE_CLASS} { transition: scale 0.2s; } }`,
    ],
    [
      "under a negated query",
      `@media not (prefers-reduced-motion: reduce) { .${SEEN_TOGGLE_CLASS} { transition: scale 0.2s; } }`,
    ],
    [
      "under a query list",
      `@media (prefers-reduced-motion: no-preference), print { .${SEEN_TOGGLE_CLASS} { transition: scale 0.2s; } }`,
    ],
    ["for a longhand", `.card { transition-duration: 0.2s; }`],
    ["for an animation longhand", `.card { animation-name: pop; }`],
    [
      "on a sibling after the toggle (~)",
      `${motionQuery} { .${SEEN_TOGGLE_CLASS} ~ .poster { transition: opacity 0.2s; } }`,
    ],
    [
      "on the next sibling (+)",
      `${motionQuery} { .${SEEN_TOGGLE_CLASS} + .card { transition: opacity 0.2s; } }`,
    ],
    [
      "on a sibling, nested",
      `.${SEEN_TOGGLE_CLASS} { ${motionQuery} { & + .card svg { animation: pop 0.3s; } } }`,
    ],
  ])("rejects motion %s", async (_, code) => {
    expect(await rules(code)).toContain(MOTION);
  });

  it.each([
    ["inside both", `${motionQuery} { .${SEEN_TOGGLE_CLASS} { transition: scale 0.2s; } }`],
    ["nested in the toggle", `.${SEEN_TOGGLE_CLASS} { ${motionQuery} { animation: pop 0.3s; } }`],
    [
      "on a part of the toggle",
      `${motionQuery} { .${SEEN_TOGGLE_CLASS}:active svg { transition: scale 0.2s; } }`,
    ],
    [
      "on a child of a toggle that follows a sibling",
      `${motionQuery} { .card + .${SEEN_TOGGLE_CLASS} > svg { transition: scale 0.2s; } }`,
    ],
    [
      "with another feature",
      `@media (prefers-reduced-motion: no-preference) and (hover: hover) { .${SEEN_TOGGLE_CLASS} { transition: scale 0.2s; } }`,
    ],
  ])("allows motion %s", async (_, code) => {
    expect(await rules(code)).toEqual([]);
  });

  describe("the tokens file", () => {
    const definitions = `
      :root {
        --ink: #1c2126;
        --mooby: oklch(0.5 0.12 190);
        --step-0: 16px;
        --space-2: 0.5rem;
        --radius-poster: 4px;
        @media (forced-colors: active) { --ink: CanvasText; }
      }
      @font-face { font-family: "Newsreader"; src: url("n.woff2") format("woff2"); size-adjust: 104%; }
    `;

    it("is exempt from the token rules", async () => {
      expect(await rules(definitions, TOKENS_FILE)).toEqual([]);
    });

    it("is the only exempt file", async () => {
      expect(await rules(definitions, "app/render/styles/other-tokens.css")).toEqual(
        expect.arrayContaining([
          "color-no-hex",
          "function-disallowed-list",
          "btw/raw-custom-properties",
        ]),
      );
    });

    it.each(["body { color: #000; }", "body { @media (min-width: 40rem) { margin: 13px; } }"])(
      "only defines custom properties: %s",
      async (code) => {
        expect(await rules(code, TOKENS_FILE)).toEqual(["btw/tokens-file-defines-only"]);
      },
    );

    it("still has the bans", async () => {
      expect(
        await rules(
          ":root { --sheen: linear-gradient(#fff, #000); --ink: #000 !important; }",
          TOKENS_FILE,
        ),
      ).toEqual(expect.arrayContaining([VALUE_BAN, "declaration-no-important"]));
    });
  });
});

describe("eslint", () => {
  const eslint = new ESLint({ overrideConfigFile: join(root, "eslint.app.config.js"), cwd: root });
  let counter = 0;

  // Type-aware rules need the file in a layer's tsconfig, so it briefly exists on disk.
  async function lint(layer: string, code: string, extension = ".ts") {
    counter += 1;
    const filePath = join(
      root,
      "app",
      layer,
      `__guardrail-${process.pid}-${counter}__${extension}`,
    );
    writeFileSync(filePath, code);
    try {
      const [result] = await eslint.lintText(code, { filePath });
      return (result?.messages ?? []).map((message) => message.ruleId);
    } finally {
      rmSync(filePath);
    }
  }

  it.each([
    ["any", "domain", "export const x: any = 1;\n", "@typescript-eslint/no-explicit-any"],
    [
      "`as` in a non-test file",
      "domain",
      "export const f = (x: unknown) => x as string;\n",
      "@typescript-eslint/consistent-type-assertions",
    ],
    [
      "`!`",
      "domain",
      "export const f = (x: string | undefined) => x!;\n",
      "@typescript-eslint/no-non-null-assertion",
    ],
    [
      "preact in client",
      "client",
      'import { h } from "preact";\nexport const f = h;\n',
      "no-restricted-imports",
    ],
    [
      "preact in domain",
      "domain",
      'import { h } from "preact";\nexport const f = h;\n',
      "no-restricted-imports",
    ],
    [
      "preact/hooks in client",
      "client",
      'import { useState } from "preact/hooks";\nexport const f = useState;\n',
      "no-restricted-imports",
    ],
    [
      "node:fs in domain",
      "domain",
      'import { readFileSync } from "node:fs";\nexport const f = readFileSync;\n',
      "no-restricted-imports",
    ],
    [
      "fs in domain",
      "domain",
      'import { readFileSync } from "fs";\nexport const f = readFileSync;\n',
      "no-restricted-imports",
    ],
    [
      "an inline type import that still loads the schema in client",
      "client",
      'import { type Film } from "../shared/listings.ts";\nexport type F = Film;\n',
      "@typescript-eslint/no-import-type-side-effects",
    ],
  ])("rejects %s", async (_, layer, code, rule) => {
    expect(await lint(layer, code)).toContain(rule);
  });

  const readsTheClock: [string, string][] = [
    ["Date.now()", "export const f = () => Date.now();\n"],
    ["Date.now as a value", "export const f = Date.now;\n"],
    ["new Date()", "export const f = () => new Date();\n"],
    ["Date() without new", "export const f = () => Date();\n"],
    ["Date(x) without new", "export const f = (ms: number) => Date(ms);\n"],
    ["new globalThis.Date()", "export const f = () => new globalThis.Date();\n"],
    ["globalThis.Date.now()", "export const f = () => globalThis.Date.now();\n"],
    ["format() with no date", 'export const f = () => new Intl.DateTimeFormat("en").format();\n'],
    [
      "formatToParts() with no date",
      'export const f = () => new Intl.DateTimeFormat("en").formatToParts();\n',
    ],
  ];
  it.each(
    ["shared", "domain"].flatMap((layer) =>
      readsTheClock.map(([what, code]): [string, string, string] => [layer, what, code]),
    ),
  )("rejects reading the clock in %s: %s", async (layer, _, code) => {
    expect(await lint(layer, code)).toContain("no-restricted-syntax");
  });

  it("rejects a jsx-a11y violation in render", async () => {
    expect(
      await lint("render", 'export const Poster = () => <img src="p.jpg" />;\n', ".tsx"),
    ).toContain("jsx-a11y/alt-text");
  });

  it.each([
    ["`as const`", "domain", 'export const xs = ["a", "b"] as const;\n', ".ts"],
    [
      "`as` in a test file",
      "domain",
      "export const f = (x: unknown) => x as string;\n",
      ".test.ts",
    ],
    ["new Date(x) in domain", "domain", "export const f = (ms: number) => new Date(ms);\n", ".ts"],
    ["new Date(x) in shared", "shared", "export const f = (ms: number) => new Date(ms);\n", ".ts"],
    [
      "format(x) in shared",
      "shared",
      'export const f = (d: Date) => new Intl.DateTimeFormat("en").format(d);\n',
      ".ts",
    ],
    ["Date.now() in pipeline", "pipeline", "export const f = () => Date.now();\n", ".ts"],
    ["preact in render", "render", 'import { h } from "preact";\nexport const f = h;\n', ".ts"],
  ])("allows %s", async (_, layer, code, extension) => {
    expect(await lint(layer, code, extension)).toEqual([]);
  });
});

describe("dependency-cruiser", () => {
  const depcruise = createRequire(import.meta.url)(
    join(root, ".dependency-cruiser.cjs"),
  ) as IConfiguration;
  /** [file, code, the rule it breaks] */
  const violations: [string, string, string][] = [
    [
      "app/shared/cycle-a.ts",
      'import { b } from "./cycle-b.ts";\nexport const a = () => b;\n',
      "no-circular",
    ],
    ["app/render/imports-missing.ts", 'import "./missing.ts";\n', "not-to-unresolvable"],
    ["app/domain/imports-render.ts", 'import "../render/view.ts";\n', "domain-is-pure"],
    [
      "app/domain/imports-zod.ts",
      'import type { z } from "zod";\nexport type S = z.ZodString;\n',
      "domain-is-pure",
    ],
    [
      "app/domain/imports-node.ts",
      'import { readFileSync } from "node:fs";\nexport const f = readFileSync;\n',
      "domain-no-node-core",
    ],
    ["app/shared/imports-domain.ts", 'import "../domain/pure.ts";\n', "shared-imports-nothing"],
    ["app/shared/imports-preact.ts", 'import "preact";\n', "shared-imports-nothing"],
    [
      "app/client/imports-render.ts",
      'import "../render/view.ts";\n',
      "client-only-shared-and-domain",
    ],
    ["app/client/imports-preact.ts", 'import "preact";\n', "client-only-shared-and-domain"],
    ["app/client/imports-package.ts", 'import "fast-check";\n', "client-only-shared-and-domain"],
    [
      "app/domain/imports-schemas.ts",
      'import { Listings } from "../shared/listings.ts";\nexport const f = Listings;\n',
      "schemas-only-as-types-in-the-browser",
    ],
    [
      "app/client/imports-schemas.ts",
      'import { Listings } from "../shared/listings.ts";\nexport const f = Listings;\n',
      "schemas-only-as-types-in-the-browser",
    ],
    ["app/shared/imports-zod.ts", 'import "zod";\n', "schemas-only-as-types-in-the-browser"],
    [
      "app/pipeline/imports-domain.ts",
      'import "../domain/pure.ts";\n',
      "pipeline-render-share-only-shared",
    ],
    [
      "app/render/imports-pipeline.ts",
      'import "../pipeline/job.ts";\n',
      "render-no-pipeline-or-client",
    ],
    ["app/render/imports-e2e.ts", 'import "../e2e/page.ts";\n', "nothing-imports-pipeline-or-e2e"],
    [
      "app/render/imports-pipeline.ts",
      'import "../pipeline/job.ts";\n',
      "nothing-imports-pipeline-or-e2e",
    ],
    [
      "app/pipeline/imports-fixture.ts",
      'import "../fixture/build.ts";\n',
      "fixture-only-in-tests-and-dev",
    ],
    ["app/pipeline/imports-preact.ts", 'import "preact";\n', "preact-only-in-render"],
  ];
  /** Files no rule should flag: import targets, and imports the rules allow. */
  const allowed: Record<string, string> = {
    "app/shared/cycle-b.ts": 'import { a } from "./cycle-a.ts";\nexport const b = () => a;\n',
    "app/shared/listings.ts":
      'import { z } from "zod";\nexport const Listings = z.object({});\nexport type Listings = z.infer<typeof Listings>;\n',
    "app/render/view.ts": "export const view = 1;\n",
    "app/render/imports-preact-and-schemas.ts":
      'import "preact";\nimport { Listings } from "../shared/listings.ts";\nexport const f = Listings;\n',
    "app/domain/pure.ts": "export const pure = 1;\n",
    "app/domain/imports-schema-types.ts":
      'import type { Listings } from "../shared/listings.ts";\nexport type L = Listings;\n',
    "app/client/imports-shared-and-domain.ts":
      'import type { Listings } from "../shared/listings.ts";\nimport "../shared/cycle-b.ts";\nimport "../domain/pure.ts";\nexport type L = Listings;\n',
    "app/pipeline/job.ts": "export const job = 1;\n",
    "app/pipeline/imports-schemas.ts":
      'import { Listings } from "../shared/listings.ts";\nexport const f = Listings;\n',
    "app/e2e/page.ts": "export const page = 1;\n",
    "app/fixture/build.ts":
      'import type { Listings } from "../shared/listings.ts";\nexport type L = Listings;\n',
    "app/render/imports-fixture.test.ts": 'import "../fixture/build.ts";\n',
  };
  let base = "";
  let result: ICruiseResult | undefined;

  beforeAll(async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "guardrails-")));
    const files: [string, string][] = [
      ...violations.map(([path, code]): [string, string] => [path, code]),
      ...Object.entries(allowed),
    ];
    for (const [path, code] of files) {
      mkdirSync(dirname(join(base, path)), { recursive: true });
      writeFileSync(join(base, path), code);
    }
    symlinkSync(realpathSync(join(root, "node_modules")), join(base, "node_modules"));
    const { output } = await cruise(["app"], {
      ...depcruise.options,
      baseDir: base,
      validate: true,
      ruleSet: { forbidden: depcruise.forbidden ?? [] },
    });
    if (typeof output !== "string") result = output;
  });

  afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  const rulesFrom = (from: string) =>
    (result?.summary.violations ?? [])
      .filter((violation) => violation.from === from)
      .map((violation) => violation.rule.name);

  it.each(violations.map(([path, , rule]) => [path, rule]))("%s violates %s", (from, rule) => {
    expect(rulesFrom(from)).toContain(rule);
  });

  it("has a planted violation for every forbidden rule", () => {
    const tested = new Set(violations.map(([, , rule]) => rule));
    expect(
      (depcruise.forbidden ?? [])
        .map((rule) => rule.name ?? "(unnamed)")
        .filter((name) => !tested.has(name)),
    ).toEqual([]);
  });

  it("resolves every other import, so each violation is the layer rule's", () => {
    expect(
      (result?.summary.violations ?? [])
        .filter((violation) => violation.rule.name === "not-to-unresolvable")
        .map((violation) => violation.from),
    ).toEqual(["app/render/imports-missing.ts"]);
  });

  it("lets the allowed imports stand", () => {
    expect(Object.keys(allowed).flatMap(rulesFrom)).toEqual([]);
  });
});
