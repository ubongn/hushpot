#!/usr/bin/env node
// Compile the Hushpot contract.
//
// The Compact compiler (compactc) ships prebuilt binaries for macOS and
// Linux only. On Windows this script runs the compiler inside WSL
// (Ubuntu-24.04); on macOS/Linux it runs compactc directly.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = "contracts/hushpot.compact";
const out = "managed/hushpot";

const isWindows = process.platform === "win32";
const cmd = isWindows
  ? [
      "wsl",
      [
        "-d",
        "mnc",
        "-u",
        "root",
        "--",
        "bash",
        "-lc",
        `cd ${toWslPath(root)} && sed -i 's/\\r$//' ${src} && source ~/.local/bin/env && compact compile ${src} ${out}`,
      ],
    ]
  : ["compact", ["compile", src, out]];

function toWslPath(p) {
  return p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d) => `/mnt/${d.toLowerCase()}`);
}

console.log(`[compile] ${src} -> ${out} (${isWindows ? "via WSL" : "native"})`);
execFileSync(cmd[0], cmd[1], { stdio: "inherit" });
console.log("[compile] done");
