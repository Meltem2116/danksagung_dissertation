// Shared by the browser (app.js) and the build/test scripts in tools/.
// Only Web Crypto and TextEncoder are used, so this file runs unchanged in both.

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 10;

const subtle = globalThis.crypto.subtle;
const utf8 = new TextEncoder();
const ID_INFO = utf8.encode("danksagung/id/v1");
const KEY_INFO = utf8.encode("danksagung/key/v1");
const IV_LENGTH = 12;

export function normalizeCode(input) {
  return String(input)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "");
}

export function isWellFormed(code) {
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

export function formatCode(code) {
  return normalizeCode(code).replace(/(.{5})(?=.)/g, "$1-");
}

export function generateCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => ALPHABET[b & 31]).join("");
}

export function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex) {
  return new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
}

export async function deriveKeys(code, params) {
  const password = await subtle.importKey("raw", utf8.encode(normalizeCode(code)), "PBKDF2", false, ["deriveBits"]);
  const master = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(params.salt), iterations: params.iterations },
    password,
    256
  );
  const hkdf = await subtle.importKey("raw", master, "HKDF", false, ["deriveBits", "deriveKey"]);
  const hkdfParams = (info) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info });
  const id = toHex(await subtle.deriveBits(hkdfParams(ID_INFO), hkdf, 128));
  const key = await subtle.deriveKey(hkdfParams(KEY_INFO), hkdf, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { id, key };
}

export async function encrypt(key, id, plaintext) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = typeof plaintext === "string" ? utf8.encode(plaintext) : plaintext;
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(id) }, key, data);
  const out = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ciphertext), IV_LENGTH);
  return out;
}

export async function decrypt(key, id, bytes) {
  const buf = new Uint8Array(bytes);
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: buf.subarray(0, IV_LENGTH), additionalData: utf8.encode(id) },
    key,
    buf.subarray(IV_LENGTH)
  );
  return new TextDecoder().decode(plaintext);
}

// Returns the decoded payload, or null for any failure (unknown code, missing file, wrong key).
export async function openMessage(input, params, fetchBytes) {
  const code = normalizeCode(input);
  if (!isWellFormed(code)) return null;
  try {
    const { id, key } = await deriveKeys(code, params);
    const bytes = await fetchBytes(id);
    if (!bytes) return null;
    return JSON.parse(await decrypt(key, id, bytes));
  } catch {
    return null;
  }
}
