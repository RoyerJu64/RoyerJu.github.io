// scripts/config.mjs — pipeline configuration for The AI Gazette.
// Adjust the `from` matchers here if a newsletter changes its sending address.
// IMAP FROM search is a substring match, so a fragment like "importai" is enough.

export const SOURCES = [
  {
    id: "the-batch",
    source_name: "The Batch",
    homepage: "https://www.deeplearning.ai/the-batch/",
    from: "thebatch@deeplearning.ai", // The Batch newsletter (DeepLearning.AI)
  },
  {
    id: "import-ai",
    source_name: "Import AI",
    homepage: "https://importai.substack.com/",
    from: "importai@substack.com", // Jack Clark's Import AI (Substack)
  },
];

export const CATEGORIES = [
  "LLM", "Agents", "Research", "Open Source",
  "Robotics", "Vision", "Regulation", "Business", "Startups",
];

export const SETTINGS = {
  mailbox: "[Gmail]/All Mail", // search archived mail too, not just INBOX
  lookbackDays: 10,
  maxCharsPerNewsletter: 20000, // per-newsletter trim to keep each condense call under 8000 TPM
  model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  minArticles: 5,
  maxArticles: 10,
  newsDir: "news",
};
