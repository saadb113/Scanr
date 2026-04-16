/**
 * autopilot.js — Server-side Autopilot Engine
 *
 * Runs a persistent Bybit WebSocket price monitor in the Node.js process.
 * Survives page reloads, browser closes, and server restarts (state in MongoDB).
 *
 * Milestones (same as client-side logic):
 *   RULE 1: Real PnL ≥ 50% of max profit  → SL to halfway between entry and initSL
 *   RULE 2: Real PnL ≥ 60% of max profit  → SL to breakeven
 *   RULE 3: Real loss ≥ 60% of max loss   → TP to breakeven
 */

'use strict';

const crypto   = require('crypto');
const WebSocket = require('ws');
const { BybitStore, AutopilotState, Settings } = require('./models');
const { sendDiscordAlert, positionClosedEmbed, autopilotMilestoneEmbed } = require('./discordNotifier');

// One engine instance per user
const engines = {};

// ── Bybit helpers ─────────────────────────────────────────────

async function getBybitCreds(userId) {
    const doc = await BybitStore.findOne({ userId }).lean();
    if (!doc) return null;
    const env = doc.activeEnv || 'mainnet';
    const c   = doc[env];
    if (!c?.apiKey || !c?.apiSecret) return null;
    return { apiKey: c.apiKey, apiSecret: c.apiSecret, env };
}

function hmacSHA256(secret, message) {
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

async function syncClock() {
    try {
        const res  = await fetch('https://api.bybit.com/v5/market/time');
        const data = await res.json();
        const serverTs = parseInt(
            data.result?.timeNano
                ? data.result.timeNano / 1_000_000
                : (data.result?.timeSecond || 0) * 1000
        );
        return serverTs ? serverTs - Date.now() : 0;
    } catch { return 0; }
}

async function bybitRequest(creds, method, path, params = {}, body = null, clockOffset = 0) {
    const base  = creds.env === 'testnet' ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
    const ts    = (Date.now() + clockOffset).toString();
    const recv  = '20000';
    let signStr, url;

    if (method === 'GET') {
        const qs = new URLSearchParams(params).toString();
        signStr  = ts + creds.apiKey + recv + qs;
        url      = base + path + (qs ? '?' + qs : '');
    } else {
        const bodyStr = JSON.stringify(body || params);
        signStr = ts + creds.apiKey + recv + bodyStr;
        url     = base + path;
    }

    const sign = hmacSHA256(creds.apiSecret, signStr);
    const headers = {
        'X-BAPI-API-KEY':     creds.apiKey,
        'X-BAPI-SIGN':        sign,
        'X-BAPI-TIMESTAMP':   ts,
        'X-BAPI-RECV-WINDOW': recv,
        'Content-Type':       'application/json',
    };
    const opts = { method, headers };
    if (method !== 'GET') opts.body = JSON.stringify(body || params);
    const resp = await fetch(url, opts);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}

async function bybitTradingStop(creds, clockOffset, sym, sl, tp) {
    try {
        const body = {
            category:    'linear',
            symbol:       sym,
            positionIdx:  0,
            slTriggerBy: 'MarkPrice',
            tpTriggerBy: 'MarkPrice',
        };
        if (sl) body.stopLoss   = sl.toString();
        if (tp) body.takeProfit = tp.toString();
        const res = await bybitRequest(creds, 'POST', '/v5/position/trading-stop', {}, body, clockOffset);
        return res.retCode === 0;
    } catch { return false; }
}

// ── DB helpers ────────────────────────────────────────────────

async function dbUpsert(userId, update) {
    await AutopilotState.findOneAndUpdate(
        { userId },
        { $set: update },
        { upsert: true, returnDocument: 'after' }
    );
}

async function dbPushLog(userId, entry) {
    await AutopilotState.findOneAndUpdate(
        { userId },
        { $push: { logs: { $each: [entry], $slice: -200 } } },
        { upsert: true }
    );
}

// ── Discord helpers ────────────────────────────────────────────

async function getDiscordSettings(userId) {
    try {
        const doc = await Settings.findOne({ userId }).lean();
        return doc?.discord || null;
    } catch { return null; }
}

// ── Logging ───────────────────────────────────────────────────

async function apLog(userId, msg, type = '') {
    const now   = new Date().toISOString().slice(11, 19);
    const entry = { time: now, msg, type };
    console.log(`[Autopilot] [${type || 'info'}] ${msg}`);
    try { await dbPushLog(userId, entry); } catch(_) {}
}

// ── Price check (concurrent guard) ───────────────────────────
const checkPending = {};

async function onPrice(userId, eng, price) {
    if (!eng.running || !eng.position) return;
    const p = eng.position;

    // Reject spikes vs last-seen price
    if (p.lastPrice && Math.abs(price - p.lastPrice) / p.lastPrice > 0.05) return;
    p.lastPrice = price;

    // Throttled DB live-price update (~every 0.1% move)
    const diff = Math.abs(price - (eng._lastSaved || 0)) / price;
    if (diff > 0.001) {
        eng._lastSaved = price;
        dbUpsert(userId, { livePrice: price }).catch(() => {});
    }

    const isLong    = p.isLong;
    const maxProfit = Math.abs(p.tp     - p.entry) * p.size;
    const maxLoss   = Math.abs(p.initSl - p.entry) * p.size;
    if (!maxProfit || !maxLoss) return;

    const wsPnl  = isLong ? (price - p.entry) * p.size : (p.entry - price) * p.size;
    const tpPct  = wsPnl > 0 ? Math.min(99, (wsPnl / maxProfit) * 100) : 0;
    const slPct  = wsPnl < 0 ? Math.min(99, (Math.abs(wsPnl) / maxLoss) * 100) : 0;

    const nearTp50 = !eng.triggered.tp40 && tpPct >= 48;
    const nearTp60 = !eng.triggered.tp50 && tpPct >= 58;
    const nearSl60 = !eng.triggered.sl60 && !eng.triggered.tp40 && !eng.triggered.tp50 && slPct >= 58;

    if (checkPending[userId] || !(nearTp50 || nearTp60 || nearSl60)) return;

    checkPending[userId] = true;
    try {
        // Fetch verified REST mark price
        const base = eng.creds.env === 'testnet' ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
        const res  = await fetch(`${base}/v5/market/tickers?category=linear&symbol=${p.sym}`);
        const data = await res.json();
        const rp   = parseFloat(data?.result?.list?.[0]?.markPrice);
        if (!rp) { checkPending[userId] = false; return; }

        const rPnl     = isLong ? (rp - p.entry) * p.size : (p.entry - rp) * p.size;
        const rTpPct   = rPnl > 0 ? (rPnl / maxProfit) * 100 : 0;
        const rSlPct   = rPnl < 0 ? (Math.abs(rPnl) / maxLoss) * 100 : 0;
        const towardTp = isLong ? rp > p.entry : rp < p.entry;
        const towardSl = isLong ? rp < p.entry : rp > p.entry;
        const co       = await syncClock();

        if (!eng.triggered.tp40 && towardTp && rTpPct >= 50) {
            eng.triggered.tp40 = true;
            const dist  = Math.abs(p.initSl - p.entry);
            const newSl = parseFloat((isLong ? p.entry - dist * 0.5 : p.entry + dist * 0.5).toFixed(4));
            await apLog(userId, `✅ TP 50% (${rTpPct.toFixed(1)}% @ ${rp}) → SL ${p.sl} → ${newSl} (half risk)`, 'action');
            const ok = await bybitTradingStop(eng.creds, co, p.sym, newSl, p.tp);
            if (ok) {
                p.sl = newSl;
                await dbUpsert(userId, { position: p, triggered: eng.triggered });
                getDiscordSettings(userId).then(d => {
                    if (d?.webhookUrl && d?.alerts?.autopilotMilestone !== false)
                        sendDiscordAlert(d.webhookUrl, autopilotMilestoneEmbed({ symbol: p.sym, milestone: '50% to TP reached', action: 'SL moved to half-risk', newSl, newTp: null }));
                });
            }
        }

        if (!eng.triggered.tp50 && towardTp && rTpPct >= 60) {
            eng.triggered.tp50 = true;
            const be = parseFloat(p.entry.toFixed(4));
            await apLog(userId, `✅ TP 60% (${rTpPct.toFixed(1)}% @ ${rp}) → SL to BE ${be}`, 'action');
            const ok = await bybitTradingStop(eng.creds, co, p.sym, be, p.tp);
            if (ok) {
                p.sl = be;
                await dbUpsert(userId, { position: p, triggered: eng.triggered });
                getDiscordSettings(userId).then(d => {
                    if (d?.webhookUrl && d?.alerts?.autopilotMilestone !== false)
                        sendDiscordAlert(d.webhookUrl, autopilotMilestoneEmbed({ symbol: p.sym, milestone: '60% to TP reached', action: 'SL moved to breakeven', newSl: be, newTp: null }));
                });
            }
        }

        if (!eng.triggered.sl60 && !eng.triggered.tp40 && !eng.triggered.tp50 && towardSl && rSlPct >= 60) {
            eng.triggered.sl60 = true;
            const be = parseFloat(p.entry.toFixed(4));
            await apLog(userId, `✅ SL 60% (${rSlPct.toFixed(1)}% @ ${rp}) → TP to BE ${be}`, 'action');
            const ok = await bybitTradingStop(eng.creds, co, p.sym, p.sl, be);
            if (ok) {
                p.tp = be;
                await dbUpsert(userId, { position: p, triggered: eng.triggered });
                getDiscordSettings(userId).then(d => {
                    if (d?.webhookUrl && d?.alerts?.autopilotMilestone !== false)
                        sendDiscordAlert(d.webhookUrl, autopilotMilestoneEmbed({ symbol: p.sym, milestone: '60% toward SL', action: 'TP moved to breakeven', newSl: null, newTp: be }));
                });
            }
        }
    } catch (e) {
        apLog(userId, `Milestone check error: ${e.message}`, 'warn').catch(() => {});
    }
    checkPending[userId] = false;
}

// ── Position-closed detector ────────────────────────────────
// Polls /v5/position/list every 20 s; stops the engine when size = 0

async function checkPositionClosed(userId, eng) {
    if (!eng.running || !eng.position) return;
    try {
        const co   = await syncClock();
        const sym  = eng.position.sym;
        const res  = await bybitRequest(
            eng.creds, 'GET', '/v5/position/list',
            { category: 'linear', symbol: sym }, null, co
        );
        if (res.retCode !== 0) return; // API error — don't stop, try again later
        const list = res.result?.list || [];
        // Position is considered closed when the list is empty OR size is "0"
        const closed = list.length === 0 || list.every(p => parseFloat(p.size) === 0);
        if (closed) {
            await apLog(userId, `Position ${sym} is closed (TP/SL hit or manually closed) — stopping autopilot`, 'action');
            // Send Discord TP/SL notification before stopping
            getDiscordSettings(userId).then(d => {
                if (d?.webhookUrl && d?.alerts?.tpSlHit !== false) {
                    const p = eng.position;
                    const exitPrice = eng._lastSaved || p.tp || p.entry;
                    const pnl = p.isLong ? (exitPrice - p.entry) * p.size : (p.entry - exitPrice) * p.size;
                    sendDiscordAlert(d.webhookUrl, positionClosedEmbed({ symbol: p.sym, side: p.side || (p.isLong ? 'Long' : 'Short'), entryPrice: p.entry, exitPrice, pnl, closeReason: 'TP/SL Hit' }));
                }
            });
            apStop(userId);
        }
    } catch (e) {
        // Network hiccup — swallow and retry next cycle
        console.error('[Autopilot] posCheck error:', e.message);
    }
}

// ── WebSocket ─────────────────────────────────────────────────

function connectWs(userId, eng) {
    const wsUrl = eng.creds.env === 'testnet'
        ? 'wss://stream-testnet.bybit.com/v5/public/linear'
        : 'wss://stream.bybit.com/v5/public/linear';

    const ws  = new WebSocket(wsUrl);
    eng.ws    = ws;
    const sym = eng.position.sym;

    ws.on('open', () => {
        apLog(userId, 'WebSocket connected', 'ok').catch(() => {});
        ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${sym}`] }));
        eng._hb = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send('{"op":"ping"}');
        }, 20000);
    });

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            if (data.topic?.startsWith('tickers.') && data.data) {
                const mp  = parseFloat(data.data.markPrice);
                const lp  = parseFloat(data.data.lastPrice);
                const px  = mp > 0 ? mp : lp > 0 ? lp : 0;
                if (!px) return;
                // Sanity check: max 20% from entry
                if (eng.position?.entry && Math.abs(px - eng.position.entry) / eng.position.entry > 0.20) return;
                onPrice(userId, eng, px).catch(() => {});
            }
        } catch (_) {}
    });

    ws.on('error', (err) => {
        apLog(userId, `WebSocket error: ${err.message}`, 'warn').catch(() => {});
    });

    ws.on('close', () => {
        clearInterval(eng._hb);
        if (eng.running) {
            apLog(userId, 'WebSocket closed — reconnecting in 5s…', 'warn').catch(() => {});
            setTimeout(() => { if (eng.running) connectWs(userId, eng); }, 5000);
        }
    });
}

// ── Public API ────────────────────────────────────────────────

async function apStart(userId, positionData) {
    // Stop any existing engine first
    apStop(userId);

    const creds = await getBybitCreds(userId);
    if (!creds) throw new Error('No Bybit credentials found in database');

    const position = {
        sym:       positionData.sym,
        entry:     parseFloat(positionData.entry),
        sl:        parseFloat(positionData.sl),
        initSl:    parseFloat(positionData.sl),
        tp:        parseFloat(positionData.tp),
        side:      positionData.side,
        size:      parseFloat(positionData.size),
        isLong:    positionData.side === 'Buy',
        lastPrice: parseFloat(positionData.entry),
    };

    const triggered = { tp40: false, tp50: false, sl60: false };

    // Persist initial state
    await dbUpsert(userId, { running: true, position, triggered, livePrice: 0, logs: [], startedAt: new Date() });

    const eng = { running: true, ws: null, position, triggered, creds, _lastSaved: 0 };
    engines[userId] = eng;

    await apLog(userId, `Autopilot STARTED: ${position.sym} ${position.isLong ? 'LONG' : 'SHORT'} · entry ${position.entry} · SL ${position.sl} · TP ${position.tp}`, 'ok');
    connectWs(userId, eng);

    // Start position-closed polling (every 20 s)
    eng._posCheck = setInterval(() => checkPositionClosed(userId, eng).catch(() => {}), 20000);
}

function apStop(userId) {
    const eng = engines[userId];
    if (!eng) return;
    eng.running = false;
    clearInterval(eng._hb);
    clearInterval(eng._posCheck);
    if (eng.ws) {
        eng.ws.removeAllListeners('close'); // prevent auto-reconnect
        try { eng.ws.close(); } catch (_) {}
        eng.ws = null;
    }
    delete engines[userId];
    AutopilotState.findOneAndUpdate(
        { userId },
        { $set: { running: false } },
        { upsert: true }
    ).catch(() => {});
    apLog(userId, 'Autopilot STOPPED', 'warn').catch(() => {});
}

async function getStatus(userId) {
    const doc = await AutopilotState.findOne({ userId }).lean();
    return doc || { running: false };
}

// Called once on server boot: resume any active session persisted in DB
async function resumeOnBoot() {
    try {
        const docs = await AutopilotState.find({ running: true }).lean();
        for (const doc of docs) {
            if (doc?.position && doc.userId) {
                console.log(`[Autopilot] Resuming session for ${doc.position.sym} (user ${doc.userId})…`);
                await apStart(doc.userId, doc.position);
            }
        }
    } catch (e) {
        console.error('[Autopilot] Boot resume error:', e.message);
    }
}

module.exports = { apStart, apStop, getStatus, resumeOnBoot };
