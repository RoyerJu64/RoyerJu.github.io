// scripts/lib/llm.mjs — the "editor-in-chief", in two stages to fit Groq's
// free-tier token-per-minute budget (8000 TPM):
//   1) CONDENSE each newsletter on its own into a compact digest of items
//   2) COMPOSE the final weekly edition from those digests
// Calls are spaced out so the rolling 60s token window never exceeds the limit.

import { CATEGORIES } from "../config.mjs";
import { toLLMBlock } from "./clean.mjs";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const PACE_MS = 65_000; // > 60s between calls so previous tokens age out of the TPM window

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONDENSE_SYSTEM = `You extract the notable AI news items from ONE newsletter issue.
Read the text and the LINKS list, then output a SINGLE JSON object:
{ "items": [ { "title": "...", "summary": "<= 60 words", "why": "<= 25 words, why it matters",
               "category": "one of: ${CATEGORIES.join(", ")}",
               "source": "the best matching URL from LINKS, or ''",
               "source_name": "the newsletter's name" } ] }
Rules: 6-12 items. Only real facts from the text — never invent names, numbers, or URLs.
Skip ads, course/product promotions, job posts and event invites. Return ONLY the JSON object.`;

const COMPOSE_SYSTEM = `You are the editor-in-chief of "The AI Gazette", a weekly newspaper about artificial intelligence.
You receive pre-extracted news items from this week's newsletters. Produce ONE weekly edition.

EDITORIAL RULES:
- Clear, professional, neutral English. No hype, no sensationalism, no emojis.
- MERGE items from different newsletters that cover the same event into a single article.
- Keep only stories with real impact; drop filler.
- Do NOT invent facts, numbers, companies or URLs. Use the provided source URLs; if an item has none, use "".
- Rank by importance and spread the scores.

OUTPUT — a SINGLE JSON object, no markdown:
{
  "edition": "YYYY-MM-DD",
  "reading_time": "N min",
  "intro": "1-2 sentence editor's standfirst summarising the week",
  "articles": [
    {
      "headline": "punchy, <= 90 chars",
      "summary": "~80 words, informative, self-contained",
      "why_it_matters": "1-2 sentences. MANDATORY, never empty",
      "category": "exactly one of: ${CATEGORIES.join(", ")}",
      "importance": 8.4,
      "reading_time": "N min",
      "source": "https://... (real URL from input, or '')",
      "source_name": "The Batch | Import AI"
    }
  ]
}
Between 5 and 10 articles, highest importance first. Return ONLY the JSON object.`;

async function groqJson({ apiKey, model, system, user, maxTokens }) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Groq error ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = await res.json();
  return parseJson(data?.choices?.[0]?.message?.content || "");
}

async function condense(newsletter, { apiKey, model, maxChars }) {
  const user = toLLMBlock(newsletter, maxChars);
  const out = await groqJson({
    apiKey, model, system: CONDENSE_SYSTEM, user, maxTokens: 1800,
  });
  const items = Array.isArray(out?.items) ? out.items : [];
  // Tag every item with the true source name so COMPOSE can't mislabel it.
  for (const it of items) it.source_name = newsletter.source_name;
  return { source_name: newsletter.source_name, items };
}

export async function generateEdition(newsletters, { apiKey, model, maxCharsPerNewsletter }) {
  const found = newsletters.filter((n) => n.found && n.cleaned && n.cleaned.text);
  if (!found.length) throw new Error("No newsletter content to summarise.");

  // Stage 1 — condense each newsletter separately, paced under the TPM budget.
  const digests = [];
  for (let i = 0; i < found.length; i++) {
    if (i > 0) await sleep(PACE_MS);
    console.log(`  · condensing ${found[i].source_name}…`);
    const d = await condense(found[i], { apiKey, model, maxChars: maxCharsPerNewsletter });
    console.log(`    → ${d.items.length} items`);
    digests.push(d);
  }

  // Stage 2 — compose the final edition from the compact digests.
  await sleep(PACE_MS);
  console.log(`  · composing the edition…`);
  const user =
    `Here are this week's extracted items. Produce the weekly edition of The AI Gazette.\n\n` +
    JSON.stringify({ digests }, null, 2);

  return groqJson({ apiKey, model, system: COMPOSE_SYSTEM, user, maxTokens: 3000 });
}

function parseJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("LLM did not return valid JSON.");
  }
}
