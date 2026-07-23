# The AI Gazette — generation pipeline

Every Sunday a GitHub Action reads the two AI newsletters from Gmail, has an LLM
write a weekly edition, and commits the result as JSON. The static page at
[`/news/`](../news/index.html) renders that JSON — the frontend never calls the LLM.

```
Gmail (IMAP)  →  clean HTML  →  Groq (editor-in-chief)  →  validate  →  news/latest.json + archive  →  commit/push
```

## Files

| File | Role |
|------|------|
| `config.mjs` | newsletter sources, categories, model, limits |
| `lib/mail.mjs` | fetch the latest issue of each newsletter over IMAP |
| `lib/clean.mjs` | HTML → clean text + article links (drops footers/tracking) |
| `lib/llm.mjs` | Groq call + editor-in-chief prompt (JSON mode) |
| `lib/schema.mjs` | validate/normalise the edition; refuse broken output |
| `lib/io.mjs` | write `latest.json`, the dated archive, and `archive.json` |
| `generate-news.mjs` | orchestrator (`--dry-run` supported) |

## Required GitHub secrets

Add these under **Settings → Secrets and variables → Actions**:

| Secret | What it is |
|--------|------------|
| `GMAIL_USER` | your Gmail address, e.g. `royerjulien64@gmail.com` |
| `GMAIL_APP_PASSWORD` | a 16-char **App Password** (not your login password) |
| `GROQ_API_KEY` | already used by the chatbot serverless function |

### Creating the Gmail App Password

1. Enable 2-Step Verification on the Google account.
2. Go to <https://myaccount.google.com/apppasswords>.
3. Create a password (name it e.g. "AI Gazette"), copy the 16 characters.
4. Paste it into the `GMAIL_APP_PASSWORD` secret (spaces are fine to remove).

No OAuth, no token that expires — the App Password keeps working until revoked.

## Run it locally

```bash
npm install
export GMAIL_USER="you@gmail.com"
export GMAIL_APP_PASSWORD="xxxxxxxxxxxxxxxx"
export GROQ_API_KEY="gsk_..."

# Full pipeline, but DON'T touch news/ — writes scripts/edition.local.json:
npm run news:dry

# Preview the generated edition in the real page:
cp scripts/edition.local.json news/latest.json
python3 -m http.server 8000   # then open http://localhost:8000/news/

# Real run (overwrites news/latest.json + writes the dated archive):
npm run news
```

## Tuning

- **Model** — `openai/gpt-oss-120b` by default; override with `GROQ_MODEL=...`.
- **Sender matching** — edit `SOURCES[].from` in `config.mjs` if a newsletter
  changes its sending address (IMAP `FROM` is a substring match).
- **Lookback / size / article count** — see `SETTINGS` in `config.mjs`.

## Safety

If fetching, generation, or validation fails, the script exits non-zero and the
commit step finds no change, so **the last good edition stays live**.
