// netlify/functions/memory.js
// Handles reading, adding, deleting memory facts, AND asking Groq AI.
// GET    ?userId=alex             -> { facts: [...] }
// POST   { userId, fact }          -> adds one fact
// DELETE { userId, index }         -> removes the fact at that index
// PUT    { userId, message }       -> queries Groq (llama-3.1-8b-instant) using saved facts

const { getStore } = require("@netlify/blobs");
const Groq = require("groq-sdk");

// Initialize Groq SDK (automatically uses GROQ_API_KEY from environment variables)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.handler = async (event) => {
  const store = getStore("hundo-memory");

  try {
    // ----------------------------------------------------
    // GET: Retrieve saved facts for a user
    // ----------------------------------------------------
    if (event.httpMethod === "GET") {
      const userId = (event.queryStringParameters?.userId || "").trim().toLowerCase();
      if (!userId) return { statusCode: 400, body: JSON.stringify({ error: "userId required" }) };

      const existing = await store.get(userId, { type: "json" });
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts: existing?.facts || [] }),
      };
    }

    // ----------------------------------------------------
    // POST: Add a new fact OR process a chat prompt
    // ----------------------------------------------------
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body);

      // Case A: Adding a new fact
      if (body.fact) {
        const { userId, fact } = body;
        if (!userId) return { statusCode: 400, body: JSON.stringify({ error: "userId required" }) };

        const key = userId.trim().toLowerCase();
        const existing = await store.get(key, { type: "json" });
        const facts = existing?.facts || [];
        facts.push(fact.trim());
        await store.setJSON(key, { facts });

        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facts }),
        };
      }

      // Case B: Sending a prompt/message to Groq AI
      if (body.message) {
        const { userId, message } = body;
        if (!userId) return { statusCode: 400, body: JSON.stringify({ error: "userId required" }) };

        const key = userId.trim().toLowerCase();
        const existing = await store.get(key, { type: "json" });
        const facts = existing?.facts || [];

        // Build system prompt using stored facts
        const systemPrompt = facts.length > 0
          ? `You are a helpful AI assistant. Here are things you know about this user:\n- ${facts.join("\n- ")}`
          : "You are a helpful AI assistant.";

        // Call Groq API with llama-3.1-8b-instant
        const completion = await groq.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
        });

        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reply: completion.choices[0].message.content,
            factsUsed: facts,
          }),
        };
      }

      return { statusCode: 400, body: JSON.stringify({ error: "Must provide either 'fact' or 'message'" }) };
    }

    // ----------------------------------------------------
    // DELETE: Delete a saved fact by index
    // ----------------------------------------------------
    if (event.httpMethod === "DELETE") {
      const { userId, index } = JSON.parse(event.body);
      if (!userId || index === undefined) {
        return { statusCode: 400, body: JSON.stringify({ error: "userId and index required" }) };
      }
      const key = userId.trim().toLowerCase();
      const existing = await store.get(key, { type: "json" });
      const facts = existing?.facts || [];
      facts.splice(index, 1);
      await store.setJSON(key, { facts });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts }),
      };
    }

    return { statusCode: 405, body: "Method not allowed" };
  } catch (err) {
    console.error("Function Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: err.message }) };
  }
};
