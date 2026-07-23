// scripts/lib/schema.mjs — validate & normalise the LLM output before publishing.
// If the edition can't be trusted, we throw and the caller keeps the previous one.

import { CATEGORIES, SETTINGS } from "../config.mjs";

function isHttpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

function countWords(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

function estimateReadMin(words) {
  return `${Math.max(1, Math.round(words / 200))} min`;
}

function nearestCategory(cat) {
  if (!cat) return "Research";
  const exact = CATEGORIES.find((c) => c.toLowerCase() === String(cat).toLowerCase());
  if (exact) return exact;
  const partial = CATEGORIES.find(
    (c) => c.toLowerCase().includes(String(cat).toLowerCase()) ||
           String(cat).toLowerCase().includes(c.toLowerCase())
  );
  return partial || "Research";
}

function toISODate(d) {
  const dt = d ? new Date(d) : new Date();
  return (isNaN(dt) ? new Date() : dt).toISOString().slice(0, 10);
}

function longDate(iso) {
  const dt = new Date(iso + "T00:00:00Z");
  return dt.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

/**
 * @param {any} raw  parsed LLM JSON
 * @param {{homepages: Record<string,string>}} ctx  fallback homepages by source_name
 * @returns {object} normalised edition
 * @throws if the edition is unusable
 */
export function validateEdition(raw, ctx = { homepages: {} }) {
  if (!raw || typeof raw !== "object") throw new Error("Edition is not an object.");
  if (!Array.isArray(raw.articles)) throw new Error("Edition has no articles array.");

  const edition = toISODate(raw.edition);
  const articles = [];

  for (const a of raw.articles) {
    if (!a || typeof a !== "object") continue;
    const headline = String(a.headline || "").trim();
    const summary = String(a.summary || "").trim();
    const why = String(a.why_it_matters || "").trim();
    if (!headline || !summary || !why) continue; // why_it_matters is mandatory

    const source_name = String(a.source_name || "").trim() || "Newsletter";
    let source = String(a.source || "").trim();
    if (!isHttpUrl(source)) source = ctx.homepages[source_name] || "";

    let importance = Number(a.importance);
    if (!isFinite(importance)) importance = 5;
    importance = Math.min(10, Math.max(0, importance));

    const words = countWords(summary) + countWords(why);

    articles.push({
      headline: headline.slice(0, 140),
      summary,
      why_it_matters: why,
      category: nearestCategory(a.category),
      importance: Math.round(importance * 10) / 10,
      reading_time: String(a.reading_time || "").trim() || estimateReadMin(words),
      source,
      source_name,
    });
  }

  articles.sort((x, y) => y.importance - x.importance);

  if (articles.length < SETTINGS.minArticles) {
    throw new Error(`Too few valid articles (${articles.length} < ${SETTINGS.minArticles}).`);
  }
  const trimmed = articles.slice(0, SETTINGS.maxArticles);

  const totalWords = trimmed.reduce(
    (n, a) => n + countWords(a.summary) + countWords(a.why_it_matters), 0
  );

  return {
    edition,
    edition_label: longDate(edition),
    reading_time: String(raw.reading_time || "").trim() || estimateReadMin(totalWords),
    intro: String(raw.intro || "").trim(),
    generated_at: new Date().toISOString(),
    articles: trimmed,
  };
}
