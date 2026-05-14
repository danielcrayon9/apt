import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const sourceDir = resolve("web");
const outputDir = resolve("dist");

if (!existsSync(sourceDir)) {
  throw new Error("The web directory was not found.");
}

rmSync(outputDir, { recursive: true, force: true });
cpSync(sourceDir, outputDir, { recursive: true });

console.log("Copied web/ to dist/ for Vercel deployment.");
