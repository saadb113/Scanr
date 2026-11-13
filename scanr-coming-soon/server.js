const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
try {
  const envText = fsSync.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const DATA = path.resolve(process.env.SCANR_DATA_DIR || path.join(ROOT, 'data'));
const SUBSCRIBERS = path.join(DATA, 'subscribers.json');
const ANALYTICS = path.join(DATA, 'analytics.json');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 8192;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon',
};
const PUBLIC_FILES = new Set(['/index.html', '/features.html', '/about.html', '/privacy.html', '/styles.css', '/app.js', '/site-config.js', '/favicon.svg', '/admin.html', '/admin.css', '/admin.js', '/saad-social-avatar.png']);
const attempts = new Map();
const adminAttempts = new Map();
const adminSessions = new Map();
const geoCache = new Map();
let writeQueue = Promise.resolve();

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function allowRequest(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    if (new URL(origin).host === req.headers.host) return true;
  } catch {}
  json(res, 403, { error: 'Request origin could not be verified.' });
  return false;
}

function rateLimit(req, res) {
  const now = Date.now();
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() || req.socket.remoteAddress || 'unknown';
  const recent = (attempts.get(ip) || []).filter((stamp) => now - stamp < 10 * 60 * 1000);
  if (recent.length >= 8) { json(res, 429, { error: 'Too many attempts. Please try again later.' }); return false; }
  recent.push(now); attempts.set(ip, recent);
  if (attempts.size > 1000) for (const [key, values] of attempts) if (!values.length || now - values.at(-1) > 10 * 60 * 1000) attempts.delete(key);
  return true;
}

async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function addSubscriber(email) {
  const operation = async () => {
    await fs.mkdir(DATA, { recursive: true });
    let entries = [];
    try { entries = JSON.parse(await fs.readFile(SUBSCRIBERS, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const existing = entries.find((entry) => entry.email.toLowerCase() === email.toLowerCase());
    if (existing) return { alreadySubscribed: true };
    entries.push({ id: crypto.randomUUID(), email, subscribedAt: new Date().toISOString() });
    await fs.writeFile(SUBSCRIBERS, `${JSON.stringify(entries, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { alreadySubscribed: false };
  };
  const current = writeQueue.then(operation, operation);
  writeQueue = current.catch(() => {});
  return current;
}

async function readDataFile(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function appendView(event) {
  const operation = async () => {
    await fs.mkdir(DATA, { recursive: true });
    const events = await readDataFile(ANALYTICS, []);
    events.push(event);
    await fs.writeFile(ANALYTICS, `${JSON.stringify(events, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  };
  const current = writeQueue.then(operation, operation);
  writeQueue = current.catch(() => {});
  return current;
}

function safeCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : '';
}

function getCountry(req) {
  return safeCountryCode(req.headers['cf-ipcountry']) || safeCountryCode(req.headers['x-vercel-ip-country']) || safeCountryCode(req.headers['cloudfront-viewer-country']);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return ((Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() || req.socket.remoteAddress || '').replace(/^\[([^\]]+)\](?::\d+)?$/, '$1');
}

function isPrivateIp(ip) {
  const value = String(ip).replace(/^::ffff:/, '');
  if (value.includes(':')) return value === '::1' || value === '::' || /^f[cd]/i.test(value) || /^fe[89ab]/i.test(value) || /^2001:db8:/i.test(value);
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function resolveCountry(ip) {
  if (!ip || isPrivateIp(ip) || geoCache.has(ip) || geoCache.size > 500) return Promise.resolve(geoCache.get(ip) || '');
  const task = fetch(`https://ipapi.co/${encodeURIComponent(ip)}/country/`, { signal: AbortSignal.timeout(1800) })
    .then((response) => response.ok ? response.text() : '')
    .then((value) => safeCountryCode(value))
    .catch(() => '');
  geoCache.set(ip, task);
  return task;
}

async function updateViewCountry(id, country) {
  if (!country) return;
  const operation = async () => {
    const events = await readDataFile(ANALYTICS, []);
    const event = events.find((item) => item.id === id);
    if (!event || event.country) return;
    event.country = country;
    await fs.writeFile(ANALYTICS, `${JSON.stringify(events, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  };
  const current = writeQueue.then(operation, operation);
  writeQueue = current.catch(() => {});
  return current;
}

async function trackView(req, res) {
  if (!allowRequest(req, res)) return;
  let body;
  try { body = await readJson(req); } catch { res.writeHead(204); return res.end(); }
  const page = typeof body.page === 'string' ? body.page : '';
  if (!['/', '/features', '/about', '/privacy'].includes(page)) { res.writeHead(204); return res.end(); }
  const country = getCountry(req) || (isPrivateIp(getClientIp(req)) ? 'Development' : '');
  const event = { id: crypto.randomUUID(), page, country, viewedAt: new Date().toISOString() };
  try {
    await appendView(event);
  } catch (error) { console.error('Could not store page view:', error.message); res.writeHead(204); return res.end(); }
  res.writeHead(204); res.end();
  if (!country) resolveCountry(getClientIp(req)).then((result) => updateViewCountry(event.id, result)).catch(() => {});
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key, value]) => key && value !== undefined).map(([key, value]) => { try { return [key, decodeURIComponent(value)]; } catch { return [key, '']; } }));
}

function hasAdminSession(req) {
  const token = parseCookies(req).scanr_admin;
  const expiresAt = adminSessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) { adminSessions.delete(token); return false; }
  return true;
}

function cookieSecure(req) { return req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https'; }

async function adminLogin(req, res) {
  if (!allowRequest(req, res)) return;
  if (!process.env.ADMIN_PASSWORD) return json(res, 503, { error: 'Admin access is not configured. Set ADMIN_PASSWORD in the service environment.' });
  const ip = getClientIp(req); const now = Date.now();
  const recent = (adminAttempts.get(ip) || []).filter((stamp) => now - stamp < 10 * 60 * 1000);
  if (recent.length >= 8) return json(res, 429, { error: 'Too many sign-in attempts. Wait a few minutes and try again.' });
  recent.push(now); adminAttempts.set(ip, recent);
  let body;
  try { body = await readJson(req); } catch { return json(res, 400, { error: 'Enter the admin password.' }); }
  const supplied = Buffer.from(String(body.password || ''));
  const expected = Buffer.from(process.env.ADMIN_PASSWORD);
  const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!valid) return json(res, 401, { error: 'That password did not match.' });
  const token = crypto.randomBytes(32).toString('base64url');
  adminSessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': `scanr_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${cookieSecure(req) ? '; Secure' : ''}` });
  res.end(JSON.stringify({ ok: true }));
}

async function adminData(req, res) {
  if (!hasAdminSession(req)) return json(res, 401, { error: 'Sign in to view the admin dashboard.' });
  try {
    const [subscribers, views] = await Promise.all([readDataFile(SUBSCRIBERS, []), readDataFile(ANALYTICS, [])]);
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    const countryNames = new Map();
    const pages = new Map();
    const countries = new Map();
    const days = new Map();
    for (const event of views) {
      const date = new Date(event.viewedAt);
      if (Number.isNaN(date.valueOf())) continue;
      const page = event.page || '/'; pages.set(page, (pages.get(page) || 0) + 1);
      const code = event.country || 'Unknown';
      const countryName = code === 'Development' || code === 'Unknown' ? code : (countryNames.get(code) || displayNames.of(code) || code);
      countryNames.set(code, countryName); countries.set(countryName, (countries.get(countryName) || 0) + 1);
      const day = date.toISOString().slice(0, 10); days.set(day, (days.get(day) || 0) + 1);
    }
    const now = new Date();
    const daily = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29 + index));
      const day = date.toISOString().slice(0, 10); return { date: day, views: days.get(day) || 0 };
    });
    const last30Days = views.filter((event) => event.viewedAt >= daily[0].date);
    const last7Days = views.filter((event) => event.viewedAt >= daily[23].date);
    return json(res, 200, { subscribers: subscribers.sort((a, b) => new Date(b.subscribedAt) - new Date(a.subscribedAt)), views: { total: views.length, last30Days: last30Days.length, last7Days: last7Days.length, pages: [...pages].map(([page, count]) => ({ page, count })).sort((a, b) => b.count - a.count), countries: [...countries].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count), daily } });
  } catch (error) { console.error('Could not read admin data:', error.message); return json(res, 500, { error: 'Could not load the dashboard data.' }); }
}

function adminLogout(req, res) {
  const token = parseCookies(req).scanr_admin;
  adminSessions.delete(token);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': `scanr_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cookieSecure(req) ? '; Secure' : ''}` });
  res.end(JSON.stringify({ ok: true }));
}

async function subscribe(req, res) {
  if (!allowRequest(req, res) || !rateLimit(req, res)) return;
  let body;
  try { body = await readJson(req); } catch (error) { json(res, 400, { error: error.message === 'Request is too large.' ? error.message : 'Please submit a valid email address.' }); return; }
  // Honeypot fields receive a generic success so bots do not learn the defense.
  if (typeof body.company === 'string' && body.company.trim()) { json(res, 200, { ok: true }); return; }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (body.consent !== true) { json(res, 400, { error: 'Please confirm you want to receive launch updates.' }); return; }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { json(res, 400, { error: 'Enter a valid email address.' }); return; }

  const webhook = process.env.SUBSCRIBE_WEBHOOK_URL;
  if (webhook) {
    try {
      const result = await fetch(webhook, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.SUBSCRIBE_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.SUBSCRIBE_WEBHOOK_TOKEN}` } : {}) },
        body: JSON.stringify({ email, consent: true, source: 'scanr-launch-site', subscribedAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(8000),
      });
      if (!result.ok) throw new Error(`Subscription provider returned ${result.status}`);
      const saved = await addSubscriber(email);
      json(res, 200, { ok: true, ...saved });
    } catch (error) { console.error('Newsletter webhook failed:', error.message); json(res, 502, { error: 'We couldn’t save your email right now. Please try again shortly.' }); }
    return;
  }

  if (process.env.REQUIRE_SUBSCRIBE_WEBHOOK === 'true') {
    json(res, 503, { error: 'The launch list is not connected yet. Please check back soon.' });
    return;
  }

  try { json(res, 200, { ok: true, ...(await addSubscriber(email)) }); }
  catch (error) { console.error('Could not store launch signup:', error); json(res, 500, { error: 'We couldn’t save your email right now. Please try again shortly.' }); }
}

async function serve(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, name: 'scanr-coming-soon' });
  if (req.method === 'POST' && pathname === '/api/view') return trackView(req, res);
  if (req.method === 'POST' && pathname === '/api/admin/login') return adminLogin(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/data') return adminData(req, res);
  if (req.method === 'POST' && pathname === '/api/admin/logout') return adminLogout(req, res);
  if (req.method === 'POST' && pathname === '/api/subscribe') return subscribe(req, res);
  if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); return res.end(); }

  const routes = { '/': '/index.html', '/features': '/features.html', '/about': '/about.html', '/privacy': '/privacy.html', '/admin': '/admin.html' };
  const isFont = /^\/fonts\/[a-zA-Z0-9._-]+\.woff2$/.test(pathname);
  if (!routes[pathname] && !PUBLIC_FILES.has(pathname) && !isFont) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
  const relativePath = routes[pathname] || (pathname.startsWith('/fonts/') || pathname === '/favicon.svg' || pathname === '/saad-social-avatar.png' ? `/public${pathname}` : pathname);
  const target = path.resolve(ROOT, `.${relativePath}`);
  if (!target.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403); return res.end(); }
  try {
    const body = await fs.readFile(target);
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    console.error('Static file error:', error); res.writeHead(500); res.end('Internal server error');
  }
}

http.createServer((req, res) => { serve(req, res).catch((error) => { console.error(error); if (!res.headersSent) res.writeHead(500); res.end('Internal server error'); }); })
  .listen(PORT, '0.0.0.0', () => console.log(`Scanr launch site running on port ${PORT}`));
