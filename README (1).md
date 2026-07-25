# Hundo

A friend-group chat app powered by Groq's `llama-3.3-70b-versatile`, with real per-friend memory.

## What's in this repo
- `index.html` — the app (sidebar, welcome screen, chat, memory panel)
- `netlify/functions/chat.js` — talks to Groq using your secret key (server-side only)
- `netlify/functions/memory.js` — lets the Memory panel read/add/delete facts, stored in Netlify Blobs
- `netlify.toml` / `package.json` — Netlify + dependency config
- `.env.example` — shows the one env var needed, without a real key

## How memory works
Netlify Blobs is a simple key-value store built into Netlify — no extra account needed.
Each friend's facts are stored under their name (lowercased). The **Memory** button in the
sidebar opens a panel where anyone can see and add/remove what Hundo knows about them.
Every chat message automatically pulls that friend's memory into Hundo's prompt before replying.

## Setup

### 1. Push to GitHub
```
git init
git add .
git commit -m "Hundo v1"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/hundo.git
git push -u origin main
```

### 2. Connect to Netlify
1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**
2. Pick your `hundo` repo → default build settings are fine → Deploy

### 3. Add your Groq key
1. Netlify → **Site settings → Environment variables → Add a variable**
2. Key: `GROQ_API_KEY`, Value: your key from console.groq.com/keys
3. Redeploy so the function picks it up

Netlify Blobs needs no setup or key — it's automatic on any Netlify site.

### 4. Test
Open your `*.netlify.app` URL, enter a name, chat, then click **Memory** in the sidebar and add a fact — send a new message and Hundo should reference it.

### 5. Connect HUNDOLLM.com
1. Buy the domain (Namecheap, Cloudflare, etc.)
2. Netlify → **Domain management → Add a domain** → `hundollm.com`
3. Follow the DNS instructions Netlify gives you at your registrar
4. SSL auto-issues once DNS connects

## Notes
- Groq free tier has no dollar limit to configure — it's capped by rate limits instead (console.groq.com/settings/limits).
- Never commit a real `.env` file — the key only ever lives in Netlify's environment variables.
