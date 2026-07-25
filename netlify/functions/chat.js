// netlify/functions/chat.js
// Runs on Netlify's server only. GROQ_API_KEY never reaches the browser.

const { getStore } = require("@netlify/blobs");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const HUNDO_SYSTEM_PROMPT = `You are Hundo — a sharp, funny, straight-talking AI built for a close friend group.
You're loyal to the group, quick-witted, and conversational. Keep replies concise unless someone asks for depth.`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const { message, userId, history = [] } = JSON.parse(event.body);

    if (!message || !userId) {
      return { statusCode: 400, body: JSON.stringify({ error: "message and userId are required" }) };
    }

    const key = userId.trim().toLowerCase();

    // Pull this friend's saved memory
    const store = getStore("hundo-memory");
    const existing = await store.get(key, { type: "json" });
    const memory = existing?.facts || [];

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
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant", // Updated to instant model
        messages,
        temperature: 0.8,
        max_tokens: 1024,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("Groq error:", groqRes.status, errText);
      return {
        statusCode: groqRes.status,
        body: JSON.stringify({ error: "Hundo hit a snag talking to Groq.", details: errText }),
      };
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content ?? "...";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: err.message }) };
  }
};
