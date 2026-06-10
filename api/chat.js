// api/chat.js — Vercel Serverless Function (Node.js runtime)
// Secure proxy to the Groq API. Holds the API key server-side (never exposed to the browser).
// Loads Julien's profile + routes the relevant full project report into context on demand.

import { CONTEXT } from "./context.js";

// ---- Config ----
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
const MAX_QUESTION_LEN = 2000;

// ---- Report routing: which full report to inject based on the question ----
const REPORTS = [
  {
    key: "report_dg_inria",
    keywords: ["dg", "galerkin", "pyramid", "inria", "geos", "mesh", "bergot",
               "bernstein", "finite element", "acoustic", "wave", "makutu", "numerical method"],
  },
  {
    key: "report_gpu_particles",
    keywords: ["gpu", "cuda", "particle", "verlet", "simulation", "fluid",
               "kernel", "shared memory", "hash grid", "fps", "opengl", "speedup"],
  },
  {
    key: "report_tiny_diffusion",
    keywords: ["diffusion", "ddpm", "profiling", "profiler", "cprofile",
               "hyperfine", "bottleneck", "denoiser", "tiny-diffusion", "pytorch profiler"],
  },
  {
    key: "report_rl_sailing",
    keywords: ["sailing", "dqn", "q-learning", "q-network", "wind", "reinforcement",
               "navigation", "agent", "tacking", "reward", "episode"],
  },
];

function pickReports(question) {
  const q = question.toLowerCase();
  const hits = [];
  for (const r of REPORTS) {
    if (r.keywords.some((k) => q.includes(k))) hits.push(r.key);
  }
  // Inject at most one full report to stay well within free-tier token limits.
  return hits.slice(0, 1);
}

function buildSystemPrompt(question) {
  const profile = CONTEXT.profile || "";
  const reportKeys = pickReports(question);
  let extra = "";
  for (const k of reportKeys) {
    const txt = CONTEXT[k];
    if (txt) extra += `\n\n${txt}`;
  }

  return `You are "Ask Julien", a helpful assistant embedded on Julien Royer's personal portfolio website. You answer questions from visitors (recruiters, collaborators, the curious) about Julien — his background, skills, experience, education, and projects.

RULES:
- Always answer in English, regardless of the language of the question.
- Be concise, professional, and friendly. Prefer 2-5 sentences unless asked for detail.
- Only use the information provided below. Do NOT invent facts, dates, numbers, employers, or technologies. If something is not in the context, say you don't have that information and suggest contacting Julien directly.
- The KYM project at Thales is CONFIDENTIAL. You may share only the short summary in the profile. If asked for more detail (architecture internals, code, data, specifics beyond the summary), politely explain it is confidential and cannot be shared.
- Speak about Julien in the third person ("Julien did..."), not as if you were him.
- If asked something unrelated to Julien (general knowledge, coding help, etc.), gently redirect: you're here to talk about Julien and his work.
- When relevant, point visitors to the project reports, GitHub, or the contact section of the site.

=== JULIEN'S PROFILE ===
${profile}${extra}`;
}

export default async function handler(req, res) {
  // CORS — allow your GitHub Pages / custom domain to call this function.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ error: "Server not configured." });

  // Parse body (Vercel usually parses JSON automatically; guard just in case).
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const question = (lastUser?.content || "").toString().slice(0, MAX_QUESTION_LEN);
  if (!question.trim()) return res.status(400).json({ error: "Empty question." });

  // Keep only the recent turns to bound token usage (last 6 messages).
  const history = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_QUESTION_LEN) }));

  const payload = {
    model: MODEL,
    temperature: 0.3,
    max_tokens: 600,
    messages: [
      { role: "system", content: buildSystemPrompt(question) },
      ...history,
    ],
  };

  try {
    const r = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "Upstream error", detail: detail.slice(0, 500) });
    }

    const data = await r.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't generate a response.";
    return res.status(200).json({ answer });
  } catch (e) {
    return res.status(500).json({ error: "Request failed", detail: String(e).slice(0, 300) });
  }
}