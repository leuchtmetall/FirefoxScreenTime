import { cp, mkdir, rm } from "node:fs/promises";
import { watch as watchFiles } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outputDirectory = resolve(root, "dist");
const watch = process.argv.includes("--watch");
const manifestPath = resolve(root, "public/manifest.json");

/** Increments the patch component of the version in `public/manifest.json`. */
async function bumpManifestVersion(): Promise<string> {
  const manifest = await Bun.file(manifestPath).text();
  let next: string | undefined;
  const bumped = manifest.replace(
    /("version"\s*:\s*")(\d+)\.(\d+)\.(\d+)(")/,
    (_match, prefix: string, major: string, minor: string, patch: string, suffix: string) => {
      next = `${major}.${minor}.${Number(patch) + 1}`;
      return `${prefix}${next}${suffix}`;
    },
  );
  if (next === undefined) {
    throw new Error(`No "major.minor.patch" version found in ${manifestPath}`);
  }
  await Bun.write(manifestPath, bumped);
  return next;
}

async function build(options: { bumpVersion: boolean }): Promise<void> {
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  const result = await Bun.build({
    entrypoints: [
      resolve(root, "src/background.ts"),
      resolve(root, "src/content.ts"),
      resolve(root, "src/popup.ts"),
    ],
    outdir: outputDirectory,
    target: "browser",
    format: "iife",
    minify: false,
    sourcemap: "external",
    naming: "[dir]/[name].[ext]",
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Extension build failed");
  }

  // Bump only after a successful bundle so failed builds do not consume a version.
  if (options.bumpVersion) {
    console.log(`Bumped manifest version to ${await bumpManifestVersion()}`);
  }

  await cp(resolve(root, "public"), outputDirectory, { recursive: true });
}

// Watch mode never bumps: writing to public/ would retrigger the watcher endlessly.
await build({ bumpVersion: !watch });
console.log(`Built extension in ${outputDirectory}`);

if (watch) {
  console.log("Watching src/ and public/ for changes...");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void build({ bumpVersion: false })
        .then(() => console.log(`Rebuilt at ${new Date().toLocaleTimeString()}`))
        .catch(console.error);
    }, 75);
  };
  watchFiles(resolve(root, "src"), { recursive: true }, rebuild);
  watchFiles(resolve(root, "public"), { recursive: true }, rebuild);
  await new Promise(() => undefined);
}
