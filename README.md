# Hundo

A friend-group chat app powered by Groq (`llama-3.1-8b-instant`), with real per-friend memory.
Hosted on **Cloudflare Pages** — the Groq key stays server-side and is never exposed to the browser.

## What's in this repo
- `index.html` — the app (sidebar, welcome screen, chat, memory panel)
- `functions/api/chat.js` — talks to Groq using your secret key (server-side only, Cloudflare Pages Function)
- `functions/api/memory.js` — lets the Memory panel read/add/delete facts, stored in Cloudflare KV
- `wrangler.toml` — optional config, only needed for local dev with `wrangler pages dev`
- `package.json` — project metadata (no dependencies needed — functions use the built-in `fetch`)
- `.env.example` — shows the one env var needed, without a real key

## How memory works
Each friend's facts are stored in a **Cloudflare KV** namespace, keyed by their name (lowercased).
The **Memory** button in the sidebar opens a panel where anyone can see and add/remove what Hundo
knows about them. Every chat message automatically pulls that friend's memory into Hundo's prompt
before replying.

## Setup (all done in the browser — no CLI required)

### 1. Push to GitHub
```
git init
git add .
git commit -m "Hundo on Cloudflare"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/hundo.git
git push -u origin main
```

### 2. Create the Cloudflare Pages project
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages → Connect to Git**
2. Pick your `hundo` repo
3. Build settings: leave build command blank, output directory `/`
4. **Save and Deploy** — you'll get a live site at `hundo.pages.dev` (or similar)

### 3. Create a KV namespace (replaces Netlify Blobs)
1. Cloudflare dashboard → **Storage & Databases → KV → Create a namespace** (e.g. name it `hundo-memory`)
2. Go to your Pages project → **Settings → Functions → KV namespace bindings → Add binding**
3. Variable name: `HUNDO_MEMORY` → select the namespace you just created
4. Save (this redeploys your Functions with access to the binding)

### 4. Add your Groq key
1. Pages project → **Settings → Environment variables → Add variable**
2. Name: `GROQ_API_KEY`, Value: your key from console.groq.com/keys, Type: **Secret**
3. Save (this triggers a redeploy so the function can read it)

### 5. Test
Open your `*.pages.dev` URL, enter a name, chat, then click **Memory** in the sidebar and add a
fact — send a new message and Hundo should reference it. Check the browser's Network tab to
confirm only `/api/chat` and `/api/memory` requests appear — never Groq's URL or key.

### 6. Connect HUNDOLLM.com
1. Pages project → **Custom domains → Set up a custom domain** → enter `hundollm.com`
2. Follow the on-screen DNS instructions (simplest if the domain's nameservers are already on
   Cloudflare — otherwise it'll give you a CNAME to add at your registrar)
3. SSL auto-issues once DNS connects, usually within minutes to a couple hours

## Notes
- Groq free tier has no dollar limit to configure — it's capped by rate limits instead
  (console.groq.com/settings/limits).
- Never commit a real `.env` file — the key only ever lives in Cloudflare's environment variables.
- This version drops the Netlify-specific `@netlify/blobs` dependency and the old
  "ask Groq via the memory endpoint" branch from `memory.js` (chat.js already handles all chatting;
  the frontend never called that branch).
