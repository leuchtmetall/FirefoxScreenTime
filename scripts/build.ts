import { cp, mkdir, rm } from "node:fs/promises";
import { watch as watchFiles } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outputDirectory = resolve(root, "dist");
const watch = process.argv.includes("--watch");

async function build(): Promise<void> {
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

  await cp(resolve(root, "public"), outputDirectory, { recursive: true });
}

await build();
console.log(`Built extension in ${outputDirectory}`);

if (watch) {
  console.log("Watching src/ and public/ for changes...");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void build()
        .then(() => console.log(`Rebuilt at ${new Date().toLocaleTimeString()}`))
        .catch(console.error);
    }, 75);
  };
  watchFiles(resolve(root, "src"), { recursive: true }, rebuild);
  watchFiles(resolve(root, "public"), { recursive: true }, rebuild);
  await new Promise(() => undefined);
}
