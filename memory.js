// netlify/functions/memory.js
// Handles reading, adding, and deleting memory facts for one friend.
// GET    ?userId=alex              -> { facts: [...] }
// POST   { userId, fact }          -> adds one fact
// DELETE { userId, index }         -> removes the fact at that index

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const store = getStore("hundo-memory");

  try {
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

    if (event.httpMethod === "POST") {
      const { userId, fact } = JSON.parse(event.body);
      if (!userId || !fact) {
        return { statusCode: 400, body: JSON.stringify({ error: "userId and fact required" }) };
      }
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
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
};
