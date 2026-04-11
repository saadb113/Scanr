'use strict';

const {
    calcEMASeries,
    calcRSI,
    calcATR,
    calcMACD,
    fetchCandles,
} = require('./utils/indicators');
const { SetupSignals } = require('./models');

const scanInProgressByUser = new Map();
const lastSignalsByUser = new Map();
const candleCache = new Map();
const CANDLE_CACHE_TTL_MS = 60 * 1000;
const SCAN_BATCH_SIZE = 20;

function normalizeUserId(userId) {
    return String(userId || 'default');
}

function setScanStatus(userId, inProgress) {
    const uid = normalizeUserId(userId);
    scanInProgressByUser.set(uid, !!inProgress);
}

function getScanStatus(userId) {
    const uid = normalizeUserId(userId);
    return !!scanInProgressByUser.get(uid);
}

async function saveLastSignals(userId, signals) {
    const uid = normalizeUserId(userId);
    const nextSignals = Array.isArray(signals) ? signals : [];
    lastSignalsByUser.set(uid, nextSignals);
    await SetupSignals.findOneAndUpdate(
        { userId: uid },
        { $set: { signals: nextSignals, lastScannedAt: new Date() } },
        { upsert: true, setDefaultsOnInsert: true }
    );
}

async function getLastSignals(userId) {
    const uid = normalizeUserId(userId);
    if (lastSignalsByUser.has(uid)) return lastSignalsByUser.get(uid) || [];
    const doc = await SetupSignals.findOne({ userId: uid }).lean();
    const signals = Array.isArray(doc?.signals) ? doc.signals : [];
    lastSignalsByUser.set(uid, signals);
    return signals;
}

async function clearLastSignals(userId) {
    const uid = normalizeUserId(userId);
    lastSignalsByUser.set(uid, []);
    await SetupSignals.findOneAndUpdate(
        { userId: uid },
        { $set: { signals: [], lastScannedAt: null } },
        { upsert: true, setDefaultsOnInsert: true }
    );
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function calcVolumeMA(volumes, period = 20) {
    if (!volumes.length) return 0;
    if (volumes.length < period) {
        return volumes.reduce((a, b) => a + b, 0) / volumes.length;
    }
    const slice = volumes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function detectVolumeTrend(volumes) {
    if (volumes.length < 5) return 'mixed';
    const last5 = volumes.slice(-5);
    const increasing = last5.every((v, i) => i === 0 || v > last5[i - 1]);
    const decreasing = last5.every((v, i) => i === 0 || v < last5[i - 1]);
    if (increasing) return 'increasing';
    if (decreasing) return 'decreasing';
    return 'mixed';
}

function detectRSIDivergence(closes, rsiValues) {
    if (closes.length < 5 || rsiValues.length < 5) return 'none';
    const minCloseIndex = closes.indexOf(Math.min(...closes));
    const maxCloseIndex = closes.indexOf(Math.max(...closes));
    const minRSIIndex = rsiValues.indexOf(Math.min(...rsiValues));
    const maxRSIIndex = rsiValues.indexOf(Math.max(...rsiValues));
    if (minCloseIndex > maxCloseIndex && minRSIIndex < maxRSIIndex) return 'bullish';
    if (maxCloseIndex > minCloseIndex && maxRSIIndex < minRSIIndex) return 'bearish';
    return 'none';
}

function toMacdWithCross(macdObj) {
    if (!macdObj) return { value: 0, signal: 0, histogram: 0, cross: 'none' };
    const currMacd = macdObj.macd ?? 0;
    const currSignal = macdObj.signal ?? 0;
    const currHist = macdObj.hist ?? 0;
    const prevHist = macdObj.histPrev ?? currHist;
    let cross = 'none';
    if (prevHist < 0 && currHist > 0) cross = 'bullish';
    if (prevHist > 0 && currHist < 0) cross = 'bearish';
    return {
        value: currMacd,
        signal: currSignal,
        histogram: currHist,
        cross,
    };
}

async function fetchJsonWithTimeout(url, timeoutMs = 10000) {
    const res = await Promise.race([
        fetch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs)),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function getTopSymbols() {
    const data = await fetchJsonWithTimeout('https://fapi.binance.com/fapi/v1/exchangeInfo', 10000);
    return data.symbols
        .filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING' && s.contractType === 'PERPETUAL')
        .map(s => s.symbol);
}

async function get24hrStats(symbols) {
    const data = await fetchJsonWithTimeout('https://fapi.binance.com/fapi/v1/ticker/24hr', 12000);
    const symbolSet = new Set(symbols);
    return data
        .filter(t => symbolSet.has(t.symbol))
        .map(t => ({
            symbol: t.symbol,
            priceChangePercent: parseFloat(t.priceChangePercent),
            quoteVolume: parseFloat(t.quoteVolume || t.volume || 0),
            lastPrice: parseFloat(t.lastPrice),
            highPrice: parseFloat(t.highPrice),
            lowPrice: parseFloat(t.lowPrice),
        }));
}

function runAllFilters(statsArray, options = {}) {
    const minVolumeUSDT = options.minVolumeUSDT ?? 50000000;
    const minChangePercent = options.minChangePercent ?? 2;
    const minVolatilityPercent = options.minVolatilityPercent ?? 3;
    const maxSpreadPercent = options.maxSpreadPercent ?? 15;
    const maxCoins = options.maxCoins ?? 50;

    let filtered = statsArray.filter(stat => stat.quoteVolume >= minVolumeUSDT);
    filtered = filtered.filter(stat => Math.abs(stat.priceChangePercent) >= minChangePercent);
    filtered = filtered.filter(stat => (((stat.highPrice - stat.lowPrice) / stat.lowPrice) * 100) >= minVolatilityPercent);
    filtered = filtered.filter(stat => (((stat.highPrice - stat.lowPrice) / stat.lastPrice) * 100) <= maxSpreadPercent);
    filtered.sort((a, b) => b.quoteVolume - a.quoteVolume);
    return filtered.slice(0, maxCoins);
}

async function calculateAllIndicators(symbol, candles1h, candles4h) {
    const closes1h = candles1h.map(c => c.close);
    const highs1h = candles1h.map(c => c.high);
    const lows1h = candles1h.map(c => c.low);
    const volumes1h = candles1h.map(c => c.volume);

    const closes4h = candles4h.map(c => c.close);
    const highs4h = candles4h.map(c => c.high);
    const lows4h = candles4h.map(c => c.low);
    const volumes4h = candles4h.map(c => c.volume);

    const ema20_1h = calcEMASeries(closes1h, 20);
    const ema50_1h = calcEMASeries(closes1h, 50);
    const ema200_1h = calcEMASeries(closes1h, 200);
    const rsi1h = calcRSI(closes1h, 14);
    const macd1h = toMacdWithCross(calcMACD(closes1h));
    const atr1h = calcATR(candles1h, 14);
    const volumeMA1h = calcVolumeMA(volumes1h, 20);
    const volumeRatio1h = volumeMA1h > 0 ? volumes1h[volumes1h.length - 1] / volumeMA1h : 0;
    const volumeSpike1h = volumeRatio1h > 1.2;
    const volumeTrend1h = detectVolumeTrend(volumes1h);
    const rsiSeries1h = [];
    for (let i = closes1h.length - 5; i < closes1h.length; i++) {
        if (i >= 0) rsiSeries1h.push(calcRSI(closes1h.slice(0, i + 1), 14));
    }
    const rsiDivergence1h = detectRSIDivergence(closes1h.slice(-5), rsiSeries1h.length === 5 ? rsiSeries1h : [50, 50, 50, 50, 50]);

    const ema20_4h = calcEMASeries(closes4h, 20);
    const ema50_4h = calcEMASeries(closes4h, 50);
    const ema200_4h = calcEMASeries(closes4h, 200);
    const rsi4h = calcRSI(closes4h, 14);
    const macd4h = toMacdWithCross(calcMACD(closes4h));
    const atr4h = calcATR(candles4h, 14);
    const volumeMA4h = calcVolumeMA(volumes4h, 20);
    const volumeRatio4h = volumeMA4h > 0 ? volumes4h[volumes4h.length - 1] / volumeMA4h : 0;
    const volumeSpike4h = volumeRatio4h > 1.2;
    const volumeTrend4h = detectVolumeTrend(volumes4h);
    const rsiSeries4h = [];
    for (let i = closes4h.length - 5; i < closes4h.length; i++) {
        if (i >= 0) rsiSeries4h.push(calcRSI(closes4h.slice(0, i + 1), 14));
    }
    const rsiDivergence4h = detectRSIDivergence(closes4h.slice(-5), rsiSeries4h.length === 5 ? rsiSeries4h : [50, 50, 50, 50, 50]);

    return {
        symbol,
        timeframes: {
            '1h': {
                ema20: ema20_1h[ema20_1h.length - 1],
                ema50: ema50_1h[ema50_1h.length - 1],
                ema200: ema200_1h[ema200_1h.length - 1],
                rsi: rsi1h,
                macd: macd1h,
                atr: atr1h,
                volumeMA: volumeMA1h,
                currentVolume: volumes1h[volumes1h.length - 1],
                volumeSpike: volumeSpike1h,
                volumeRatio: volumeRatio1h,
                volumeTrend: volumeTrend1h,
                rsiDivergence: rsiDivergence1h,
                currentClose: closes1h[closes1h.length - 1],
                highs: highs1h,
                lows: lows1h,
            },
            '4h': {
                ema20: ema20_4h[ema20_4h.length - 1],
                ema50: ema50_4h[ema50_4h.length - 1],
                ema200: ema200_4h[ema200_4h.length - 1],
                rsi: rsi4h,
                macd: macd4h,
                atr: atr4h,
                volumeMA: volumeMA4h,
                currentVolume: volumes4h[volumes4h.length - 1],
                volumeSpike: volumeSpike4h,
                volumeRatio: volumeRatio4h,
                volumeTrend: volumeTrend4h,
                rsiDivergence: rsiDivergence4h,
                currentClose: closes4h[closes4h.length - 1],
                highs: highs4h,
                lows: lows4h,
            },
        },
    };
}

async function runIndicatorsForAll(filteredCoins, io, userId, progressStart, progressSpan) {
    const results = [];
    const totalCoins = filteredCoins.length || 1;
    const totalBatches = Math.max(1, Math.ceil(filteredCoins.length / SCAN_BATCH_SIZE));
    for (let i = 0; i < filteredCoins.length; i += SCAN_BATCH_SIZE) {
        const batchIndex = Math.floor(i / SCAN_BATCH_SIZE);
        const batch = filteredCoins.slice(i, i + SCAN_BATCH_SIZE);
        const settled = await Promise.allSettled(batch.map(async (coin) => {
            const [candles1h, candles4h] = await Promise.all([
                fetchCandlesCached(coin.symbol, '1h', 250),
                fetchCandlesCached(coin.symbol, '4h', 250),
            ]);
            return calculateAllIndicators(coin.symbol, candles1h, candles4h);
        }));
        settled.forEach(r => {
            if (r.status === 'fulfilled' && r.value) results.push(r.value);
        });
        const done = Math.min(i + SCAN_BATCH_SIZE, filteredCoins.length);
        const p = progressStart + Math.round((done / totalCoins) * progressSpan);
        io.to(userId).emit('apex:progress', {
            step: `Scanning batch ${batchIndex + 1}/${totalBatches}... Analyzed: ${done}/${filteredCoins.length} coins`,
            progress: p,
        });
        if (done < filteredCoins.length) await sleep(200);
    }
    return results;
}

async function fetchCandlesCached(symbol, interval, limit = 250) {
    const key = `${symbol}_${interval}_${limit}`;
    const now = Date.now();
    const cached = candleCache.get(key);
    if (cached && now - cached.fetchedAt < CANDLE_CACHE_TTL_MS) {
        return cached.data;
    }
    const data = await fetchCandles(symbol, interval, limit);
    candleCache.set(key, { data, fetchedAt: now });
    return data;
}

function scoreTrend(indicators) {
    let score = 0;
    const tf1h = indicators.timeframes['1h'];
    const tf4h = indicators.timeframes['4h'];
    if (tf4h.currentClose !== null && tf4h.ema200 !== null && tf4h.currentClose > tf4h.ema200) score += 10;
    if (tf4h.ema20 !== null && tf4h.ema50 !== null && tf4h.ema20 > tf4h.ema50) score += 10;
    if (tf1h.currentClose !== null && tf1h.ema200 !== null && tf1h.currentClose > tf1h.ema200) score += 10;
    return { score: Math.min(score, 30), maxScore: 30 };
}

function scoreMomentum(indicators) {
    let score = 0;
    const tf1h = indicators.timeframes['1h'];
    const tf4h = indicators.timeframes['4h'];
    if (tf1h.rsi !== null && tf1h.rsi >= 50 && tf1h.rsi <= 70) score += 8;
    if (tf1h.rsi !== null && tf1h.rsi >= 30 && tf1h.rsi < 50) score += 8;
    if (tf1h.macd && (tf1h.macd.cross === 'bullish' || tf1h.macd.cross === 'bearish')) score += 8;
    if (tf1h.rsiDivergence === 'bullish' || tf1h.rsiDivergence === 'bearish') score += 5;
    if (tf4h.rsi !== null && ((tf4h.rsi >= 45 && tf4h.rsi <= 70) || (tf4h.rsi >= 30 && tf4h.rsi <= 55))) score += 4;
    return { score: Math.min(score, 25), maxScore: 25 };
}

function scoreVolume(indicators) {
    let score = 0;
    const tf1h = indicators.timeframes['1h'];
    const tf4h = indicators.timeframes['4h'];
    if (tf1h.volumeSpike === true) score += 10;
    if (tf1h.volumeRatio !== null && tf1h.volumeRatio > 1.0) score += 7;
    if (tf1h.volumeTrend === 'increasing') score += 5;
    if (tf4h.volumeSpike === true) score += 10;
    if (tf4h.volumeRatio !== null && tf4h.volumeRatio > 1.0) score += 5;
    return { score: Math.min(score, 20), maxScore: 20 };
}

function scoreSentiment(fundingRate, openInterest) {
    let score = 0;
    if (fundingRate !== null && fundingRate !== undefined) {
        if (fundingRate < -0.0001) score += 8;
        else if (fundingRate > 0.0005) score += 6;
        else if (fundingRate >= -0.0001 && fundingRate <= 0.0001) score += 4;
    }
    if (openInterest !== null && openInterest !== undefined) {
        if (openInterest > 1000000) score += 7;
        else if (openInterest > 100000) score += 4;
    }
    return { score: Math.min(score, 15), maxScore: 15 };
}

function scoreStructure(indicators) {
    let score = 0;
    const tf1h = indicators.timeframes['1h'];
    const tf4h = indicators.timeframes['4h'];
    if (tf1h.rsi !== null && tf1h.rsi >= 28 && tf1h.rsi <= 35) score += 5;
    if (tf1h.rsi !== null && tf1h.rsi >= 65 && tf1h.rsi <= 72) score += 5;
    if (tf1h.macd && tf1h.macd.hist !== null && Math.abs(tf1h.macd.hist) > 0) score += 5;
    if (tf4h.rsi !== null && tf4h.rsi >= 28 && tf4h.rsi <= 38) score += 5;
    if (tf4h.rsi !== null && tf4h.rsi >= 62 && tf4h.rsi <= 72) score += 5;
    return { score: Math.min(score, 10), maxScore: 10 };
}

function gradeFromScore(totalScore) {
    if (totalScore >= 90) return 'A+';
    if (totalScore >= 80) return 'A';
    if (totalScore >= 70) return 'B';
    if (totalScore >= 60) return 'C';
    if (totalScore >= 50) return 'D';
    return 'F';
}

function scoreOneCoin(indicators, fundingRate, openInterest) {
    const trend = scoreTrend(indicators);
    const momentum = scoreMomentum(indicators);
    const volume = scoreVolume(indicators);
    const sentiment = scoreSentiment(fundingRate, openInterest);
    const structure = scoreStructure(indicators);
    const totalScore = trend.score + momentum.score + volume.score + sentiment.score + structure.score;
    return {
        symbol: indicators.symbol,
        totalScore,
        grade: gradeFromScore(totalScore),
        breakdown: { trend, momentum, volume, sentiment, structure },
        indicators: {
            rsi1h: indicators.timeframes['1h'].rsi,
            rsi4h: indicators.timeframes['4h'].rsi,
            macdCross1h: indicators.timeframes['1h'].macd ? indicators.timeframes['1h'].macd.cross : 'none',
            volumeSpike1h: indicators.timeframes['1h'].volumeSpike,
            rsiDivergence1h: indicators.timeframes['1h'].rsiDivergence,
            currentClose: indicators.timeframes['1h'].currentClose,
            atr1h: indicators.timeframes['1h'].atr,
            atr4h: indicators.timeframes['4h'].atr,
        },
    };
}

function scoreAllCoins(indicatorResults, fundingRates, openInterests) {
    const scored = indicatorResults.map(r => scoreOneCoin(r, fundingRates[r.symbol] ?? null, openInterests[r.symbol] ?? null));
    scored.sort((a, b) => b.totalScore - a.totalScore);
    return scored;
}

function determineTrendDirection(indicators) {
    let bullishPoints = 0;
    let bearishPoints = 0;
    const tf1h = indicators.timeframes['1h'];
    const tf4h = indicators.timeframes['4h'];
    if (tf4h.currentClose !== null && tf4h.ema200 !== null) tf4h.currentClose > tf4h.ema200 ? bullishPoints += 3 : bearishPoints += 3;
    if (tf4h.ema20 !== null && tf4h.ema50 !== null) tf4h.ema20 > tf4h.ema50 ? bullishPoints += 2 : bearishPoints += 2;
    if (tf1h.currentClose !== null && tf1h.ema200 !== null) tf1h.currentClose > tf1h.ema200 ? bullishPoints += 2 : bearishPoints += 2;
    if (tf1h.currentClose !== null && tf1h.ema20 !== null) tf1h.currentClose > tf1h.ema20 ? bullishPoints += 1 : bearishPoints += 1;
    if (tf1h.rsi !== null) tf1h.rsi > 50 ? bullishPoints += 2 : bearishPoints += 2;
    if (tf4h.rsi !== null) tf4h.rsi > 50 ? bullishPoints += 2 : bearishPoints += 2;
    let direction = 'neutral';
    if (bullishPoints > bearishPoints + 3) direction = 'bullish';
    else if (bearishPoints > bullishPoints + 3) direction = 'bearish';
    const winningPoints = Math.max(bullishPoints, bearishPoints);
    const strength = winningPoints >= 10 ? 'strong' : (winningPoints >= 7 ? 'moderate' : 'weak');
    return { direction, strength, bullishPoints, bearishPoints };
}

function determineMomentumDirection(indicators) {
    const tf1h = indicators.timeframes['1h'];
    const tf4h = indicators.timeframes['4h'];
    let direction = 'neutral';
    let signal = 'No clear momentum signal';
    if (tf1h.macd && tf1h.macd.cross === 'bullish' && tf1h.rsi !== null && tf1h.rsi > 45) {
        direction = 'bullish';
        signal = 'MACD bullish cross + RSI confirmation';
    }
    if (tf1h.macd && tf1h.macd.cross === 'bearish' && tf1h.rsi !== null && tf1h.rsi < 55) {
        direction = 'bearish';
        signal = 'MACD bearish cross + RSI confirmation';
    }
    if (tf1h.rsiDivergence === 'bullish') {
        direction = 'bullish';
        signal = 'RSI bullish divergence (reversal signal)';
    }
    if (tf1h.rsiDivergence === 'bearish') {
        direction = 'bearish';
        signal = 'RSI bearish divergence (reversal signal)';
    }
    if (tf1h.rsi !== null && tf4h.rsi !== null && tf1h.rsi > 55 && tf4h.rsi > 55) {
        direction = 'bullish';
        signal = 'Both timeframes showing bullish RSI';
    }
    if (tf1h.rsi !== null && tf4h.rsi !== null && tf1h.rsi < 45 && tf4h.rsi < 45) {
        direction = 'bearish';
        signal = 'Both timeframes showing bearish RSI';
    }
    return { direction, signal };
}

function determineFinalDirection(indicators, scoredCoin, fundingRate) {
    const trendDirection = determineTrendDirection(indicators);
    const momentumDirection = determineMomentumDirection(indicators);
    const tf1h = indicators.timeframes['1h'];
    const tf4h = indicators.timeframes['4h'];
    const warnings = [];
    const reasons = [];
    let finalDirection = 'NO TRADE';
    let confidence = 'LOW';
    if (tf1h.rsi !== null && tf1h.rsi < 30) warnings.push('RSI oversold, wait for confirmation');
    if (tf1h.rsi !== null && tf1h.rsi > 70) warnings.push('RSI overbought, watch for reversal');
    if (tf1h.volumeRatio !== null && tf1h.volumeRatio < 0.8) warnings.push('Volume below average, signal may be weak');
    if (trendDirection.direction !== 'neutral' && tf1h.rsi !== null && tf4h.rsi !== null) {
        const tf1hBullish = tf1h.rsi > 50;
        const tf4hBullish = tf4h.rsi > 50;
        if (tf1hBullish !== tf4hBullish) warnings.push('Conflicting timeframes');
    }
    const totalScore = scoredCoin.totalScore;
    if (
        (trendDirection.direction === 'bullish' && momentumDirection.direction === 'bullish') ||
        (trendDirection.direction === 'bullish' && tf1h.rsiDivergence === 'bullish') ||
        (fundingRate !== null && fundingRate < -0.0003 && trendDirection.direction !== 'bearish')
    ) {
        finalDirection = 'LONG';
        if (trendDirection.direction === 'bullish') reasons.push(`Bullish trend (${trendDirection.strength})`);
        if (momentumDirection.direction === 'bullish') reasons.push(`Bullish momentum (${momentumDirection.signal})`);
        if (fundingRate !== null && fundingRate < -0.0003) reasons.push(`Negative funding rate (${(fundingRate * 100).toFixed(4)}%)`);
    } else if (
        (trendDirection.direction === 'bearish' && momentumDirection.direction === 'bearish') ||
        (trendDirection.direction === 'bearish' && tf1h.rsiDivergence === 'bearish') ||
        (fundingRate !== null && fundingRate > 0.0005 && trendDirection.direction !== 'bullish')
    ) {
        finalDirection = 'SHORT';
        if (trendDirection.direction === 'bearish') reasons.push(`Bearish trend (${trendDirection.strength})`);
        if (momentumDirection.direction === 'bearish') reasons.push(`Bearish momentum (${momentumDirection.signal})`);
        if (fundingRate !== null && fundingRate > 0.0005) reasons.push(`Positive funding rate (${(fundingRate * 100).toFixed(4)}%)`);
    } else if (
        trendDirection.direction === 'neutral' ||
        (trendDirection.direction !== momentumDirection.direction && momentumDirection.direction !== 'neutral') ||
        totalScore < 40
    ) {
        finalDirection = 'NO TRADE';
    }
    if (trendDirection.strength === 'strong' && trendDirection.direction === momentumDirection.direction && totalScore > 65) {
        confidence = 'HIGH';
    } else if (trendDirection.direction === momentumDirection.direction && totalScore > 50) {
        confidence = 'MEDIUM';
    }
    const setupParts = [];
    if (trendDirection.direction !== 'neutral') setupParts.push(`${trendDirection.direction} trend`);
    if (momentumDirection.direction !== 'neutral') setupParts.push(momentumDirection.signal);
    if (fundingRate !== null) {
        if (fundingRate < -0.0003) setupParts.push('negative funding');
        else if (fundingRate > 0.0005) setupParts.push('positive funding');
    }
    const tradeSetup = setupParts.length > 0 ? setupParts.join(' + ') : 'Mixed signals';
    return { finalDirection, confidence, tradeSetup, reasons, warnings };
}

function runDirectionForAll(scoredCoins, indicatorResults, fundingRates) {
    const out = [];
    for (const coin of scoredCoins) {
        const indicators = indicatorResults.find(i => i.symbol === coin.symbol);
        if (!indicators) continue;
        const direction = determineFinalDirection(indicators, coin, fundingRates[coin.symbol] ?? null);
        out.push({ ...coin, direction });
    }
    const tradeable = out.filter(c => c.direction.finalDirection !== 'NO TRADE');
    const confidenceOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    tradeable.sort((a, b) => {
        const confA = confidenceOrder[a.direction.confidence] || 0;
        const confB = confidenceOrder[b.direction.confidence] || 0;
        if (confA !== confB) return confB - confA;
        return b.totalScore - a.totalScore;
    });
    return tradeable;
}

function roundPrice(price) {
    if (price > 1000) return Math.round(price * 100) / 100;
    if (price > 1) return Math.round(price * 10000) / 10000;
    if (price > 0.001) return Math.round(price * 1000000) / 1000000;
    return Math.round(price * 100000000) / 100000000;
}

function calculateEntryPrice(indicators) {
    return roundPrice(indicators.timeframes['1h'].currentClose || 0);
}

function calculateStopLoss(indicators, direction, atrMultiplier = 1.5) {
    const entry = calculateEntryPrice(indicators);
    if (!entry) return 0;
    const atr1h = indicators.timeframes['1h'].atr;
    const stopDistance = atr1h && atr1h > 0 ? atr1h * atrMultiplier : entry * 0.01;
    const stop = direction === 'LONG' ? entry - stopDistance : entry + stopDistance;
    return roundPrice(stop);
}

function calculateTakeProfit(entry, stopLoss, direction, rrRatio = 1.5) {
    if (!entry || !stopLoss) return 0;
    const risk = Math.abs(entry - stopLoss);
    const reward = risk * rrRatio;
    const tp = direction === 'LONG' ? entry + reward : entry - reward;
    return roundPrice(tp);
}

function calculatePositionSize(accountSize, riskPercent, entry, stopLoss) {
    if (!accountSize || !entry || !stopLoss || entry === stopLoss) {
        return { positionSize: 0, riskAmount: 0, rewardAmount: 0, stopDistancePercent: 0 };
    }
    const riskAmount = accountSize * (riskPercent / 100);
    const stopDistance = Math.abs(entry - stopLoss);
    const stopDistancePercent = (stopDistance / entry) * 100;
    const positionSize = parseFloat((riskAmount / stopDistance).toFixed(8));
    return {
        positionSize: Math.round(positionSize * 100000000) / 100000000,
        riskAmount: Math.round(riskAmount * 100) / 100,
        rewardAmount: 0,
        stopDistancePercent: Math.round(stopDistancePercent * 100) / 100,
    };
}

function generateSignal(directionResult, indicators, accountSize = 1000, riskPercent = 1, rrRatio = 1.5) {
    const dir = directionResult.direction || directionResult;
    const direction = dir.finalDirection || 'NO TRADE';
    const confidence = dir.confidence || 'LOW';
    const entry = calculateEntryPrice(indicators);
    const stopLoss = calculateStopLoss(indicators, direction);
    const takeProfit = calculateTakeProfit(entry, stopLoss, direction, rrRatio);
    const pos = calculatePositionSize(accountSize, riskPercent, entry, stopLoss);
    const potentialProfit = Math.abs(takeProfit - entry);
    const rewardAmount = pos.positionSize * potentialProfit;
    return {
        symbol: directionResult.symbol,
        direction,
        confidence,
        score: directionResult.totalScore,
        grade: directionResult.grade,
        entry,
        stopLoss,
        takeProfit,
        stopDistancePercent: pos.stopDistancePercent,
        rewardDistancePercent: entry ? parseFloat((((Math.abs(takeProfit - entry)) / entry) * 100).toFixed(2)) : 0,
        positionSize: pos.positionSize,
        riskAmount: pos.riskAmount,
        rewardAmount: Math.round(rewardAmount * 100) / 100,
        rrRatio,
        setup: dir.tradeSetup || 'Mixed signals',
        reasons: dir.reasons || [],
        warnings: dir.warnings || [],
        indicators: {
            rsi1h: directionResult.indicators.rsi1h,
            rsi4h: directionResult.indicators.rsi4h,
            macdCross: directionResult.indicators.macdCross1h,
            volSpike: directionResult.indicators.volumeSpike1h,
            volumeSpike: directionResult.indicators.volumeSpike1h,
            rsiDivergence: directionResult.indicators.rsiDivergence1h,
            fundingRate: null,
            openInterest: null,
        },
    };
}

function generateAllSignals(directionResults, indicatorResults, options = {}) {
    const accountSize = options.accountSize ?? 1000;
    const riskPercent = options.riskPercent ?? 1;
    const rrRatio = options.rrRatio ?? 1.5;
    const minScore = options.minScore ?? 40;
    const minConfidence = options.minConfidence ?? 'LOW';
    const confidenceRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const signals = [];
    for (const d of directionResults) {
        const indicators = indicatorResults.find(ir => ir.symbol === d.symbol);
        if (!indicators) continue;
        const s = generateSignal(d, indicators, accountSize, riskPercent, rrRatio);
        if (s.score < minScore) continue;
        if ((confidenceRank[s.confidence] || 0) < (confidenceRank[minConfidence] || 0)) continue;
        signals.push(s);
    }
    signals.sort((a, b) => b.score - a.score);
    return signals;
}

async function getFundingRate(symbol) {
    try {
        const data = await fetchJsonWithTimeout(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`, 5000);
        return data && data.length ? parseFloat(data[0].fundingRate) : null;
    } catch {
        return null;
    }
}

async function getOpenInterest(symbol) {
    try {
        const data = await fetchJsonWithTimeout(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, 5000);
        return data ? parseFloat(data.openInterest) : null;
    } catch {
        return null;
    }
}

async function runFundingAndOIForAll(testCoins, io, userId, progressStart, progressSpan) {
    const fundingRates = {};
    const openInterests = {};
    const totalCoins = testCoins.length || 1;
    const totalBatches = Math.max(1, Math.ceil(testCoins.length / SCAN_BATCH_SIZE));
    for (let i = 0; i < testCoins.length; i += SCAN_BATCH_SIZE) {
        const batchIndex = Math.floor(i / SCAN_BATCH_SIZE);
        const batch = testCoins.slice(i, i + SCAN_BATCH_SIZE);
        const settled = await Promise.allSettled(batch.map(async (coin) => {
            const [fundingRate, openInterest] = await Promise.all([
                getFundingRate(coin.symbol),
                getOpenInterest(coin.symbol),
            ]);
            return { symbol: coin.symbol, fundingRate, openInterest };
        }));
        settled.forEach(r => {
            if (r.status === 'fulfilled' && r.value) {
                fundingRates[r.value.symbol] = r.value.fundingRate;
                openInterests[r.value.symbol] = r.value.openInterest;
            }
        });
        const done = Math.min(i + SCAN_BATCH_SIZE, testCoins.length);
        const p = progressStart + Math.round((done / totalCoins) * progressSpan);
        io.to(userId).emit('apex:progress', {
            step: `Funding/OI batch ${batchIndex + 1}/${totalBatches}... Analyzed: ${done}/${testCoins.length} coins`,
            progress: p,
        });
        if (done < testCoins.length) await sleep(200);
    }
    return { fundingRates, openInterests };
}

async function runApexScanner(io, userId, options = {}) {
    const uid = normalizeUserId(userId);
    const coins = parseInt(options.coins, 10) || 50;
    const accountSize = parseFloat(options.accountSize) || 1000;
    const riskPercent = parseFloat(options.riskPercent) || 1;
    const rrRatio = parseFloat(options.rrRatio) || 1.5;
    const minScore = parseInt(options.minScore, 10) || 35;
    const scanStartedAt = Date.now();

    if (getScanStatus(uid)) return getLastSignals(uid);
    setScanStatus(uid, true);

    const scanTimeout = setTimeout(() => {
        setScanStatus(uid, false);
        io.to(uid).emit('apex:error', { error: 'Scan timeout: exceeded 3 minutes' });
    }, 180000);

    try {
        io.to(uid).emit('apex:progress', { step: 'Step 1/8: Fetching symbols...', progress: 5 });
        const symbols = await getTopSymbols();
        if (!symbols.length) throw new Error('No symbols fetched');

        io.to(uid).emit('apex:progress', { step: 'Step 2/8: Fetching 24h stats...', progress: 12 });
        const allStats = await get24hrStats(symbols);

        io.to(uid).emit('apex:progress', { step: 'Step 3/8: Running pre-filter...', progress: 20 });
        const filtered = runAllFilters(allStats, {
            minVolumeUSDT: 50000000,
            minChangePercent: 2,
            minVolatilityPercent: 3,
            maxSpreadPercent: 15,
            maxCoins: Math.max(coins, 50),
        });
        let testCoins = filtered.slice(0, coins);
        if (testCoins.length < coins) {
            const picked = new Set(testCoins.map(c => c.symbol));
            const fallback = allStats
                .slice()
                .sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0))
                .filter(c => !picked.has(c.symbol))
                .slice(0, coins - testCoins.length);
            testCoins = testCoins.concat(fallback);
        }
        if (!testCoins.length) {
            await saveLastSignals(uid, []);
            io.to(uid).emit('apex:done', { signals: [], count: 0 });
            setScanStatus(uid, false);
            clearTimeout(scanTimeout);
            return [];
        }

        io.to(uid).emit('apex:progress', { step: `Step 4/8: Indicators for ${testCoins.length} coins...`, progress: 28 });
        const indicatorResults = await runIndicatorsForAll(testCoins, io, uid, 28, 27);

        io.to(uid).emit('apex:progress', { step: 'Step 5/8: Funding & OI...', progress: 60 });
        const { fundingRates, openInterests } = await runFundingAndOIForAll(testCoins, io, uid, 60, 10);

        io.to(uid).emit('apex:progress', { step: 'Step 6/8: Scoring coins...', progress: 72 });
        const scored = scoreAllCoins(indicatorResults, fundingRates, openInterests);

        io.to(uid).emit('apex:progress', { step: 'Step 7/8: Determining direction...', progress: 82 });
        const withDirection = runDirectionForAll(scored, indicatorResults, fundingRates);

        io.to(uid).emit('apex:progress', { step: 'Step 8/8: Generating signals...', progress: 92 });
        const signals = generateAllSignals(withDirection, indicatorResults, {
            accountSize,
            riskPercent,
            rrRatio,
            minScore,
            minConfidence: 'LOW',
        });

        for (const s of signals) {
            if (fundingRates[s.symbol] !== undefined && fundingRates[s.symbol] !== null) {
                s.indicators.fundingRate = parseFloat((fundingRates[s.symbol] * 100).toFixed(4));
            }
            if (openInterests[s.symbol] !== undefined) {
                s.indicators.openInterest = openInterests[s.symbol];
            }
        }

        await saveLastSignals(uid, signals);
        const durationSec = Math.max(1, Math.round((Date.now() - scanStartedAt) / 1000));
        io.to(uid).emit('apex:progress', { step: `Scan complete — found ${signals.length} signals in ${durationSec}s`, progress: 100 });
        io.to(uid).emit('apex:done', { signals, count: signals.length });
        setScanStatus(uid, false);
        clearTimeout(scanTimeout);
        return signals;
    } catch (err) {
        setScanStatus(uid, false);
        clearTimeout(scanTimeout);
        io.to(uid).emit('apex:error', { error: err.message });
        throw err;
    }
}

module.exports = {
    runApexScanner,
    getTopSymbols,
    get24hrStats,
    runAllFilters,
    runIndicatorsForAll,
    runFundingAndOIForAll,
    scoreAllCoins,
    runDirectionForAll,
    generateAllSignals,
    getScanStatus,
    getLastSignals,
    clearLastSignals,
};

