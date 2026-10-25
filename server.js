const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';

const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing Supabase env vars'); process.exit(1); }
if (!PASSWORD_HASH || !TOKEN_SECRET) { console.error('Missing auth env vars'); process.exit(1); }

function verifyPassword(pw) {
  const [salt, hash] = PASSWORD_HASH.split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
}

const validTokens = new Map();
const loginAttempts = new Map();

function makeToken() {
  const t = crypto.randomBytes(32).toString('hex');
  validTokens.set(t, Date.now() + 1000 * 60 * 60);
  return t;
}

function auth(req, res) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const exp = validTokens.get(t);
  if (!exp || Date.now() > exp) { validTokens.delete(t); res.statusCode = 401; res.end('Unauthorized'); return false; }
  return true;
}

async function sb(path, opts = {}) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) throw new Error((data && data.message) || r.statusText);
  return data;
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || 'localhost';
  const parsedUrl = new URL(req.url, `http://${host}`);
  const pathname = parsedUrl.pathname;

  const origin = req.headers.origin;
  const allowed = [
    'http://localhost:3000',
    'https://ownerkebabbaro.a72830750.workers.dev',
    'https://customer-kebab.a72830750.workers.dev',
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
    process.env.CUSTOMER_FRONTEND_URL,
    process.env.OWNER_FRONTEND_URL
  ].map(x => x && x.trim().replace(/\/$/, '')).filter(Boolean);

  if (origin && (allowed.includes(origin) || true)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  try {
    if (pathname === '/api/login' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        try {
          const { username, password } = JSON.parse(body);
          if (username === 'alikebab' && verifyPassword(password)) {
            const token = makeToken();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ token }));
          } else { res.statusCode = 401; res.end('Unauthorized'); }
        } catch (e) { res.statusCode = 400; res.end('Bad request'); }
      });
      return;
    }

    if (pathname === '/api/logout' && req.method === 'POST') {
      const h = req.headers.authorization || '';
      const t = h.startsWith('Bearer ') ? h.slice(7) : '';
      validTokens.delete(t);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname === '/api/orders' && req.method === 'GET') {
      if (!auth(req, res)) return;
      const data = await sb('orders?select=*&order=created_at.desc');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data || []));
      return;
    }

    if (pathname === '/api/orders' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c); req.on('end', async () => {
        try {
          const order = JSON.parse(body);
          const inserted = await sb('orders', { method: 'POST', body: JSON.stringify(order), headers: { Prefer: 'return=representation' } });
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 201;
          res.end(JSON.stringify(Array.isArray(inserted) ? inserted[0] : inserted));
        } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: String(e.message || e) })); }
      });
      return;
    }

    const m = pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (m && req.method === 'PATCH') {
      if (!auth(req, res)) return;
      let body = ''; req.on('data', c => body += c); req.on('end', async () => {
        try {
          const { status } = JSON.parse(body);
          await sb('orders?id=eq.' + encodeURIComponent(m[1]), { method: 'PATCH', body: JSON.stringify({ status }), headers: { Prefer: 'return=representation' } });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) { res.statusCode = 400; res.end('Bad request'); }
      });
      return;
    }

    if (pathname === '/api/orders' && req.method === 'DELETE') {
      if (!auth(req, res)) return;
      await sb('orders', { method: 'DELETE' });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404; res.end('Not found');
  } catch (e) {
    console.error(e);
    res.statusCode = 500; res.end('Server error');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
