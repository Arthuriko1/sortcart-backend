// SortCart backend — a tiny secure relay.
// It holds the secret keys (AI + LionWheel) so the browser app never sees them.
// Deploy free on Render.com as a Web Service. See README for click-by-click steps.

const express = require('express');
const app = express();
app.use(express.json({ limit: '12mb' })); // labels are images -> allow big bodies

// ---- CORS: allow your hosted app (and localhost) to call this server ----
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*')
  .split(',').map(s => s.trim());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED.includes('*') || (origin && ALLOWED.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- Secrets come from environment variables (never in code) ----
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY || '';
const LIONWHEEL_KEY   = process.env.LIONWHEEL_KEY || '';       // added later
const LIONWHEEL_BASE  = process.env.LIONWHEEL_BASE || 'https://members.lionwheel.com';

// ---- Health check (open this URL in a browser to confirm it's alive) ----
app.get('/', (req, res) => res.json({ ok: true, service: 'sortcart-backend', ai: !!ANTHROPIC_KEY, lionwheel: !!LIONWHEEL_KEY }));

// ============================================================
// 1) AI LABEL READER  — POST /api/read-label  { imageBase64 }
//    Returns extracted fields as JSON. Key stays server-side.
// ============================================================
app.post('/api/read-label', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'AI key not configured on server' });
  const { imageBase64 } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  const prompt = `You are the AI clerk of a warehouse sorting system in Israel, reading a LionWheel shipping label (Hebrew). The image may be rotated or upside-down — read it anyway.
Extract these fields:
- barcode (the long digits under the barcode)
- scan_code (the letter/number code above the barcode)
- order_id (מספר הזמנה)
- region (אזור חלוקה — the delivery region/zone)
- city (עיר)
- address (כתובת)
- customer (שם מקבל / שם לקוח)
- location (מיקום)
Respond ONLY with a compact JSON object, no markdown:
{"barcode":"","scan_code":"","order_id":"","region":"","city":"","address":"","customer":"","location":""}
Empty string for anything unreadable. Keep values short.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });
    const data = await r.json();
    if (data.error) return res.status(502).json({ error: data.error.message || 'AI error' });
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    let parsed;
    try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch { return res.status(502).json({ error: 'AI returned unparseable output', raw: text.slice(0, 300) }); }
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ============================================================
// 2) LIONWHEEL PROXY (used once you have a token)
//    GET  /api/lionwheel/task/:orderId   -> look up a task
//    PUT  /api/lionwheel/task/:taskId/status { status }  -> update status
//    The token stays server-side; the app never sees it.
// ============================================================
app.get('/api/lionwheel/task/:orderId', async (req, res) => {
  if (!LIONWHEEL_KEY) return res.status(500).json({ error: 'LionWheel key not configured' });
  try {
    const url = `${LIONWHEEL_BASE}/api/v1/tasks/by_order_id/${encodeURIComponent(req.params.orderId)}?key=${LIONWHEEL_KEY}`;
    const r = await fetch(url);
    res.status(r.status).json(await r.json());
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

app.put('/api/lionwheel/task/:taskId/status', async (req, res) => {
  if (!LIONWHEEL_KEY) return res.status(500).json({ error: 'LionWheel key not configured' });
  const { status } = req.body || {};
  try {
    const url = `${LIONWHEEL_BASE}/api/v1/tasks/${encodeURIComponent(req.params.taskId)}/update?key=${LIONWHEEL_KEY}`;
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    res.status(r.status).json(await r.json());
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('SortCart backend listening on ' + PORT));
