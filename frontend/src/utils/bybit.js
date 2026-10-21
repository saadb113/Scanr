// Shared Bybit trading helpers for the Terminal and Coin-Detail pages.
//
// The legacy pages (public/terminal.html, public/pages/coin-detail.html via
// public/js/app.js) sign Bybit v5 REST requests *in the browser* using the
// user's own API key/secret (stored server-side via /api/bybit-store, loaded
// once per page). We keep that architecture as-is — it's how the feature
// already works in production — rather than inventing a server-side Bybit
// proxy as part of this port.
//
// NOTE on /api/proxy/binance: the legacy pages call a server route
// `/api/proxy/binance?path=...` for Binance futures market data (klines,
// 24hr ticker, exchangeInfo, server time). That route does not exist in
// server.js (confirmed by grep — only '/api/bybit/proxy' exists, which is a
// different, Bybit-specific route). This is a pre-existing dead endpoint;
// ChallengeDetail.jsx's port (see its fetchBinancePrice()) already hit the
// same gap and resolved it by calling Binance's public, unauthenticated,
// CORS-enabled futures REST API directly from the browser instead of
// reproducing the dead proxy call. We follow that same established pattern
// here for every former /api/proxy/binance call.

const BINANCE_FAPI = 'https://fapi.binance.com';

// ── Pure-JS HMAC-SHA256 (works without Node's crypto / WebCrypto quirks on
//    plain HTTP), ported verbatim from public/js/app.js hmacSHA256(). ──────
export function hmacSHA256(secret, message) {
  function sha256bytes(data) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const len = bytes.length;
    const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
    padded.set(bytes);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 4, (len * 8) >>> 0, false);
    dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000), false);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padded.length; off += 64) {
      const w = new Uint32Array(64);
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    const out = new Uint8Array(32);
    h.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v, false));
    return out;
  }
  function toBytes(s) { return typeof s === 'string' ? new TextEncoder().encode(s) : s; }
  let key = toBytes(secret);
  if (key.length > 64) key = sha256bytes(key);
  const padded = new Uint8Array(64);
  padded.set(key);
  const ipad = padded.map((b) => b ^ 0x36);
  const opad = padded.map((b) => b ^ 0x5c);
  const m = toBytes(message);
  const inner = new Uint8Array(64 + m.length);
  inner.set(ipad); inner.set(m, 64);
  const outer = new Uint8Array(64 + 32);
  outer.set(opad); outer.set(sha256bytes(inner), 64);
  return Array.from(sha256bytes(outer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Clock sync — Bybit rejects requests whose timestamp drifts from server
//    time. The legacy pages hit Binance's /fapi/v1/time via the dead proxy
//    for this (both venues' server clocks are close enough for the ±20s
//    recv-window). We now hit Binance directly (see note above). ──────────
export async function syncBybitClock() {
  try {
    const r = await fetch(`${BINANCE_FAPI}/fapi/v1/time`);
    const d = await r.json();
    const serverTs = parseInt(d.serverTime, 10);
    return serverTs ? serverTs - Date.now() : 0;
  } catch {
    return 0;
  }
}

// ── Signed Bybit v5 request, straight from the browser using the user's
//    own stored API key/secret. Ported from bybitRequest() in app.js. ─────
export async function bybitRequest(creds, method, path, params = null, body = null, clockOffset = 0) {
  if (!creds?.apiKey || !creds?.apiSecret) {
    throw new Error('No API credentials. Set them in Settings → Bybit.');
  }
  const base = creds.env === 'testnet' ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
  const ts = (Date.now() + (clockOffset || 0)).toString();
  const recv = '20000';
  let signStr;
  let url;

  if (method === 'GET') {
    const qs = new URLSearchParams(params || {}).toString();
    signStr = ts + creds.apiKey + recv + qs;
    url = base + path + (qs ? '?' + qs : '');
  } else {
    const bodyStr = JSON.stringify(body || params || {});
    signStr = ts + creds.apiKey + recv + bodyStr;
    url = base + path;
  }

  const sign = hmacSHA256(creds.apiSecret, signStr);
  const headers = {
    'X-BAPI-API-KEY': creds.apiKey,
    'X-BAPI-SIGN': sign,
    'X-BAPI-TIMESTAMP': ts,
    'X-BAPI-RECV-WINDOW': recv,
    'Content-Type': 'application/json',
  };

  const opts = { method, headers };
  if (method !== 'GET') opts.body = JSON.stringify(body || params || {});
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ── Public, unauthenticated Binance futures market data — see note above
//    on why this replaces the dead /api/proxy/binance route. ─────────────
export async function fetchBinanceTicker24hr(symbol) {
  const r = await fetch(`${BINANCE_FAPI}/fapi/v1/ticker/24hr?symbol=${symbol}`);
  if (!r.ok) throw new Error(`ticker fetch failed (${r.status})`);
  return r.json();
}

export async function fetchBinanceExchangeInfo(symbol) {
  const r = await fetch(`${BINANCE_FAPI}/fapi/v1/exchangeInfo?symbol=${symbol}`);
  if (!r.ok) throw new Error(`exchangeInfo fetch failed (${r.status})`);
  return r.json();
}

export async function fetchBinanceKlines(symbol, interval, limit = 100) {
  const r = await fetch(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!r.ok) throw new Error(`klines fetch failed (${r.status})`);
  return r.json();
}

// ── Qty/price rounding to instrument filters — ported from
//    bytRoundQtyStr()/bytRoundPriceStr() in app.js. ────────────────────────
export function roundQtyStr(raw, step) {
  const s = step > 0 ? step : 0.001;
  const dec = (s.toString().split('.')[1] || '').length;
  const steps = Math.floor(parseFloat((raw / s).toFixed(8)));
  return (steps * s).toFixed(dec);
}

export function roundPriceStr(p, tick) {
  if (!p || tick <= 0) return String(p);
  const dec = (tick.toString().split('.')[1] || '').length;
  return (Math.round(p / tick) * tick).toFixed(dec);
}

export function decimalsFor(price) {
  return price >= 1000 ? 2 : price >= 1 ? 4 : 6;
}

export const TF_LABELS = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 45: '45m', 60: '1h', 240: '4h', D: '1d', W: '1w', M: '1M' };
export const TF_TO_BINANCE = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 45: '45m', 60: '1h', 240: '4h', D: '1d', W: '1w', M: '1M' };
