import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { normalizeCode, formatCode } from "../docs/assets/crypto.js";

const BINARY = /\.(bin|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|ico|pdf)$/i;

export function needlesFor(people) {
  const needles = new Set();
  for (const p of people) {
    if (p.name) {
      needles.add(p.name);
      for (const word of p.name.split(/\s+/)) if (word.length >= 4) needles.add(word);
    }
    if (p.code) {
      needles.add(normalizeCode(p.code));
      needles.add(formatCode(p.code));
    }
  }
  return [...needles];
}

export async function filesUnder(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath ?? e.path, e.name));
}

export function filesGitWouldPublish(root) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((f) => path.join(root, f));
}

export async function findLeaks(files, needles) {
  const patterns = needles.map((n) => [n, new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu")]);
  const leaks = [];
  for (const file of files) {
    if (BINARY.test(file)) continue;
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const [needle, re] of patterns) if (re.test(text)) leaks.push({ file, needle });
  }
  return leaks;
}
