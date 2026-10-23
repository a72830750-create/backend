const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Load .env if present
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
} catch(e) {}

const ROOT = __dirname;
const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

if (!PASSWORD_HASH) {
  console.warn('⚠️ WARNING: ADMIN_PASSWORD_HASH is not set. Login will fail until set in Render env vars.');
}

function verifyPassword(pw) {
  if (!PASSWORD_HASH || !PASSWORD_HASH.includes(':')) return false;
  try {
    const [salt, hash] = PASSWORD_HASH.split(':');
    const h = crypto.scryptSync(pw, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch(e) {
    return false;
  }
}

const validTokens = new Map();
const loginAttempts = new Map();

function makeToken() { 
  const t = crypto.randomBytes(32).toString('hex'); 
  validTokens.set(t, Date.now() + 1000 * 60 * 60 * 24); // 24-hour token validity
  return t; 
}

function auth(req, res) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const exp = validTokens.get(t); 
  if (!exp || Date.now() > exp) { 
    validTokens.delete(t); 
    res.statusCode = 401; 
    res.end('Unauthorized'); 
    return false; 
  }
  return true;
}

// Helper to set CORS headers dynamically
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const configuredOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(x => x.trim()) 
    : [];

  if (process.env.OWNER_FRONTEND_URL) configuredOrigins.push(process.env.OWNER_FRONTEND_URL.trim());
  if (process.env.CUSTOMER_FRONTEND_URL) configuredOrigins.push(process.env.CUSTOMER_FRONTEND_URL.trim());

  // Default fallback origins
  configuredOrigins.push(
    'https://alikebabbaro-admin.onrender.com',
    'https://alikebabbaro-f8t3.onrender.com',
    'http://localhost:3000'
  );

  if (origin && configuredOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
}

const ORDERS_FILE = path.join(ROOT, 'orders.json');
const MIME = { 
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon' 
};

function readOrders() { 
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } 
  catch(e) { return []; } 
}

function writeOrders(o) { 
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(o, null, 2)); 
}

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    res.statusCode = 204;
    return res.end();
  }

  // Login
  if (pathname === '/api/login' && req.method === 'POST') {
    setCorsHeaders(req, res);
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rec = loginAttempts.get(ip) || { count: 0, reset: now + 60000 };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
    rec.count++;
    loginAttempts.set(ip, rec);
    
    if (rec.count > 10) { 
      res.statusCode = 429; 
      res.end('Too many requests'); 
      return; 
    }

    let body = ''; 
    req.on('data', c => body += c); 
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        if (username === 'alikebab' && verifyPassword(password)) {
          const token = makeToken();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ token }));
        } else {
          res.statusCode = 401; 
          res.end('Unauthorized');
        }
      } catch(e) { 
        res.statusCode = 400; 
        res.end('Bad request'); 
      }
    });
    return;
  }

  // Logout
  if (pathname === '/api/logout' && req.method === 'POST') {
    setCorsHeaders(req, res);
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    validTokens.delete(t);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET Orders (Owner Only)
  if (pathname === '/api/orders' && req.method === 'GET') {
    setCorsHeaders(req, res);
    if (!auth(req, res)) return;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(readOrders()));
  }

  // POST Order (Customer Submission)
  if (pathname === '/api/orders' && req.method === 'POST') {
    setCorsHeaders(req, res);
    let body = ''; 
    let tooBig = false; 
    req.on('data', c => { 
      if (tooBig) return; 
      body += c; 
      if (body.length > 1e6) { tooBig = true; } 
    }); 
    
    req.on('end', () => { 
      if (tooBig) { res.statusCode = 413; res.end('Payload too large'); return; }
      let order;
      try { order = JSON.parse(body); } catch(e) { res.statusCode = 400; res.end('Bad request'); return; }
      if (!order || typeof order !== 'object' || Array.isArray(order)) { res.statusCode = 400; res.end('Bad request'); return; }
      if (typeof order.order_number !== 'string' || !order.order_number.trim() || order.order_number.length > 64) { res.statusCode = 400; res.end('Bad request'); return; }
      if (!['delivery', 'pickup'].includes(order.order_type)) { res.statusCode = 400; res.end('Bad request'); return; }
      if (typeof order.customer_name !== 'string' || !order.customer_name.trim() || order.customer_name.length > 120) { res.statusCode = 400; res.end('Bad request'); return; }
      if (typeof order.customer_phone !== 'string' || !order.customer_phone.trim() || order.customer_phone.length > 40) { res.statusCode = 400; res.end('Bad request'); return; }
      if (!Array.isArray(order.items) || order.items.length === 0 || order.items.length > 50) { res.statusCode = 400; res.end('Bad request'); return; }
      
      for (const it of order.items) {
        if (!it || typeof it !== 'object' || Array.isArray(it)) { res.statusCode = 400; res.end('Bad request'); return; }
        if (typeof it.name !== 'string' || !it.name.trim() || it.name.length > 120) { res.statusCode = 400; res.end('Bad request'); return; }
        if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 99) { res.statusCode = 400; res.end('Bad request'); return; }
        if (typeof it.price !== 'number' || !isFinite(it.price) || it.price < 0 || it.price > 10000) { res.statusCode = 400; res.end('Bad request'); return; }
      }
      
      if (order.order_type === 'delivery' && (typeof order.subtotal !== 'number' || order.subtotal < 15)) { res.statusCode = 400; res.end('Bad request'); return; }
      
      const orders = readOrders();
      order.id = Date.now();
      order.status = 'new';
      order.created_at = new Date().toISOString();
      orders.unshift(order);
      writeOrders(orders);
      
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(order));
    });
    return;
  }

  // PATCH Order Status (Owner Only)
  const m = pathname.match(/^\/api\/orders\/(\d+)$/);
  if (m && req.method === 'PATCH') {
    setCorsHeaders(req, res);
    if (!auth(req, res)) return;
    let body = ''; 
    req.on('data', c => body += c); 
    req.on('end', () => {
      try {
        const { status } = JSON.parse(body);
        const allowedStatuses = ['new', 'accepted', 'rejected', 'completed'];
        if (!allowedStatuses.includes(status)) { res.statusCode = 400; res.end('Invalid status'); return; }
        
        const orders = readOrders();
        const o = orders.find(x => x.id == m[1]);
        if (!o) { res.statusCode = 404; res.end('Not found'); return; }
        
        o.status = status;
        writeOrders(orders);
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(o));
      } catch(e) {
        res.statusCode = 400; 
        res.end('Bad request');
      }
    });
    return;
  }

  // Serve Static Files
  let filePath;
  if (pathname.startsWith('/customer/')) filePath = path.join(ROOT, pathname.replace('/customer/', ''));
  else if (pathname.startsWith('/owner/')) filePath = path.join(ROOT, pathname.replace('/owner/', ''));
  else if (pathname === '/') filePath = path.join(ROOT, 'index.html');
  else filePath = path.join(ROOT, pathname);

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch (e) {}

  fs.readFile(filePath, (err, data) => {
    if (err) { 
      res.statusCode = 404; 
      return res.end('Not found'); 
    }
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
