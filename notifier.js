'use strict';

/**
 * notifier.js — Email notifications via EmailJS REST API
 *
 * Required .env vars:
 *   EMAILJS_SERVICE_ID
 *   EMAILJS_TEMPLATE_ID
 *   EMAILJS_PUBLIC_KEY
 *   EMAILJS_PRIVATE_KEY   (optional but recommended for server-side)
 *   EMAIL_RECIPIENT       (default recipient)
 *
 * EmailJS template variables needed: {{to_email}}  {{subject}}  {{message}}
 */

let _cachedAppName = null;
async function getAppName() {
    if (_cachedAppName !== null) return _cachedAppName;
    try {
        const { AppSettings } = require('./models');
        const doc = await AppSettings.findOne({ key: 'appName' }).lean();
        _cachedAppName = doc?.value || 'Agent';
    } catch(_) { _cachedAppName = 'Agent'; }
    return _cachedAppName;
}
const EMAILJS_URL = 'https://api.emailjs.com/api/v1.0/email/send';

async function sendEmail(subject, message, recipientOverride) {
    const serviceId  = process.env.EMAILJS_SERVICE_ID;
    const templateId = process.env.EMAILJS_TEMPLATE_ID;
    const publicKey  = process.env.EMAILJS_PUBLIC_KEY;
    const privateKey = process.env.EMAILJS_PRIVATE_KEY;
    const recipient  = recipientOverride || process.env.EMAIL_RECIPIENT;

    if (!serviceId || !templateId || !publicKey || !recipient) {
        throw new Error('Email not configured — set EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY and EMAIL_RECIPIENT in .env');
    }

    const body = {
        service_id:  serviceId,
        template_id: templateId,
        user_id:     publicKey,
        template_params: { to_email: recipient, subject, message },
    };
    if (privateKey) body.accessToken = privateKey;

    const resp = await fetch(EMAILJS_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    });

    if (!resp.ok) {
        const text = await resp.text();
        console.error('[Notifier] EmailJS error:', text);
        throw new Error(text || `HTTP ${resp.status}`);
    }
    console.log('[Notifier] Email sent to', recipient);
    return true;
}

async function notifyAgentStarted(settings) {
    const appName = await getAppName();
    return sendEmail(
        `🤖 ${appName} Agent Started`,
        `Trading window: ${settings.startTime || '08:00'} – ${settings.endTime || '18:00'} PST\n` +
        `Max trades today: ${settings.maxTrades || 3}\n` +
        `Daily drawdown limit: ${settings.dailyDrawdownPct || 5}%\n` +
        `Scanning for opportunities...`,
        settings?.emailRecipient
    );
}

function notifyPreTrade(trade) {
    return sendEmail(
        `⚡ Trade Alert — ${trade.symbol} ${(trade.direction || '').toUpperCase()}`,
        `Symbol: ${trade.symbol}\n` +
        `Direction: ${(trade.direction || '').toUpperCase()}\n` +
        `Entry: ${trade.entry}\n` +
        `Stop Loss: ${trade.sl}\n` +
        `Take Profit: ${trade.tp1}\n` +
        `RR Ratio: ${trade.rr || '—'}:1\n` +
        `AI Score: ${trade.score}/100\n` +
        `Confidence: ${(trade.confidence || '').toUpperCase()}\n` +
        `Reason: ${trade.reasoning || '—'}\n` +
        `Placing order now...`
    );
}

function notifyTradeClosed(trade, tradesToday, maxTrades) {
    const isWin = (trade.pnl || 0) >= 0;
    const sign  = isWin ? '+' : '';
    return sendEmail(
        `${isWin ? '✅ WIN' : '❌ LOSS'} — ${trade.symbol} closed`,
        `Symbol: ${trade.symbol}\n` +
        `Direction: ${(trade.direction || '').toUpperCase()}\n` +
        `Entry: ${trade.entryPrice}  →  Exit: ${trade.closePrice}\n` +
        `PnL: ${sign}${(trade.pnl || 0).toFixed(2)} USDT  (${sign}${(trade.pnlPercent || 0).toFixed(2)}%)\n` +
        `Trades today: ${tradesToday}/${maxTrades}`
    );
}

async function notifyDailySummary(session, trades) {
    const winRate  = session.tradesTaken > 0 ? ((session.wins / session.tradesTaken) * 100).toFixed(0) : '0';
    const pnlSign  = (session.totalPnl || 0) >= 0 ? '+' : '';
    const endBal   = session.endBalance   || session.startBalance || 0;
    const startBal = session.startBalance || 0;
    const chgAmt   = endBal - startBal;
    const chgPct   = startBal > 0 ? ((chgAmt / startBal) * 100).toFixed(2) : '0.00';
    const chgSign  = chgAmt >= 0 ? '+' : '';

    let tradeLines = '';
    (trades || []).forEach((t, i) => {
        const s = (t.pnl || 0) >= 0 ? '+' : '';
        tradeLines += `\n${i + 1}. ${t.symbol} ${(t.side || '').toUpperCase()}\n` +
                      `   Entry: ${t.entryPrice}  →  Exit: ${t.closePrice || 'open'}\n` +
                      `   PnL: ${s}${(t.pnl || 0).toFixed(2)} USDT  |  Score: ${t.aiScore || 0}/100`;
    });

    const appName = await getAppName();
    return sendEmail(
        `📊 ${appName} Daily Summary — ${session.date}`,
        `Date: ${session.date}\n` +
        `Shutdown reason: ${session.endReason || 'manual'}\n\n` +
        `Trades taken: ${session.tradesTaken}/${session.maxTrades || 3}\n` +
        `Wins: ${session.wins || 0}  |  Losses: ${session.losses || 0}\n` +
        `Win rate: ${winRate}%` +
        tradeLines + `\n\n` +
        `Total PnL: ${pnlSign}${(session.totalPnl || 0).toFixed(2)} USDT\n` +
        `Starting balance: ${startBal.toFixed(2)} USDT\n` +
        `Ending balance: ${endBal.toFixed(2)} USDT\n` +
        `Account change: ${chgSign}${chgPct}%`
    );
}

module.exports = { sendEmail, notifyAgentStarted, notifyPreTrade, notifyTradeClosed, notifyDailySummary };
