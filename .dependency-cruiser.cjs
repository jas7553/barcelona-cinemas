const PREACT = "node_modules/(preact|preact-render-to-string)/";
const ZOD = "node_modules/zod/";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "domain-is-pure",
      comment: "domain imports only domain and shared: no npm packages, no other layers",
      severity: "error",
      from: { path: "^app/domain/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^app/(domain|shared)/" },
    },
    {
      name: "domain-no-node-core",
      severity: "error",
      from: { path: "^app/domain/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "shared-imports-nothing",
      comment: "shared imports only shared, and zod for the schemas",
      severity: "error",
      from: { path: "^app/shared/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: `^app/shared/|${ZOD}` },
    },
    {
      name: "client-only-shared-and-domain",
      comment: "client imports only client, shared and domain: no npm packages, so no framework",
      severity: "error",
      from: { path: "^app/client/", pathNot: "\\.test\\.tsx?$" },
      to: { pathNot: "^app/(client|shared|domain)/" },
    },
    {
      name: "schemas-only-as-types-in-the-browser",
      comment:
        "Everything the client can reach (client, domain, shared) imports listings.ts for its types only, so zod stays out of the browser. A `reachable` rule can't say this: it follows type-only imports too.",
      severity: "error",
      from: {
        path: "^app/(client|domain|shared)/",
        pathNot: "(\\.test\\.tsx?$|^app/shared/listings\\.ts$)",
      },
      to: {
        path: `^app/shared/listings\\.ts$|${ZOD}`,
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "pipeline-render-share-only-shared",
      severity: "error",
      from: { path: "^app/pipeline/" },
      to: { path: "^app/(render|client|domain|e2e)/" },
    },
    {
      name: "render-no-pipeline-or-client",
      severity: "error",
      from: { path: "^app/render/" },
      to: { path: "^app/(pipeline|client|e2e)/" },
    },
    {
      name: "nothing-imports-pipeline-or-e2e",
      severity: "error",
      from: { path: "^app/(shared|domain|render|client)/" },
      to: { path: "^app/(pipeline|e2e)/" },
    },
    {
      name: "fixture-only-in-tests-and-dev",
      comment: "the fixture is test data: only tests, e2e and the fixture's own writer import it",
      severity: "error",
      from: { pathNot: "(\\.test\\.tsx?$|^app/(e2e|fixture)/)" },
      to: { path: "^app/fixture/" },
    },
    {
      name: "preact-only-in-render",
      severity: "error",
      from: { path: "^app/", pathNot: "^app/render/" },
      to: { path: PREACT },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "app/tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js"],
    },
  },
};
