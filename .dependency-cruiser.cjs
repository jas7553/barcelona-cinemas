const PREACT = "node_modules/(preact|preact-render-to-string)/";

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
      severity: "error",
      from: { path: "^app/shared/" },
      to: { path: "^app/(domain|pipeline|render|client|e2e)/" },
    },
    {
      name: "client-no-render",
      severity: "error",
      from: { path: "^app/client/" },
      to: { path: "^app/render/" },
    },
    {
      name: "client-no-preact",
      severity: "error",
      from: { path: "^app/client/" },
      to: { path: PREACT },
    },
    {
      name: "client-only-shared-and-domain",
      severity: "error",
      from: { path: "^app/client/" },
      to: { path: "^app/(pipeline|render|e2e)/" },
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
      comment: "the fixture is test data: only tests, e2e and dev scripts import it",
      severity: "error",
      from: { pathNot: "(\\.test\\.tsx?$|^app/(e2e|fixture|dev)/)" },
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
