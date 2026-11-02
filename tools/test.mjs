#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, readdir, mkdtemp, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeCode, formatCode, generateCode, isWellFormed, openMessage, deriveKeys } from "../docs/assets/crypto.js";
import { needlesFor, findLeaks, filesUnder, filesGitWouldPublish } from "./privacy.mjs";
import { markdownToHtml } from "./markdown.mjs";
import { ROOT, ITERATIONS } from "./config.mjs";

const examplePath = path.join(ROOT, "people.example.json");
const examples = JSON.parse(await readFile(examplePath, "utf8"));
const work = await mkdtemp(path.join(tmpdir(), "danksagung-test-"));
const site = path.join(work, "site");
const privateDir = path.join(work, "private");

execFileSync(process.execPath, [path.join(ROOT, "tools/build.mjs"), "--input", examplePath, "--out", site, "--private", privateDir], { stdio: "pipe" });

const params = JSON.parse(await readFile(path.join(site, "data/params.json"), "utf8"));
const fetchFrom = (dir) => async (id) => {
  const file = path.join(dir, "data", `${id}.bin`);
  return existsSync(file) ? readFile(file) : null;
};

test("normalization", () => {
  assert.equal(normalizeCode(" 4k7qm-xpa2r "), "4K7QMXPA2R");
  assert.equal(normalizeCode("4K7QM XPA2R"), "4K7QMXPA2R");
  assert.equal(normalizeCode("ｈ８ｗ３ｔ—９ｚｎｃ６"), "H8W3T9ZNC6");
  assert.equal(normalizeCode("o0 Il1"), "00111");
  assert.equal(formatCode("4k7qmxpa2r"), "4K7QM-XPA2R");
  assert.equal(isWellFormed("4K7QMXPA2R"), true);
  assert.equal(isWellFormed("4K7QMXPA2"), false);
  assert.equal(isWellFormed("4K7QMXPA2U"), false);
});

test("generated codes are well-formed and varied", () => {
  const codes = new Set(Array.from({ length: 500 }, generateCode));
  assert.equal(codes.size, 500);
  for (const c of codes) assert.ok(isWellFormed(c), c);
});

test("kdf parameters", () => {
  assert.ok(params.iterations >= ITERATIONS);
  assert.match(params.salt, /^[0-9a-f]{32}$/);
});

test("every example decrypts with the browser logic, typed sloppily", async () => {
  for (const person of examples.people) {
    const variants = [person.code, person.code.toLowerCase(), ` ${person.code.replace("-", " ")} `, person.code.replace(/0/g, "o").replace(/1/g, "l")];
    for (const typed of variants) {
      const payload = await openMessage(typed, params, fetchFrom(site));
      assert.ok(payload, `${person.name}: ${typed}`);
      assert.equal(payload.greeting, person.greeting);
      assert.equal(payload.lang, person.lang);
      assert.equal(payload.signature.text, examples.signature);
    }
  }
  const anna = await openMessage("4K7QM-XPA2R", params, fetchFrom(site));
  assert.match(anna.html, /<strong>Geduld<\/strong>/);
  assert.match(anna.photo.src, /^data:image\/svg\+xml;base64,/);
  const max = await openMessage("H8W3T-9ZNC6", params, fetchFrom(site));
  assert.match(max.html, /<li>for the coffee<\/li>/);
  assert.match(max.html, /<blockquote>/);
});

test("wrong, malformed and tampered input all fail the same way", async () => {
  assert.equal(await openMessage(generateCode(), params, fetchFrom(site)), null);
  assert.equal(await openMessage("short", params, fetchFrom(site)), null);
  assert.equal(await openMessage("", params, fetchFrom(site)), null);

  const { id } = await deriveKeys("4K7QM-XPA2R", params);
  const file = path.join(site, "data", `${id}.bin`);
  const bytes = await readFile(file);
  bytes[bytes.length - 40] ^= 1;
  await writeFile(file, bytes);
  assert.equal(await openMessage("4K7QM-XPA2R", params, fetchFrom(site)), null);
});

test("file sizes are padded to fixed buckets", async () => {
  const buckets = new Set([4096, 16384, 65536, 262144, 1048576, 4194304, 16777216]);
  for (const f of (await readdir(path.join(site, "data"))).filter((f) => f.endsWith(".bin"))) {
    const { size } = await stat(path.join(site, "data", f));
    assert.ok(buckets.has(size - 12 - 16), `${f}: ${size}`);
  }
});

test("markdown escapes html", () => {
  assert.equal(markdownToHtml("<script>x</script>"), "<p>&lt;script&gt;x&lt;/script&gt;</p>");
  assert.equal(markdownToHtml("a\nb\n\nc"), "<p>a<br>b</p>\n<p>c</p>");
});

test("built site contains no example names or codes in plain text", async () => {
  assert.deepEqual(await findLeaks(await filesUnder(site), needlesFor(examples.people)), []);
});

const realPath = path.join(ROOT, "people.json");
if (existsSync(realPath)) {
  const real = JSON.parse(await readFile(realPath, "utf8"));
  const exampleNeedles = new Set(needlesFor(examples.people));

  test("people.json data is not in any publishable file", async () => {
    const needles = needlesFor(real.people).filter((n) => !exampleNeedles.has(n));
    assert.deepEqual(await findLeaks(filesGitWouldPublish(ROOT), needles), []);
  });

  test("docs/data is up to date with people.json", async () => {
    const docs = path.join(ROOT, "docs");
    const docsParams = JSON.parse(await readFile(path.join(docs, "data/params.json"), "utf8"));
    for (const person of real.people.filter((p) => p.code)) {
      const payload = await openMessage(person.code, docsParams, fetchFrom(docs));
      assert.ok(payload, `${person.name} does not open on the site; run: node tools/build.mjs`);
      assert.equal(payload.greeting, person.greeting || "", `${person.name} is outdated; run: node tools/build.mjs`);
    }
  });
}

test.after(() => rm(work, { recursive: true, force: true }));
