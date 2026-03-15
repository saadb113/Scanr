'use strict';

const { Settings } = require('./models');

async function sendDiscordAlert(webhookUrl, embed) {
    if (!webhookUrl) return;
    try {
        await fetch(webhookUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ embeds: [embed] }),
        });
    } catch (e) {
        console.error('Discord alert failed:', e.message);
    }
}

function orderSummaryEmbed(order) {
    const isLong = order.side === 'Buy' || order.side === 'long';
    return {
        title:  isLong ? '🟢 ORDER PLACED — LONG' : '🔴 ORDER PLACED — SHORT',
        color:  isLong ? 0x00e5a0 : 0xff4d6d,
        fields: [
            { name: 'Symbol',      value: order.symbol,                          inline: true },
            { name: 'Type',        value: order.orderType,                       inline: true },
            { name: 'Entry Price', value: order.price?.toString() || 'Market',   inline: true },
            { name: 'Quantity',    value: order.qty?.toString(),                 inline: true },
            { name: 'Stop Loss',   value: order.sl?.toString()  || 'Not set',    inline: true },
            { name: 'Take Profit', value: order.tp?.toString()  || 'Not set',    inline: true },
        ],
        footer:    { text: 'Scanr Trading' },
        timestamp: new Date().toISOString(),
    };
}

function positionClosedEmbed(trade) {
    const isWin = trade.pnl > 0;
    return {
        title:  isWin ? '✅ POSITION CLOSED — WIN' : '❌ POSITION CLOSED — LOSS',
        color:  isWin ? 0x00e5a0 : 0xff4d6d,
        fields: [
            { name: 'Symbol',    value: trade.symbol,                                              inline: true },
            { name: 'Direction', value: trade.side,                                                inline: true },
            { name: 'Entry',     value: trade.entryPrice?.toString(),                              inline: true },
            { name: 'Exit',      value: trade.exitPrice?.toString(),                               inline: true },
            { name: 'PnL',       value: `${isWin ? '+' : ''}${trade.pnl?.toFixed(4)} USDT`,       inline: true },
            { name: 'Closed by', value: trade.closeReason || 'Manual',                            inline: true },
        ],
        footer:    { text: 'Scanr Trading' },
        timestamp: new Date().toISOString(),
    };
}

function autopilotMilestoneEmbed(data) {
    return {
        title:  '🤖 AUTOPILOT MILESTONE',
        color:  0xf59e0b,
        fields: [
            { name: 'Symbol',    value: data.symbol,                inline: true },
            { name: 'Milestone', value: data.milestone,             inline: true },
            { name: 'Action',    value: data.action,                inline: true },
            { name: 'New SL',    value: data.newSl?.toString() || '-', inline: true },
            { name: 'New TP',    value: data.newTp?.toString() || '-', inline: true },
        ],
        footer:    { text: 'Scanr Trading' },
        timestamp: new Date().toISOString(),
    };
}

function priceAlertEmbed(data) {
    return {
        title:  '💰 PRICE ALERT TRIGGERED',
        color:  0x63b3ed,
        fields: [
            { name: 'Symbol',        value: data.symbol,                inline: true },
            { name: 'Target Price',  value: data.targetPrice?.toString(), inline: true },
            { name: 'Current Price', value: data.currentPrice?.toString(), inline: true },
            {
                name:   'Alert Type',
                value:  data.direction === 'above' ? '📈 Price went above target' : '📉 Price went below target',
                inline: false,
            },
        ],
        footer:    { text: 'Scanr Trading' },
        timestamp: new Date().toISOString(),
    };
}

function pktTime() {
    return new Date(Date.now() + 5 * 3600000).toISOString().replace('T', ' ').slice(0, 19) + ' PKT';
}

function stratBotStartEmbed(data) {
    return {
        title:  '🤖 Strategy Bot Started',
        color:  0x3b82f6,
        fields: [
            { name: 'Strategy',  value: data.strategyName || 'Unknown',  inline: true },
            { name: 'Timeframe', value: data.timeframe || '—',           inline: true },
            { name: 'Coins',     value: String(data.coinCount || 0),     inline: true },
            { name: 'Time',      value: pktTime(),                       inline: false },
        ],
        footer:    { text: 'Scanr Strategy Bot' },
        timestamp: new Date().toISOString(),
    };
}

function stratBotTradeEmbed(data) {
    const isLong = data.direction === 'LONG';
    const rr = (data.sl != null && data.tp != null && data.entryPrice)
        ? Math.abs((data.tp - data.entryPrice) / (data.entryPrice - data.sl)).toFixed(2)
        : '—';
    return {
        title:  isLong ? '📈 Bot Trade Opened — LONG' : '📉 Bot Trade Opened — SHORT',
        color:  isLong ? 0x22c55e : 0xef4444,
        fields: [
            { name: 'Coin',          value: data.symbol || '—',                      inline: true },
            { name: 'Direction',     value: data.direction || '—',                   inline: true },
            { name: 'Entry Price',   value: String(data.entryPrice ?? '—'),          inline: true },
            { name: 'Stop Loss',     value: data.sl != null ? String(data.sl) : 'Not set', inline: true },
            { name: 'Take Profit',   value: data.tp != null ? String(data.tp) : 'Not set', inline: true },
            { name: 'RR',            value: String(rr),                              inline: true },
            { name: 'Position Size', value: String(data.qty ?? '—'),                 inline: true },
            { name: 'Strategy',      value: data.strategyName || '—',               inline: true },
            { name: 'Time',          value: pktTime(),                               inline: false },
        ],
        footer:    { text: 'Scanr Strategy Bot' },
        timestamp: new Date().toISOString(),
    };
}

function stratBotCloseEmbed(type, data) {
    const pnlStr    = data.pnl != null ? `${data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(4)} USDT` : '—';
    const pnlPctStr = data.pnlPct != null ? ` (${data.pnlPct >= 0 ? '+' : ''}${data.pnlPct.toFixed(2)}%)` : '';
    const meta = {
        tp_hit:       { title: '✅ Bot Trade — Take Profit Hit', color: 0x22c55e },
        sl_hit:       { title: '❌ Bot Trade — Stop Loss Hit',   color: 0xef4444 },
        manual_close: { title: '🔒 Bot Trade — Manually Closed', color: 0xf97316 },
    }[type] || { title: 'Bot Trade Closed', color: 0x6b7280 };
    return {
        title:  meta.title,
        color:  meta.color,
        fields: [
            { name: 'Coin',      value: data.symbol || '—',                    inline: true },
            { name: 'Direction', value: data.direction || '—',                 inline: true },
            { name: 'Entry',     value: String(data.entryPrice ?? '—'),        inline: true },
            { name: 'Exit',      value: String(data.exitPrice ?? '—'),         inline: true },
            { name: 'PnL',       value: pnlStr + pnlPctStr,                   inline: true },
            { name: 'Strategy',  value: data.strategyName || '—',             inline: true },
            { name: 'Time',      value: pktTime(),                             inline: false },
        ],
        footer:    { text: 'Scanr Strategy Bot' },
        timestamp: new Date().toISOString(),
    };
}

async function sendStrategyBotAlert(webhookUrl, type, data) {
    if (!webhookUrl) return;
    let embed;
    if (type === 'bot_start')   embed = stratBotStartEmbed(data);
    else if (type === 'trade_placed') embed = stratBotTradeEmbed(data);
    else if (['tp_hit', 'sl_hit', 'manual_close'].includes(type)) embed = stratBotCloseEmbed(type, data);
    else return;
    await sendDiscordAlert(webhookUrl, embed);
}

module.exports = { sendDiscordAlert, orderSummaryEmbed, positionClosedEmbed, autopilotMilestoneEmbed, priceAlertEmbed, sendStrategyBotAlert, sendAgentAlert };

// ── AI Day Trading Agent embeds ───────────────────────────────

function agentStartEmbed(data) {
    const coins = Array.isArray(data.coins) ? data.coins.join(', ') : (data.coins || '50+ coins');
    return {
        title:  '🧠 AI Agent Started',
        color:  0x3b82f6,
        fields: [
            { name: 'Mode',              value: data.mode || 'Live',                      inline: true },
            { name: 'Timeframe',         value: data.timeframe || '5m',                   inline: true },
            { name: 'Min Score',         value: String(data.minScore ?? 75),              inline: true },
            { name: 'Max Trades / Day',  value: String(data.maxTrades ?? 3),              inline: true },
            { name: 'Coins Scanning',    value: coins,                                    inline: false },
            { name: 'Time (PKT)',        value: pktTime(),                                inline: false },
        ],
        footer:    { text: 'Scanr AI Agent' },
        timestamp: new Date().toISOString(),
    };
}

function agentTradePlacedEmbed(data) {
    const isLong = (data.direction || '').toLowerCase() === 'long';
    const rr = (data.sl != null && data.tp != null && data.entry)
        ? Math.abs((data.tp - data.entry) / (data.entry - data.sl)).toFixed(2)
        : '—';
    const reasoning = data.reasoning
        ? (data.reasoning.length > 100 ? data.reasoning.slice(0, 100) + '…' : data.reasoning)
        : '—';
    return {
        title:  isLong ? '📈 AI Agent Trade Opened — LONG' : '📉 AI Agent Trade Opened — SHORT',
        color:  isLong ? 0x22c55e : 0xef4444,
        fields: [
            { name: 'Coin',             value: data.symbol || '—',                  inline: true },
            { name: 'Direction',        value: isLong ? 'LONG' : 'SHORT',           inline: true },
            { name: 'Confidence Score', value: String(data.score ?? '—'),           inline: true },
            { name: 'Entry Price',      value: String(data.entry ?? '—'),           inline: true },
            { name: 'Stop Loss',        value: String(data.sl ?? '—'),              inline: true },
            { name: 'Take Profit',      value: String(data.tp ?? '—'),              inline: true },
            { name: 'RR',               value: String(rr),                          inline: true },
            { name: 'Position Size',    value: String(data.qty ?? '—'),             inline: true },
            { name: 'AI Reasoning',     value: reasoning,                           inline: false },
            { name: 'Time (PKT)',       value: pktTime(),                           inline: false },
        ],
        footer:    { text: 'Scanr AI Agent' },
        timestamp: new Date().toISOString(),
    };
}

function agentTradeClosedEmbed(type, data) {
    const pnlStr    = data.pnl != null ? `${data.pnl >= 0 ? '+' : ''}${parseFloat(data.pnl).toFixed(4)} USDT` : '—';
    const pnlPctStr = data.pnlPercent != null ? ` (${data.pnlPercent >= 0 ? '+' : ''}${parseFloat(data.pnlPercent).toFixed(2)}%)` : '';
    const meta = type === 'tp_hit'
        ? { title: '✅ AI Agent — Take Profit Hit', color: 0x22c55e }
        : { title: '❌ AI Agent — Stop Loss Hit',   color: 0xef4444 };
    return {
        title:  meta.title,
        color:  meta.color,
        fields: [
            { name: 'Coin',             value: data.symbol || '—',                       inline: true },
            { name: 'Direction',        value: (data.direction || '').toUpperCase() || '—', inline: true },
            { name: 'Confidence Score', value: String(data.aiScore ?? '—'),              inline: true },
            { name: 'Entry',            value: String(data.entryPrice ?? '—'),           inline: true },
            { name: 'Exit',             value: String(data.closePrice ?? '—'),           inline: true },
            { name: 'PnL',              value: pnlStr + pnlPctStr,                       inline: true },
            { name: 'Time (PKT)',       value: pktTime(),                                inline: false },
        ],
        footer:    { text: 'Scanr AI Agent' },
        timestamp: new Date().toISOString(),
    };
}

async function sendAgentAlert(userId, type, data) {
    try {
        const settingsDoc = await Settings.findOne({ userId }).lean();
        const webhookUrl  = settingsDoc?.discord?.webhookUrl;
        if (!webhookUrl) return;
        if (settingsDoc?.discord?.alerts?.aiAgentAlerts === false) return;

        let embed;
        if (type === 'agent_start')   embed = agentStartEmbed(data);
        else if (type === 'trade_placed') embed = agentTradePlacedEmbed(data);
        else if (type === 'tp_hit' || type === 'sl_hit') embed = agentTradeClosedEmbed(type, data);
        else return;

        await sendDiscordAlert(webhookUrl, embed);
    } catch (e) {
        console.error('[AgentAlert] Discord send failed:', e.message);
    }
}
