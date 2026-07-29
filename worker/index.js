// Worker: Serves API routes (/api/*) and falls through to static assets.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const HUNDO_SYSTEM_PROMPT = `You are Hundo — a sharp, funny, straight-talking AI built for a close friend group.
You're loyal to the group, quick-witted, and conversational. Keep replies concise unless someone asks for depth.`;

// CORS & Helper Utilities
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

// Memory Helper (KV Access)
async function getMemory(kv, key) {
  if (!kv) return [];
  const record = await kv.get(key, { type: "json" });
  return record?.facts || [];
}

async function saveMemory(kv, key, facts) {
  if (!kv) throw new Error("HUNDO_MEMORY KV namespace is missing.");
  await kv.put(key, JSON.stringify({ facts }));
}

// Route Handlers
async function handleChat(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { message, userId, history = [] } = await request.json();
    if (!message?.trim() || !userId?.trim()) {
      return json({ error: "message and userId are required" }, 400);
    }

    const key = userId.trim().toLowerCase();
    const memory = await getMemory(env.HUNDO_MEMORY, key);

    const memoryBlock = memory.length
      ? `\n\nWhat you know about ${userId}:\n- ${memory.join("\n- ")}`
      : "";

    const messages = [
      { role: "system", content: HUNDO_SYSTEM_PROMPT + memoryBlock },
      ...history,
      { role: "user", content: message },
    ];

    if (!env.GROQ_API_KEY) {
      return json({ error: "Server configuration issue: Missing GROQ_API_KEY." }, 500);
    }

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

    const facts = await getMemory(env.HUNDO_MEMORY, userId);
    return json({ facts });
  }

  if (request.method === "POST") {
    const { userId, fact } = await request.json();
    if (!userId?.trim() || !fact?.trim()) {
      return json({ error: "userId and fact required" }, 400);
    }

    const key = userId.trim().toLowerCase();
    const facts = await getMemory(env.HUNDO_MEMORY, key);
    facts.push(fact.trim());

    await saveMemory(env.HUNDO_MEMORY, key, facts);
    return json({ facts });
  }

  if (request.method === "DELETE") {
    const { userId, index } = await request.json();
    if (!userId?.trim() || typeof index !== "number" || index < 0) {
      return json({ error: "Valid userId and numerical index required" }, 400);
    }

    const key = userId.trim().toLowerCase();
    const facts = await getMemory(env.HUNDO_MEMORY, key);

    if (index >= facts.length) {
      return json({ error: "Index out of bounds" }, 400);
    }

    facts.splice(index, 1);
    await saveMemory(env.HUNDO_MEMORY, key, facts);
    return json({ facts });
  }

  return json({ error: "Method not allowed" }, 405);
}

// Main Fetch Handler
export default {
  async fetch(request, env) {
    // Handle CORS Preflight Requests
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/chat") return handleChat(request, env);
    if (url.pathname === "/api/memory") return handleMemory(request, env);

    // Serve static frontend assets
    return env.ASSETS.fetch(request);
  },
};
