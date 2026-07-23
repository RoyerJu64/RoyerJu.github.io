// scripts/lib/clean.mjs — turn a newsletter's raw HTML into clean reading text
// plus a de-duplicated list of article links, dropping boilerplate/footers.

import { parse } from "node-html-parser";

const NOISE_TAGS = ["script", "style", "head", "title", "img", "svg", "noscript"];

// Lines matching these are treated as footer / boilerplate and dropped.
const BOILERPLATE = [
  /unsubscribe/i,
  /manage (your )?(preferences|subscription)/i,
  /update your profile/i,
  /view (this|in) (email )?(in )?(your )?browser/i,
  /you('| a)?re receiving this/i,
  /©\s*\d{4}/i,
  /all rights reserved/i,
  /privacy policy/i,
  /terms of (use|service)/i,
  /add us to your address book/i,
  /forward (this|to a friend)/i,
  /sent to\b/i,
];

// Links we never want to treat as "article sources".
const LINK_BLOCK = [
  /unsubscribe/i, /mailto:/i, /list-manage|campaign-archive|mailchi/i,
  /\/preferences|\/profile|\/account/i, /twitter\.com\/intent|x\.com\/intent/i,
  /facebook\.com\/sharer|linkedin\.com\/shareArticle/i,
];

function stripTracking(rawUrl) {
  try {
    const u = new URL(rawUrl);
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_|^mc_|^mkt_|^ck_|^_hs|^ref$|^source$/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

function isArticleLink(href) {
  if (!href) return false;
  if (!/^https?:\/\//i.test(href)) return false;
  return !LINK_BLOCK.some((re) => re.test(href));
}

/**
 * @param {string} html
 * @param {string} fallbackText
 * @returns {{ text: string, links: Array<{text:string, href:string}> }}
 */
export function cleanEmail(html, fallbackText = "") {
  if (!html || !html.trim()) {
    return { text: normalizeText(fallbackText), links: [] };
  }

  const root = parse(html, { comment: false });
  root.querySelectorAll(NOISE_TAGS.join(",")).forEach((n) => n.remove());

  // Collect candidate article links before flattening.
  const seen = new Set();
  const links = [];
  for (const a of root.querySelectorAll("a")) {
    const href = stripTracking((a.getAttribute("href") || "").trim());
    const text = a.text.replace(/\s+/g, " ").trim();
    if (!isArticleLink(href) || seen.has(href)) continue;
    seen.add(href);
    links.push({ text, href });
  }

  const text = normalizeText(root.structuredText || root.text || fallbackText);
  return { text, links: links.slice(0, 60) };
}

function normalizeText(raw) {
  const lines = String(raw || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .filter((l) => !BOILERPLATE.some((re) => re.test(l)));

  // Collapse 3+ blank runs, join.
  const out = [];
  for (const l of lines) {
    if (out.length && out[out.length - 1] === l) continue; // dedupe repeated lines
    out.push(l);
  }
  return out.join("\n").trim();
}

/** Build the compact text block handed to the LLM for one newsletter. */
export function toLLMBlock(newsletter, maxChars) {
  const header = `### ${newsletter.source_name} — "${newsletter.subject || ""}" (${newsletter.date || "date unknown"})`;
  let body = newsletter.cleaned?.text || "";
  if (maxChars && body.length > maxChars) body = body.slice(0, maxChars) + "\n[...truncated...]";

  const links = (newsletter.cleaned?.links || [])
    .filter((l) => l.text && l.href)
    .slice(0, 40)
    .map((l) => `- ${l.text} → ${l.href}`)
    .join("\n");

  return `${header}\n\n${body}\n\nLINKS (${newsletter.source_name}):\n${links || "(none extracted)"}`;
}
