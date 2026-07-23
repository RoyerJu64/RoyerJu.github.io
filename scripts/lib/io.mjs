// scripts/lib/io.mjs — write the edition to disk: latest.json + dated archive +
// a small archive index the frontend can later use for a "past editions" page.

import { promises as fs } from "node:fs";
import path from "node:path";

export async function writeEdition(edition, newsDir) {
  const [year, month, day] = edition.edition.split("-");
  const archiveRel = path.posix.join(year, month, `${day}.json`);
  const archiveDir = path.join(newsDir, year, month);

  await fs.mkdir(archiveDir, { recursive: true });

  const json = JSON.stringify(edition, null, 2) + "\n";
  const latestPath = path.join(newsDir, "latest.json");
  const archivePath = path.join(newsDir, archiveRel);

  await fs.writeFile(archivePath, json);
  await fs.writeFile(latestPath, json);

  await updateArchiveIndex(newsDir, {
    edition: edition.edition,
    edition_label: edition.edition_label,
    reading_time: edition.reading_time,
    articles: edition.articles.length,
    path: archiveRel,
  });

  return { latestPath, archivePath };
}

async function updateArchiveIndex(newsDir, entry) {
  const indexPath = path.join(newsDir, "archive.json");
  let list = [];
  try {
    list = JSON.parse(await fs.readFile(indexPath, "utf8"));
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  list = list.filter((e) => e.edition !== entry.edition);
  list.push(entry);
  list.sort((a, b) => (a.edition < b.edition ? 1 : -1)); // newest first
  await fs.writeFile(indexPath, JSON.stringify(list, null, 2) + "\n");
}
