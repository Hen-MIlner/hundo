// functions/api/memory.js
// Handles reading, adding, and deleting per-friend memory facts.
// GET    ?userId=alex     -> { facts: [...] }
// POST   { userId, fact } -> adds one fact
// DELETE { userId, index} -> removes the fact at that index
//
// Requires a KV namespace bound as HUNDO_MEMORY
// (Pages → Settings → Functions → KV namespace bindings → variable name "HUNDO_MEMORY")

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const userId = (url.searchParams.get("userId") || "").trim().toLowerCase();

  if (!userId) return json({ error: "userId required" }, 400);

  try {
    const existing = await env.HUNDO_MEMORY.get(userId, { type: "json" });
    return json({ facts: existing?.facts || [] });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error", details: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { userId, fact } = await request.json();
    if (!userId || !fact) {
      return json({ error: "userId and fact required" }, 400);
    }

    const key = userId.trim().toLowerCase();
    const existing = await env.HUNDO_MEMORY.get(key, { type: "json" });
    const facts = existing?.facts || [];
    facts.push(fact.trim());
    await env.HUNDO_MEMORY.put(key, JSON.stringify({ facts }));

    return json({ facts });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error", details: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  try {
    const { userId, index } = await request.json();
    if (!userId || index === undefined) {
      return json({ error: "userId and index required" }, 400);
    }

    const key = userId.trim().toLowerCase();
    const existing = await env.HUNDO_MEMORY.get(key, { type: "json" });
    const facts = existing?.facts || [];
    facts.splice(index, 1);
    await env.HUNDO_MEMORY.put(key, JSON.stringify({ facts }));

    return json({ facts });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error", details: err.message }, 500);
  }
}
