// worker/index.js
// One Worker handles everything: serves the static site AND the /api/* routes.
// GROQ_API_KEY never reaches the browser — it's only read here, server-side.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const HUNDO_SYSTEM_PROMPT = `You are Hundo — a sharp, funny, straight-talking AI built for a close friend group.
You're loyal to the group, quick-witted, and conversational. Keep replies concise unless someone asks for depth.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleChat(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { message, userId, history = [] } = await request.json();
    if (!message || !userId) {
      return json({ error: "message and userId are required" }, 400);
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

    const messages = [
      { role: "system", content: HUNDO_SYSTEM_PROMPT + memoryBlock },
      ...history,
      { role: "user", content: message },
    ];

    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
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
