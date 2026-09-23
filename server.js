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
// 1b) HANDWRITTEN NUMBER READER — POST /api/read-number { imageBase64 }
// ============================================================
app.post('/api/read-number', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'AI key not configured on server' });
  const { imageBase64 } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });
  const prompt = `You are reading a package in an Israeli warehouse. There may be a HANDWRITTEN number (marker/pen) and/or printed numbers on it. Read the numbers carefully - handwriting can be messy.
Return ONLY compact JSON, no markdown:
{"primary":"the most likely intended shipment/order number","all_numbers":["every distinct number you can read"],"handwritten":"the handwritten number if any else empty","confidence":0.0-1.0}
Digits only for number fields. If unsure between digits (1 vs 7), put most likely in primary and alternates in all_numbers.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: prompt }
        ]}]
      })
    });
    const data = await r.json();
    if (data.error) return res.status(502).json({ error: data.error.message || 'AI error' });
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    let parsed; try { parsed = JSON.parse(text.replace(/```json|```/g,'').trim()); }
    catch { return res.status(502).json({ error: 'unparseable', raw: text.slice(0,200) }); }
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
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

// 1c) SMART LOOKUP — GET /api/lionwheel/find/:number
app.get('/api/lionwheel/find/:number', async (req, res) => {
  if (!LIONWHEEL_KEY) return res.status(200).json({ found: false, reason: 'no_token', number: req.params.number });
  try {
    const url = `${LIONWHEEL_BASE}/api/v1/tasks/by_order_id/${encodeURIComponent(req.params.number)}?key=${LIONWHEEL_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(200).json({ found: false, status: r.status, number: req.params.number });
    const task = await r.json();
    res.json({ found: true, task });
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

// 1d) DIAGNOSTIC — GET /api/lionwheel/raw?path=routes&date=2026-01-01
//     Safely GET any LionWheel endpoint to inspect the real data shape. Read-only.
app.get('/api/lionwheel/raw', async (req, res) => {
  if (!LIONWHEEL_KEY) return res.status(500).json({ error: 'LionWheel key not configured' });
  const path = (req.query.path || '').replace(/^\/+/, '');
  if (!path) return res.status(400).json({ error: 'path query param required, e.g. ?path=routes' });
  // pass through any extra query params (except path) to LionWheel
  const extra = Object.entries(req.query).filter(([k]) => k !== 'path')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const sep = path.includes('?') ? '&' : '?';
  const url = `${LIONWHEEL_BASE}/${path}${sep}key=${LIONWHEEL_KEY}${extra ? '&' + extra : ''}`;
  try {
    const r = await fetch(url);
    const text = await r.text();
    res.status(200).json({ status: r.status, url: url.replace(LIONWHEEL_KEY, 'KEY'), body: safeJson(text) });
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});
function safeJson(t){ try { return JSON.parse(t); } catch { return t.slice(0, 2000); } }

// LOOKUP a task by scanned barcode/code -> returns city + task id
app.get('/api/lw/lookup/:code', async (req, res) => {
  if (!LIONWHEEL_KEY) return res.status(500).json({ error: 'no_key' });
  try {
    const url = `${LIONWHEEL_BASE}/tasks?key=${LIONWHEEL_KEY}&code=${encodeURIComponent(req.params.code)}`;
    const r = await fetch(url);
    const data = await r.json();
    const t = (data.tasks || [])[0];
    if (!t) return res.json({ found: false });
    res.json({ found: true, id: t.id, code: t.code, city: t.destination_city,
      recipient: t.destination_recipient_name, order: t.wp_order_id, status: t.status });
  } catch (e) { res.status(500).json({ error: String(e.message||e) }); }
});

// UPDATE a task status (received / loaded). Tries the documented update path.
app.post('/api/lw/status/:id', async (req, res) => {
  if (!LIONWHEEL_KEY) return res.status(500).json({ error: 'no_key' });
  const status = (req.body && req.body.status) || '';
  try {
    const url = `${LIONWHEEL_BASE}/tasks/${encodeURIComponent(req.params.id)}/update?key=${LIONWHEEL_KEY}`;
    const r = await fetch(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
    const text = await r.text();
    res.status(200).json({ sent_status: status, lw_status: r.status, lw_body: safeJson(text) });
  } catch (e) { res.status(500).json({ error: String(e.message||e) }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('SortCart backend listening on ' + PORT));
