// scripts/lib/llm.mjs — the "editor-in-chief": turns cleaned newsletters into a
// structured weekly edition (JSON) via Groq's OpenAI-compatible chat API.

import { CATEGORIES } from "../config.mjs";
import { toLLMBlock } from "./clean.mjs";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM = `You are the editor-in-chief of "The AI Gazette", a weekly newspaper about artificial intelligence.
You are given the raw text of one or more AI newsletters from the past week. Your job is to produce ONE weekly edition.

EDITORIAL RULES:
- Write in clear, professional, neutral English. No hype, no sensationalism, no emojis.
- Read across all newsletters, identify the genuinely important stories, and MERGE duplicates that cover the same event into a single article.
- Keep only stories with real impact. Discard ads, course promos, job posts, event invites, and filler.
- Do NOT invent facts, numbers, companies, or product names. Only use what is supported by the provided text. If a detail is unclear, stay general rather than guessing.
- For each story, pick the most relevant source URL from the provided LINKS. If none fits, use the newsletter homepage. Never fabricate a URL.

OUTPUT — return a SINGLE JSON object, no markdown, with exactly this shape:
{
  "edition": "YYYY-MM-DD",              // the Sunday of this edition (today if unknown)
  "reading_time": "N min",             // total, honest estimate for the whole edition
  "intro": "...",                       // 1-2 sentence editor's standfirst summarising the week
  "articles": [
    {
      "headline": "...",               // punchy, journalistic, <= 90 characters
      "summary": "...",                // ~80 words, informative, self-contained
      "why_it_matters": "...",         // 1-2 sentences on the significance. MANDATORY.
      "category": "...",               // EXACTLY one of the allowed categories
      "importance": 8.4,                // float 0-10, higher = bigger story; spread the values
      "reading_time": "N min",         // per-article estimate
      "source": "https://...",         // real URL from the input
      "source_name": "The Batch" | "Import AI"
    }
  ]
}

CONSTRAINTS:
- Between 5 and 10 articles, ordered by importance (highest first).
- Allowed categories: ${CATEGORIES.join(", ")}.
- "why_it_matters" must never be empty — it is the heart of the paper.
- Return ONLY the JSON object.`;

export async function generateEdition(newsletters, { apiKey, model, maxCharsPerNewsletter }) {
  const blocks = newsletters
    .filter((n) => n.found && n.cleaned && n.cleaned.text)
    .map((n) => toLLMBlock(n, maxCharsPerNewsletter));

  if (!blocks.length) throw new Error("No newsletter content to summarise.");

  const userContent =
    `Here are this week's newsletters. Produce the weekly edition of The AI Gazette as specified.\n\n` +
    blocks.join("\n\n----------------------------------------\n\n");

  const payload = {
    model,
    temperature: 0.4,
    max_tokens: 6000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userContent },
    ],
  };

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Groq error ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return parseJson(content);
}

function parseJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    // Be tolerant if the model wraps JSON in prose or fences.
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("LLM did not return valid JSON.");
  }
}
