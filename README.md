# SortCart Backend — deploy guide (free, ~20 minutes)

This is the small secure server that holds your secret keys (AI + LionWheel) so the
web app never exposes them. You'll deploy it free on **Render.com**.

---

## What you'll end up with
A URL like `https://sortcart-backend.onrender.com` that the SortCart app calls for:
- **AI label reading** (region / city / address extraction)
- **LionWheel sync** (once you add the token)
…with all secrets safe on the server.

---

## Step 1 — put this code on GitHub (5 min)
1. Create a new **GitHub repo**, name it `sortcart-backend`, Public or Private (either works).
2. Upload these three files into it: `server.js`, `package.json`, `README.md`.
   (Web upload is fine: "Add file → Upload files" → drag them in → Commit.)

## Step 2 — create the Render service (5 min)
1. Go to **render.com** → sign up (free; "Sign in with GitHub" is easiest).
2. Click **New +** → **Web Service**.
3. Connect your GitHub and pick the `sortcart-backend` repo.
4. Render auto-detects Node. Confirm these settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** **Free**
5. Click **Create Web Service**. Wait ~2–3 min for the first deploy.

## Step 3 — add your secret keys (3 min)
In the service page → **Environment** (left menu) → **Add Environment Variable**:

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic API key (from console.anthropic.com) |
| `ALLOWED_ORIGINS` | your app URL, e.g. `https://yourname.github.io` |
| `LIONWHEEL_KEY` | *(leave empty for now — add when you get the token)* |

Click **Save Changes** — Render redeploys automatically.

> Getting an Anthropic key: console.anthropic.com → sign up → Billing (add a small
> amount, e.g. $5 — label reads cost a fraction of a cent each) → API Keys → Create.

## Step 4 — test it (1 min)
Open your Render URL in a browser (e.g. `https://sortcart-backend.onrender.com/`).
You should see: `{"ok":true,"service":"sortcart-backend","ai":true,...}`
If `ai:true` → the AI key is loaded correctly. 🎉

## Step 5 — tell SortCart the backend URL
In the SortCart app (a new field in Setup), paste your Render URL.
From then on, the hosted app reads labels with AI and (later) syncs to LionWheel.

---

## Notes
- **Free tier sleeps** after 15 min idle; the first request after that takes ~30s to wake.
  Fine for a pilot. A paid tier ($7/mo) stays always-on when you're ready.
- **Adding LionWheel later:** just set the `LIONWHEEL_KEY` env var and redeploy. The
  proxy endpoints are already built in.
- **Security:** keys live only in Render's environment variables, never in the app or
  the GitHub repo. This is the standard, safe way.
