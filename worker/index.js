// worker/index.js
// One Worker handles everything: serves the static site AND the /api/* routes.
// GROQ_API_KEY never reaches the browser — it's only read here, server-side.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Text-only chat uses the fast/cheap model. Anything with an image switches
// to a vision-capable model. Groq's lineup changes fairly often — worth
// checking https://console.groq.com/docs/vision if this ever 404s.
const TEXT_MODEL = "llama-3.1-8b-instant";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const HUNDO_SYSTEM_PROMPT = `You are Hundo — a sharp, funny, straight-talking AI built for a close friend group.
You're loyal to the group, quick-witted, and conversational. Keep replies concise unless someone asks for depth.
If you're given content pulled from a web page, treat it as reference material — read it, then answer naturally.`;

// --- Link reading ---------------------------------------------------------
// Hundo can "read" a plain public URL (e.g. a news article) that a user
// pastes into the chat. This only works for pages that don't require a
// login and don't block bots/serve their content via client-side JS.
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const MAX_URLS_PER_MESSAGE = 2;
const MAX_PAGE_CHARS = 6000;
const FETCH_TIMEOUT_MS = 8000;

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

async function fetchPageText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HundoBot/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return { url, error: `Page returned ${res.status}` };

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return { url, error: "That link isn't a readable HTML page" };
    }

    const html = await res.text();
    const text = stripHtml(html).slice(0, MAX_PAGE_CHARS);
    if (!text) return { url, error: "Couldn't find readable text on that page" };
    return { url, text };
  } catch (err) {
    clearTimeout(timer);
    return { url, error: "Couldn't fetch that page (it may require login or block bots)" };
  }
}

async function buildUrlContext(message) {
  const urls = [...new Set(message.match(URL_REGEX) || [])].slice(0, MAX_URLS_PER_MESSAGE);
  if (urls.length === 0) return "";

  const results = await Promise.all(urls.map(fetchPageText));
  const blocks = results.map((r) =>
    r.error ? `[Could not read ${r.url}: ${r.error}]` : `[Content from ${r.url}]\n${r.text}`
  );
  return "\n\n" + blocks.join("\n\n");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleChat(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { message, userId, history = [], image } = await request.json();
    if ((!message && !image) || !userId) {
      return json({ error: "message (or image) and userId are required" }, 400);
    }

    // Rough ceiling on the base64 payload so one giant upload can't blow out
    // the request to Groq. ~6MB of raw image data, base64-inflated.
    if (image && typeof image === "string" && image.length > 8_000_000) {
      return json({ error: "That image is too large — try one under 6MB." }, 400);
    }

    const key = userId.trim().toLowerCase();

    let memory = [];
    if (env.HUNDO_MEMORY) {
      const existing = await env.HUNDO_MEMORY.get(key, { type: "json" });
      memory = existing?.facts || [];
    }

    const memoryBlock = memory.length
      ? `\n\nWhat you know about ${userId}:\n- ${memory.join("\n- ")}`
      : "";

    const urlContext = message ? await buildUrlContext(message) : "";
    const textWithContext = (message || "") + urlContext;

    const userContent = image
      ? [
          { type: "text", text: textWithContext || "What's in this image?" },
          { type: "image_url", image_url: { url: image } },
        ]
      : textWithContext;

    const messages = [
      { role: "system", content: HUNDO_SYSTEM_PROMPT + memoryBlock },
      ...history,
      { role: "user", content: userContent },
    ];

    const model = image ? VISION_MODEL : TEXT_MODEL;

    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.8,
        max_tokens: 1024,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      return json({ error: "Hundo hit a snag talking to Groq.", details: errText }, groqRes.status);
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content ?? "...";
    return json({ reply });
  } catch (err) {
    return json({ error: "Server error", details: err.message }, 500);
  }
}

async function handleMemory(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const userId = (url.searchParams.get("userId") || "").trim().toLowerCase();
    if (!userId) return json({ error: "userId required" }, 400);
    const existing = await env.HUNDO_MEMORY.get(userId, { type: "json" });
    return json({ facts: existing?.facts || [] });
  }

  if (request.method === "POST") {
    const { userId, fact } = await request.json();
    if (!userId || !fact) return json({ error: "userId and fact required" }, 400);
    const key = userId.trim().toLowerCase();
    const existing = await env.HUNDO_MEMORY.get(key, { type: "json" });
    const facts = existing?.facts || [];
    facts.push(fact.trim());
    await env.HUNDO_MEMORY.put(key, JSON.stringify({ facts }));
    return json({ facts });
  }

  if (request.method === "DELETE") {
    const { userId, index } = await request.json();
    if (!userId || index === undefined) return json({ error: "userId and index required" }, 400);
    const key = userId.trim().toLowerCase();
    const existing = await env.HUNDO_MEMORY.get(key, { type: "json" });
    const facts = existing?.facts || [];
    facts.splice(index, 1);
    await env.HUNDO_MEMORY.put(key, JSON.stringify({ facts }));
    return json({ facts });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleChats(request, env) {
  const url = new URL(request.url);
  const MAX_CHATS = 50; // keep KV usage bounded
  const keyFor = (userId) => "chats:" + userId.trim().toLowerCase();

  if (request.method === "GET") {
    const userId = (url.searchParams.get("userId") || "").trim().toLowerCase();
    if (!userId) return json({ error: "userId required" }, 400);
    const existing = await env.HUNDO_MEMORY.get(keyFor(userId), { type: "json" });
    return json({ chats: existing?.chats || [] });
  }

  if (request.method === "POST") {
    const { userId, chatId, title, messages } = await request.json();
    if (!userId || !chatId) return json({ error: "userId and chatId required" }, 400);

    const key = keyFor(userId);
    const existing = await env.HUNDO_MEMORY.get(key, { type: "json" });
    let chats = existing?.chats || [];

    const now = Date.now();
    const idx = chats.findIndex(c => c.id === chatId);
    const updatedChat = { id: chatId, title: title || "New chat", messages: messages || [], updatedAt: now };

    if (idx >= 0) chats[idx] = updatedChat;
    else chats.push(updatedChat);

    // Keep only the most recent MAX_CHATS
    chats = chats.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);

    await env.HUNDO_MEMORY.put(key, JSON.stringify({ chats }));
    return json({ chats });
  }

  if (request.method === "DELETE") {
    const { userId, chatId } = await request.json();
    if (!userId || !chatId) return json({ error: "userId and chatId required" }, 400);

    const key = keyFor(userId);
    const existing = await env.HUNDO_MEMORY.get(key, { type: "json" });
    let chats = existing?.chats || [];
    chats = chats.filter(c => c.id !== chatId);

    await env.HUNDO_MEMORY.put(key, JSON.stringify({ chats }));
    return json({ chats });
  }

  return json({ error: "Method not allowed" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") return handleChat(request, env);
    if (url.pathname === "/api/memory") return handleMemory(request, env);
    if (url.pathname === "/api/chats") return handleChats(request, env);

    // Everything else falls through to the static site in /public
    return env.ASSETS.fetch(request);
  },
};
