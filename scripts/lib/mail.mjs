// scripts/lib/mail.mjs — fetch the latest issue of each newsletter over IMAP.
// Uses a Gmail App Password (no OAuth, no token expiry). Requires 2FA enabled
// on the account and an app password generated at https://myaccount.google.com/apppasswords

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

/**
 * Resolve the "All Mail" folder regardless of the account language.
 * Gmail localizes folder names ("[Gmail]/All Mail", "[Gmail]/Tous les messages", …)
 * but always exposes the special-use flag \All. Fall back to INBOX.
 */
async function resolveAllMailPath(client, preferred) {
  try {
    const boxes = await client.list();
    const all = boxes.find(
      (b) => b.specialUse === "\\All" || (b.flags && b.flags.has && b.flags.has("\\All"))
    );
    if (all?.path) return all.path;

    const names = new Set(boxes.map((b) => b.path));
    for (const cand of [preferred, "[Gmail]/All Mail", "[Google Mail]/All Mail"]) {
      if (names.has(cand)) return cand;
    }
  } catch {
    /* fall through to INBOX */
  }
  return "INBOX";
}

/**
 * @param {Array<{id:string, source_name:string, homepage:string, from:string}>} sources
 * @param {{user:string, pass:string, mailbox:string, lookbackDays:number}} opts
 * @returns {Promise<Array<{id, source_name, homepage, found:boolean, subject?, date?, html?, text?}>>}
 */
export async function fetchNewsletters(sources, { user, pass, mailbox, lookbackDays }) {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const results = [];

  try {
    await client.connect();
  } catch (e) {
    const detail = e?.responseText || e?.response || e?.message || String(e);
    throw new Error(
      `IMAP login failed (${detail}). Check: 2FA enabled, an *App Password* (not the account password), ` +
      `and IMAP turned on in Gmail → Settings → Forwarding and POP/IMAP.`
    );
  }

  try {
    const path = await resolveAllMailPath(client, mailbox);
    console.log(`  · using mailbox: ${path}`);
    const lock = await client.getMailboxLock(path);
    try {
      const since = new Date(Date.now() - lookbackDays * 864e5);
      for (const src of sources) {
        try {
          const uids = await client.search({ from: src.from, since }, { uid: true });
          if (!uids || !uids.length) {
            results.push({ ...src, found: false });
            continue;
          }
          const uid = uids[uids.length - 1]; // most recent match
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          const parsed = await simpleParser(msg.source);
          results.push({
            ...src,
            found: true,
            subject: parsed.subject || "",
            date: parsed.date ? parsed.date.toISOString() : null,
            html: parsed.html || parsed.textAsHtml || "",
            text: parsed.text || "",
          });
        } catch (e) {
          results.push({ ...src, found: false, error: e?.responseText || String(e).slice(0, 200) });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return results;
}
