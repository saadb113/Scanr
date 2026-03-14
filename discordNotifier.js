'use strict';

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

module.exports = { sendDiscordAlert, orderSummaryEmbed, positionClosedEmbed, autopilotMilestoneEmbed, priceAlertEmbed };
