import { openMessage, normalizeCode } from "./crypto.js";
import { TEXT } from "./text.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
const input = $("code");
const button = $("submit");
const status = $("status");
const welcome = $("welcome");
const message = $("message");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let lang = initialLang();
let paramsPromise;

function initialLang() {
  try {
    const saved = localStorage.getItem("lang");
    if (saved in TEXT) return saved;
  } catch {}
  const langs = (navigator.languages || [navigator.language || ""]).map((l) => l.toLowerCase());
  return langs.find((l) => /^(de|en)\b/.test(l))?.startsWith("en") ? "en" : "de";
}

function t(key) {
  return TEXT[lang][key];
}

function applyLang() {
  document.documentElement.lang = lang;
  document.title = t("pageTitle");
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = t(el.dataset.t);
  const toggle = $("lang");
  toggle.textContent = t("switchTo");
  toggle.setAttribute("aria-label", t("switchLabel"));
  toggle.lang = lang === "de" ? "en" : "de";
  if (status.dataset.key) status.textContent = t(status.dataset.key);
}

function setStatus(key, isError = false) {
  status.dataset.key = key || "";
  status.textContent = key ? t(key) : "";
  status.classList.toggle("error", isError);
  input.setAttribute("aria-invalid", String(isError));
}

function loadParams() {
  paramsPromise ??= fetch("data/params.json", { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error("params");
    return r.json();
  });
  return paramsPromise.catch((e) => {
    paramsPromise = undefined;
    throw e;
  });
}

async function fetchBytes(id) {
  const res = await fetch(`data/${id}.bin`, { cache: "no-cache" });
  return res.ok ? res.arrayBuffer() : null;
}

function swap(from, to) {
  const done = () => {
    from.hidden = true;
    from.classList.remove("leaving");
    to.hidden = false;
    to.classList.add("entering");
    requestAnimationFrame(() => requestAnimationFrame(() => to.classList.remove("entering")));
    window.scrollTo(0, 0);
    to.focus({ preventScroll: true });
  };
  if (reduceMotion.matches) return done();
  from.classList.add("leaving");
  setTimeout(done, 450);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function render(payload) {
  const parts = [];
  if (payload.greeting) parts.push(el("h2", { text: payload.greeting }));
  if (payload.photo) {
    parts.push(el("figure", { class: "photo" }, [el("img", { src: payload.photo.src, alt: payload.photo.alt || "" })]));
  }
  parts.push(el("div", { class: "body", html: payload.html || "" }));
  const sig = payload.signature;
  if (sig?.image) parts.push(el("p", { class: "signature" }, [el("img", { src: sig.image, alt: sig.text || "" })]));
  else if (sig?.text) parts.push(el("p", { class: "signature", text: sig.text }));

  const back = el("button", { type: "button", class: "back", "data-t": "back", text: t("back") });
  back.addEventListener("click", () => {
    swap(message, welcome);
    setTimeout(() => message.replaceChildren(), 500);
    input.value = "";
    setStatus(null);
  });

  const article = el("div", { class: "letter" }, parts);
  if (payload.lang) article.lang = payload.lang;
  message.replaceChildren(article, el("p", { class: "back-row" }, [back]));
  swap(welcome, message);
}

async function submit(event) {
  event?.preventDefault();
  if (button.disabled) return;
  if (!normalizeCode(input.value)) return input.focus();
  button.disabled = true;
  setStatus("working");
  form.setAttribute("aria-busy", "true");
  let payload = null;
  try {
    payload = await openMessage(input.value, await loadParams(), fetchBytes);
  } catch {}
  form.removeAttribute("aria-busy");
  button.disabled = false;
  if (payload) {
    setStatus(null);
    render(payload);
  } else {
    setStatus("noMatch", true);
    input.focus();
    input.select();
  }
}

$("lang").addEventListener("click", () => {
  lang = lang === "de" ? "en" : "de";
  try {
    localStorage.setItem("lang", lang);
  } catch {}
  applyLang();
});

applyLang();

if (!globalThis.crypto?.subtle) {
  button.disabled = true;
  input.disabled = true;
  setStatus("unsupported", true);
} else {
  form.addEventListener("submit", submit);
  const fromLink = decodeURIComponent(location.hash.slice(1));
  if (fromLink) {
    history.replaceState(null, "", location.pathname + location.search);
    input.value = fromLink;
    submit();
  }
}

document.body.classList.add("ready");
