#!/usr/bin/env node
// scripts/generate-news.mjs — orchestrates one weekly edition of The AI Gazette.
//
//   node scripts/generate-news.mjs            # fetch → clean → LLM → validate → write news/
//   node scripts/generate-news.mjs --dry-run  # do everything except overwrite news/;
//                                             #   writes scripts/edition.local.json instead
//
// Environment: GMAIL_USER, GMAIL_APP_PASSWORD, GROQ_API_KEY (see scripts/README.md).
// On ANY failure the process exits non-zero and leaves the existing edition untouched.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SOURCES, SETTINGS } from "./config.mjs";
import { fetchNewsletters } from "./lib/mail.mjs";
import { cleanEmail } from "./lib/clean.mjs";
import { generateEdition } from "./lib/llm.mjs";
import { validateEdition } from "./lib/schema.mjs";
import { writeEdition } from "./lib/io.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const user = requireEnv("GMAIL_USER");
  const pass = requireEnv("GMAIL_APP_PASSWORD");
  const apiKey = requireEnv("GROQ_API_KEY");

  console.log(`→ Fetching newsletters (last ${SETTINGS.lookbackDays} days)…`);
  const fetched = await fetchNewsletters(SOURCES, {
    user, pass, mailbox: SETTINGS.mailbox, lookbackDays: SETTINGS.lookbackDays,
  });

  for (const n of fetched) {
    if (n.found) {
      n.cleaned = cleanEmail(n.html, n.text);
      console.log(`  ✓ ${n.source_name}: "${n.subject}" — ${n.cleaned.text.length} chars, ${n.cleaned.links.length} links`);
    } else {
      console.log(`  ✗ ${n.source_name}: no issue found${n.error ? ` (${n.error})` : ""}`);
    }
  }

  if (!fetched.some((n) => n.found)) {
    throw new Error("No newsletters found in the lookback window — aborting.");
  }

  console.log(`→ Generating edition with ${SETTINGS.model}…`);
  const raw = await generateEdition(fetched, {
    apiKey, model: SETTINGS.model, maxCharsPerNewsletter: SETTINGS.maxCharsPerNewsletter,
  });

  const homepages = Object.fromEntries(SOURCES.map((s) => [s.source_name, s.homepage]));
  const edition = validateEdition(raw, { homepages });
  console.log(`  ✓ Edition ${edition.edition} — ${edition.articles.length} articles, ${edition.reading_time}`);
  console.log(`    Lead: "${edition.articles[0].headline}" (${edition.articles[0].importance})`);

  if (DRY_RUN) {
    const out = path.join(__dirname, "edition.local.json");
    await fs.writeFile(out, JSON.stringify(edition, null, 2) + "\n");
    console.log(`\n[dry-run] Wrote ${path.relative(repoRoot, out)} — news/ left untouched.`);
    console.log(`[dry-run] Preview it with:  cp ${path.relative(repoRoot, out)} news/latest.json`);
    return;
  }

  const newsDir = path.join(repoRoot, SETTINGS.newsDir);
  const { latestPath, archivePath } = await writeEdition(edition, newsDir);
  console.log(`  ✓ Wrote ${path.relative(repoRoot, latestPath)} and ${path.relative(repoRoot, archivePath)}`);
}

main().catch((err) => {
  console.error(`\n✗ Generation failed: ${err.message}`);
  console.error("  The previous edition (news/latest.json) has been left unchanged.");
  process.exit(1);
});
