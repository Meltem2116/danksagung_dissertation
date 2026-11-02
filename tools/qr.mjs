#!/usr/bin/env node
// Dev-only: shells out to the "qrcode" npm package via npx (downloaded on first use).
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import path from "node:path";
import { formatCode } from "../docs/assets/crypto.js";
import { ROOT, SITE_URL } from "./config.mjs";

const { values: opts } = parseArgs({
  options: {
    url: { type: "string", default: SITE_URL },
    input: { type: "string", default: path.join(ROOT, "people.json") },
    personal: { type: "boolean", default: true },
  },
});

const QRCODE = "qrcode@1.5.4";

function qr(text, file) {
  execFileSync("npx", ["--yes", QRCODE, "--type", "svg", "--error", "H", "--qzone", "4", "--output", file, text], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`  ✓ ${path.relative(process.cwd(), file)}  →  ${text}`);
}

const slug = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

await mkdir(path.join(ROOT, "qr"), { recursive: true });
qr(opts.url, path.join(ROOT, "qr", "dissertation.svg"));

if (opts.personal && existsSync(opts.input)) {
  const { people } = JSON.parse(await readFile(opts.input, "utf8"));
  const dir = path.join(ROOT, "private", "qr");
  await mkdir(dir, { recursive: true });
  for (const person of people.filter((p) => p.code)) qr(`${opts.url}#${formatCode(person.code)}`, path.join(dir, `${slug(person.name)}.svg`));
}
