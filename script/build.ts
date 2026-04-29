import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "@octokit/rest",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "marked",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "postcss",
  "sanitize-html",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await Promise.all([
    buildServerEntry("server/index.ts", "dist/index.cjs", pkg.version, externals, "cjs"),
    buildServerEntry("server/mcp.ts", "dist/mcp.cjs", pkg.version, externals, "cjs"),
    buildServerEntry("server/tui/index.tsx", "dist/tui.mjs", pkg.version, externals, "esm"),
    buildServerEntry("server/cli.ts", "dist/cli.cjs", pkg.version, externals, "cjs"),
  ]);
}

async function buildServerEntry(
  entryPoint: string,
  outfile: string,
  version: string,
  external: string[],
  format: "cjs" | "esm",
) {
  await esbuild({
    entryPoints: [entryPoint],
    platform: "node",
    bundle: true,
    format,
    outfile,
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.APP_VERSION": JSON.stringify(version),
    },
    minify: true,
    external,
    logLevel: "error",
    // ESM bundles need a working `require` for any bundled CJS dep that
    // calls `require("path")` etc. at module init (e.g. postcss). Without
    // this banner, esbuild's dynamic-require shim throws at runtime.
    banner:
      format === "esm"
        ? {
            js: "import { createRequire as __esbuildCreateRequire } from 'node:module'; const require = __esbuildCreateRequire(import.meta.url);\n",
          }
        : undefined,
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
