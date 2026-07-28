// functions/api/chat.js
// Cloudflare Pages Function. Runs server-side only — GROQ_API_KEY never reaches the browser.
// Requires:
//   - Environment variable GROQ_API_KEY (set as a Secret in the Pages dashboard)
//   - KV namespace bound as HUNDO_MEMORY (Pages → Settings → Functions → KV namespace bindings)

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const HUNDO_SYSTEM_PROMPT = `You are Hundo — a sharp, funny, straight-talking AI built for a close friend group.
You're loyal to the group, quick-witted, and conversational. Keep replies concise unless someone asks for depth.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message, userId, history = [] } = await request.json();

    if (!message || !userId) {
      return json({ error: "message and userId are required" }, 400);
    }

    const key = userId.trim().toLowerCase();

    // Pull this friend's saved memory from KV
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
      console.error("Groq error:", groqRes.status, errText);
      return json(
        { error: "Hundo hit a snag talking to Groq.", details: errText },
        groqRes.status
      );
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content ?? "...";

    return json({ reply });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error", details: err.message }, 500);
  }
}

// Any method other than POST is not supported here
export async function onRequestGet() {
  return json({ error: "Method not allowed" }, 405);
}
