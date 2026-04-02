'use strict';

const ccxt = require('ccxt');

function normalizeExchangeName(name) {
    const v = String(name || '').toLowerCase();
    if (v === 'binance' || v === 'binanceusdm') return 'binance';
    return 'bybit';
}

function bybitToBinanceSymbol(bybitSymbol) {
    const s = String(bybitSymbol || '').toUpperCase().replace(/\s+/g, '');
    if (!s) return '';
    if (s.includes('/')) return s;
    if (s.endsWith('USDT')) {
        const base = s.slice(0, -4);
        return `${base}/USDT:USDT`;
    }
    return s;
}

function toExchangeSymbol(exchangeName, symbol) {
    const normalized = normalizeExchangeName(exchangeName);
    const s = String(symbol || '').toUpperCase().replace(/\s+/g, '');
    if (!s) return '';
    if (normalized === 'binance') return bybitToBinanceSymbol(s);
    return s.includes('/') ? s.replace('/', '').replace(':USDT', '') : s;
}

function fromExchangeSymbol(exchangeName, symbol) {
    const normalized = normalizeExchangeName(exchangeName);
    const s = String(symbol || '').toUpperCase();
    if (!s) return '';
    if (normalized === 'binance') {
        if (s.includes('/')) {
            const base = s.split('/')[0] || s;
            return `${base}USDT`;
        }
        return s;
    }
    return s;
}

function getExchange(exchangeName, apiKey, secret, testnet) {
    const name = normalizeExchangeName(exchangeName);
    const config = {
        apiKey,
        secret,
        enableRateLimit: true,
        options: { defaultType: 'future', adjustForTimeDifference: true },
    };

    if (name === 'bybit') {
        const ex = new ccxt.bybit(config);
        ex.options = { ...(ex.options || {}), adjustForTimeDifference: true };
        if (testnet) ex.setSandboxMode(true);
        return ex;
    }

    if (name === 'binance') {
        const ex = new ccxt.binanceusdm(config);
        ex.options = { ...(ex.options || {}), adjustForTimeDifference: true };
        if (testnet) {
            // Binance USD-M testnet via CCXT sandbox is deprecated.
            // Keep normal endpoints; users should use Binance demo trading keys/settings.
            ex.options = {
                ...(ex.options || {}),
                defaultType: 'future',
                adjustForTimeDifference: true,
            };
        }
        return ex;
    }

    throw new Error(`Unsupported exchange: ${exchangeName}`);
}

async function fetchBalance(exchange) {
    const balance = await exchange.fetchBalance();
    return {
        total: Number(balance?.USDT?.total || 0),
        available: Number(balance?.USDT?.free || 0),
        currency: 'USDT',
    };
}

async function placeMarketOrder(exchange, symbol, side, qty, sl, tp) {
    const params = {};
    if (sl && Number(sl) > 0) params.stopLoss = { price: Number(sl) };
    if (tp && Number(tp) > 0) params.takeProfit = { price: Number(tp) };

    return exchange.createOrder(
        symbol,
        'market',
        String(side || '').toLowerCase(),
        Number(qty),
        undefined,
        params
    );
}

async function fetchPositions(exchange) {
    const positions = await exchange.fetchPositions();
    return (positions || []).filter(p => Number(p.contracts || p.contractSize || 0) > 0);
}

async function fetchOpenOrders(exchange, symbol) {
    return exchange.fetchOpenOrders(symbol);
}

async function cancelOrder(exchange, orderId, symbol) {
    return exchange.cancelOrder(orderId, symbol);
}

async function setLeverage(exchange, symbol, leverage) {
    return exchange.setLeverage(Number(leverage), symbol);
}

async function fetchTicker(exchange, symbol) {
    return exchange.fetchTicker(symbol);
}

module.exports = {
    normalizeExchangeName,
    toExchangeSymbol,
    fromExchangeSymbol,
    getExchange,
    fetchBalance,
    placeMarketOrder,
    fetchPositions,
    fetchOpenOrders,
    cancelOrder,
    setLeverage,
    fetchTicker,
};
