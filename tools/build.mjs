#!/usr/bin/env node
import { readFile, writeFile, readdir, unlink, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import path from "node:path";
import { deriveKeys, encrypt, generateCode, normalizeCode, isWellFormed, formatCode, toHex, ALPHABET, CODE_LENGTH } from "../docs/assets/crypto.js";
import { markdownToHtml } from "./markdown.mjs";
import { needlesFor, findLeaks, filesUnder, filesGitWouldPublish } from "./privacy.mjs";
import { ROOT, SITE_URL, ITERATIONS } from "./config.mjs";

const { values: opts } = parseArgs({
  options: {
    input: { type: "string", default: path.join(ROOT, "people.json") },
    out: { type: "string", default: path.join(ROOT, "docs") },
    private: { type: "string", default: path.join(ROOT, "private") },
  },
});

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".svg": "image/svg+xml" };
const PHOTO_MAX_PX = 1600;
const BUCKET_BASE = 4096;

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function mimeOf(file) {
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type) fail(`Unsupported image type: ${file}`);
  return type;
}

async function dataUrl(file, { photo = false } = {}) {
  if (!existsSync(file)) fail(`Image not found: ${file}`);
  let type = mimeOf(file);
  let bytes;
  if (photo && type !== "image/svg+xml" && existsSync("/usr/bin/sips")) {
    const dir = await mkdtemp(path.join(tmpdir(), "danksagung-"));
    const out = path.join(dir, "photo.jpg");
    const dims = execFileSync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
    const largest = Math.max(...[...dims.matchAll(/pixel\w+: (\d+)/g)].map((m) => Number(m[1])));
    const args = largest > PHOTO_MAX_PX ? ["-Z", String(PHOTO_MAX_PX)] : [];
    execFileSync("/usr/bin/sips", [...args, "-s", "format", "jpeg", "-s", "formatOptions", "82", file, "--out", out], { stdio: "ignore" });
    bytes = await readFile(out);
    type = "image/jpeg";
    await rm(dir, { recursive: true, force: true });
  } else {
    bytes = await readFile(file);
    if (photo && bytes.length > 1_500_000) console.warn(`  ! ${path.basename(file)} is ${(bytes.length / 1e6).toFixed(1)} MB; consider resizing it.`);
  }
  return `data:${type};base64,${bytes.toString("base64")}`;
}

function pad(json) {
  const length = Buffer.byteLength(json);
  let size = BUCKET_BASE;
  while (size < length) size *= 4;
  return json + " ".repeat(size - length);
}

async function loadParams(dataDir) {
  const file = path.join(dataDir, "params.json");
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const params = { v: 1, kdf: "PBKDF2-SHA256 + HKDF-SHA256", iterations: ITERATIONS, salt: toHex(crypto.getRandomValues(new Uint8Array(16))) };
  await writeFile(file, JSON.stringify(params, null, 2) + "\n");
  console.log("  Generated a new salt in data/params.json");
  return params;
}

function assignCodes(people) {
  const seen = new Map();
  let generated = 0;
  for (const person of people) {
    if (!person.name) fail(`Every person needs a "name" (used only locally): ${JSON.stringify(person).slice(0, 80)}`);
    if (!person.code) {
      let code;
      do code = generateCode();
      while (seen.has(code));
      person.code = formatCode(code);
      generated++;
    }
    const code = normalizeCode(person.code);
    if (!isWellFormed(code)) fail(`Code for "${person.name}" must be ${CODE_LENGTH} characters from ${ALPHABET} (got "${person.code}"). Delete it to generate one.`);
    if (seen.has(code)) fail(`"${person.name}" and "${seen.get(code)}" share the same code.`);
    seen.set(code, person.name);
  }
  return generated;
}

async function payloadFor(person, config, baseDir) {
  const resolve = (p) => path.resolve(baseDir, p);
  let html;
  if (person.html) html = person.html;
  else if (person.htmlFile) html = await readFile(resolve(person.htmlFile), "utf8");
  else if (person.messageFile) html = markdownToHtml(await readFile(resolve(person.messageFile), "utf8"));
  else if (person.message) html = markdownToHtml(person.message);
  else fail(`"${person.name}" has no message, messageFile, html or htmlFile.`);

  const payload = { v: 1, lang: person.lang || config.lang || "de", greeting: person.greeting || "", html };
  if (person.photo) payload.photo = { src: await dataUrl(resolve(person.photo), { photo: true }), alt: person.photoAlt || "" };
  const signatureText = person.signature ?? config.signature;
  const signatureImage = person.signatureImage ?? config.signatureImage;
  if (signatureText || signatureImage) {
    payload.signature = { text: signatureText || "" };
    if (signatureImage) payload.signature.image = await dataUrl(resolve(signatureImage));
  }
  return payload;
}

function csv(rows) {
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
}

const inputPath = path.resolve(opts.input);
const outDir = path.resolve(opts.out);
const dataDir = path.join(outDir, "data");
const privateDir = path.resolve(opts.private);

if (!existsSync(inputPath)) fail(`${inputPath} not found. Copy people.example.json to people.json to get started.`);
const config = JSON.parse(await readFile(inputPath, "utf8"));
const people = config.people || fail(`${inputPath} needs a "people" array.`);

console.log(`Building ${people.length} message(s) from ${path.relative(process.cwd(), inputPath) || inputPath}`);
await mkdir(dataDir, { recursive: true });
const params = await loadParams(dataDir);
if (params.iterations < ITERATIONS) fail(`params.json uses only ${params.iterations} iterations.`);

if (assignCodes(people)) {
  await writeFile(inputPath, JSON.stringify(config, null, 2) + "\n");
  console.log("  Generated missing codes and saved them back to the input file");
}

const written = new Set();
const rows = [["name", "code", "link"]];
for (const person of people) {
  const payload = await payloadFor(person, config, path.dirname(inputPath));
  if (/[–—]/.test(payload.greeting + payload.html)) console.warn(`  ! "${person.name}" contains a dash (– or —); the site avoids them.`);
  const { id, key } = await deriveKeys(person.code, params);
  await writeFile(path.join(dataDir, `${id}.bin`), await encrypt(key, id, pad(JSON.stringify(payload))));
  written.add(`${id}.bin`);
  rows.push([person.name, formatCode(person.code), `${SITE_URL}#${formatCode(person.code)}`]);
  console.log(`  ✓ ${person.name.padEnd(28)} ${formatCode(person.code)}`);
}

for (const file of await readdir(dataDir)) {
  if (file.endsWith(".bin") && !written.has(file)) {
    await unlink(path.join(dataDir, file));
    console.log(`  Removed stale ${file}`);
  }
}

await mkdir(privateDir, { recursive: true });
await writeFile(path.join(privateDir, "codes.csv"), csv(rows));

const isRepoSite = outDir === path.join(ROOT, "docs");
const scanned = isRepoSite ? filesGitWouldPublish(ROOT) : await filesUnder(outDir);
const examplePath = path.join(ROOT, "people.example.json");
const exampleNeedles = new Set(existsSync(examplePath) ? needlesFor(JSON.parse(await readFile(examplePath, "utf8")).people) : []);
const needles = inputPath === examplePath ? needlesFor(people) : needlesFor(people).filter((n) => !exampleNeedles.has(n));
const leaks = await findLeaks(scanned, needles);
if (leaks.length) {
  fail(`Possible private data in publishable files:\n${leaks.map((l) => `  "${l.needle}" in ${path.relative(ROOT, l.file)}`).join("\n")}`);
}

console.log(`\nDone. Codes and links: ${path.relative(process.cwd(), path.join(privateDir, "codes.csv"))}`);
