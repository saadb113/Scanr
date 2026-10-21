import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, API_BASE } from '../api/client';
import PremiumGate from '../components/PremiumGate';
import Pagination from '../components/Pagination';
import './Strategy.css';

// Ported from public/js/strategy.js BLOCK_DEFS — the drag-and-drop block
// library + the rules for which canvas zones each block type may be dropped
// into ('filters' | 'conditions' | 'actions'; 'exit' validates as 'conditions').
const BLOCK_DEFS = {
  RSI: {
    label: 'RSI Value', icon: '📈', category: 'INDICATORS', zones: ['filters', 'conditions'],
    defaults: { period: 14, condition: '<', value: 30 },
    params: [
      { key: 'period', label: 'Period', type: 'number', min: 2, max: 500 },
      { key: 'condition', label: 'Condition', type: 'select', options: ['<', '>', '=', '<=', '>='] },
      { key: 'value', label: 'Value', type: 'number', min: 0, max: 100 },
    ],
    summary: (p) => `RSI(${p.period}) ${p.condition} ${p.value}`,
  },
  RSI_CROSS: {
    label: 'RSI Cross', icon: '📈', category: 'INDICATORS', zones: ['conditions'],
    defaults: { period: 14, level: 50, direction: 'cross_above' },
    params: [
      { key: 'period', label: 'Period', type: 'number', min: 2, max: 500 },
      { key: 'level', label: 'Level', type: 'number', min: 0, max: 100 },
      { key: 'direction', label: 'Direction', type: 'select', options: ['cross_above', 'cross_below'] },
    ],
    summary: (p) => `RSI(${p.period}) crosses ${p.direction === 'cross_above' ? 'above' : 'below'} ${p.level}`,
  },
  MACD_CROSS: {
    label: 'MACD Cross', icon: '📊', category: 'INDICATORS', zones: ['conditions'],
    defaults: { direction: 'bullish' },
    params: [{ key: 'direction', label: 'Direction', type: 'select', options: ['bullish', 'bearish'] }],
    summary: (p) => `MACD Cross ${p.direction}`,
  },
  MACD_HIST: {
    label: 'MACD Histogram', icon: '📊', category: 'INDICATORS', zones: ['filters', 'conditions'],
    defaults: { condition: 'above' },
    params: [{ key: 'condition', label: 'Histogram', type: 'select', options: ['above', 'below'] }],
    summary: (p) => `MACD Hist ${p.condition} zero`,
  },
  EMA_CROSS: {
    label: 'MA Cross', icon: '〰', category: 'INDICATORS', zones: ['conditions'],
    defaults: { maType: 'EMA', fastPeriod: 12, slowPeriod: 26, direction: 'above' },
    params: [
      { key: 'maType', label: 'MA Type', type: 'select', options: ['EMA', 'SMA'] },
      { key: 'fastPeriod', label: 'Fast Period', type: 'number', min: 1, max: 500 },
      { key: 'slowPeriod', label: 'Slow Period', type: 'number', min: 1, max: 500 },
      { key: 'direction', label: 'Fast MA is', type: 'select', options: ['above', 'below'] },
    ],
    summary: (p) => `${p.maType || 'EMA'}(${p.fastPeriod}) ${p.direction} ${p.maType || 'EMA'}(${p.slowPeriod})`,
  },
  PRICE_EMA: {
    label: 'Price vs MA', icon: '〰', category: 'INDICATORS', zones: ['filters', 'conditions'],
    defaults: { maType: 'EMA', period: 200, direction: 'above' },
    params: [
      { key: 'maType', label: 'MA Type', type: 'select', options: ['EMA', 'SMA'] },
      { key: 'period', label: 'Period', type: 'number', min: 1, max: 500 },
      { key: 'direction', label: 'Price is', type: 'select', options: ['above', 'below'] },
    ],
    summary: (p) => `Price ${p.direction} ${p.maType || 'EMA'}(${p.period})`,
  },
  BB: {
    label: 'Bollinger Band', icon: '🎯', category: 'INDICATORS', zones: ['conditions'],
    defaults: { period: 20, condition: 'below_lower' },
    params: [
      { key: 'period', label: 'Period', type: 'number', min: 2, max: 200 },
      { key: 'condition', label: 'Price', type: 'select', options: ['above_upper', 'below_lower'] },
    ],
    summary: (p) => `Price ${p.condition.replace('_', ' ')} BB(${p.period})`,
  },
  VOLUME_SPIKE: {
    label: 'Volume Spike', icon: '🔊', category: 'INDICATORS', zones: ['filters', 'conditions'],
    defaults: { multiplier: 2 },
    params: [{ key: 'multiplier', label: 'X times avg', type: 'number', min: 1, max: 20 }],
    summary: (p) => `Volume ≥ ${p.multiplier}× avg`,
  },
  ATR: {
    label: 'ATR Value', icon: '📏', category: 'INDICATORS', zones: ['filters', 'conditions'],
    defaults: { period: 14, condition: '>', value: 0.5 },
    params: [
      { key: 'period', label: 'Period', type: 'number', min: 1, max: 100 },
      { key: 'condition', label: 'Condition', type: 'select', options: ['>', '<', '>=', '<='] },
      { key: 'value', label: 'Value', type: 'number', min: 0, max: 9999999 },
    ],
    summary: (p) => `ATR(${p.period}) ${p.condition} ${p.value}`,
  },
  STOCHASTIC: {
    label: 'Stochastic', icon: '〽', category: 'INDICATORS', zones: ['filters', 'conditions'],
    defaults: { kPeriod: 14, dPeriod: 3, condition: 'k_below', value: 20 },
    params: [
      { key: 'kPeriod', label: 'K Period', type: 'number', min: 2, max: 200 },
      { key: 'dPeriod', label: 'D Period', type: 'number', min: 1, max: 50 },
      { key: 'condition', label: 'Condition', type: 'select', options: ['k_cross_above_d', 'k_cross_below_d', 'k_below', 'k_above', 'kd_both_below', 'kd_both_above'] },
      { key: 'value', label: 'Level (for threshold conditions)', type: 'number', min: 0, max: 100 },
    ],
    summary: (p) => `Stoch(${p.kPeriod},${p.dPeriod}) ${p.condition.replace(/_/g, ' ')} ${['k_cross_above_d', 'k_cross_below_d'].includes(p.condition) ? '' : p.value}`.trim(),
  },
  CANDLE_PATTERN: {
    label: 'Candle Pattern', icon: '🕯', category: 'PRICE ACTION', zones: ['conditions'],
    defaults: { pattern: 'hammer' },
    params: [{ key: 'pattern', label: 'Pattern', type: 'select', options: [
      'hammer', 'shooting_star', 'doji', 'bullish_engulfing', 'bearish_engulfing',
      'morning_star', 'evening_star', 'pinbar',
    ] }],
    summary: (p) => `Candle: ${p.pattern.replace(/_/g, ' ')}`,
  },
  NEAR_SUPPORT: {
    label: 'Price near Support', icon: '🔽', category: 'PRICE ACTION', zones: ['conditions'],
    defaults: { pct: 1.5 },
    params: [{ key: 'pct', label: 'Within % of swing low', type: 'number', min: 0.1, max: 20 }],
    summary: (p) => `Price within ${p.pct}% of support`,
  },
  NEAR_RESISTANCE: {
    label: 'Price near Resistance', icon: '🔼', category: 'PRICE ACTION', zones: ['conditions'],
    defaults: { pct: 1.5 },
    params: [{ key: 'pct', label: 'Within % of swing high', type: 'number', min: 0.1, max: 20 }],
    summary: (p) => `Price within ${p.pct}% of resistance`,
  },
  HIGHER_HIGH: {
    label: 'Higher High formed', icon: '📐', category: 'PRICE ACTION', zones: ['conditions'],
    defaults: {}, params: [], summary: () => 'Higher High formed',
  },
  LOWER_LOW: {
    label: 'Lower Low formed', icon: '📐', category: 'PRICE ACTION', zones: ['conditions'],
    defaults: {}, params: [], summary: () => 'Lower Low formed',
  },
  TREND_4H: {
    label: '4H Trend', icon: '📡', category: 'TREND', zones: ['filters', 'conditions'],
    defaults: { direction: 'bullish' },
    params: [{ key: 'direction', label: 'Direction', type: 'select', options: ['bullish', 'bearish', 'neutral'] }],
    summary: (p) => `4H Trend = ${p.direction}`,
  },
  TREND_1H: {
    label: '1H Trend', icon: '📡', category: 'TREND', zones: ['filters', 'conditions'],
    defaults: { direction: 'bullish' },
    params: [{ key: 'direction', label: 'Direction', type: 'select', options: ['bullish', 'bearish', 'neutral'] }],
    summary: (p) => `1H Trend = ${p.direction}`,
  },
  TREND_MTF: {
    label: 'Trend (Multi-TF)', icon: '📡', category: 'TREND', zones: ['filters', 'conditions'],
    defaults: { timeframe: '4h', direction: 'bullish' },
    params: [
      { key: 'timeframe', label: 'Timeframe', type: 'select', options: ['15m', '30m', '1h', '2h', '4h', '1D', '1W'] },
      { key: 'direction', label: 'Direction', type: 'select', options: ['bullish', 'bearish', 'any'] },
    ],
    summary: (p) => `${p.timeframe} Trend: ${p.direction}`,
  },
  TREND_ALIGN: {
    label: 'Trend Alignment', icon: '📡', category: 'TREND', zones: ['filters', 'conditions'],
    defaults: { tfA: '1h', tfB: '4h', alignment: 'full' },
    params: [
      { key: 'tfA', label: 'Timeframe A', type: 'select', options: ['15m', '30m', '1h', '2h', '4h', '1D', '1W'] },
      { key: 'tfB', label: 'Timeframe B', type: 'select', options: ['15m', '30m', '1h', '2h', '4h', '1D', '1W'] },
      { key: 'alignment', label: 'Alignment', type: 'select', options: ['full', 'partial'] },
    ],
    summary: (p) => `${p.tfA} & ${p.tfB} ${p.alignment} alignment`,
  },
  TRADING_HOURS: {
    label: 'Trading Hours (PKT)', icon: '🕐', category: 'TIME', zones: ['filters'],
    defaults: { startHour: 8, endHour: 18 },
    params: [
      { key: 'startHour', label: 'Start Hour (0-23)', type: 'number', min: 0, max: 23 },
      { key: 'endHour', label: 'End Hour (0-23)', type: 'number', min: 0, max: 23 },
    ],
    summary: (p) => `Hours ${p.startHour}:00–${p.endHour}:00 PKT`,
  },
  DAY_OF_WEEK: {
    label: 'Day of Week', icon: '📅', category: 'TIME', zones: ['filters'],
    defaults: { days: 'Mon,Tue,Wed,Thu,Fri' },
    params: [{ key: 'days', label: 'Days (comma sep)', type: 'text', placeholder: 'Mon,Tue,Wed,Thu,Fri' }],
    summary: (p) => `Days: ${p.days}`,
  },
  ENTER_LONG: {
    label: 'Enter Long', icon: '🟢', category: 'ACTIONS', zones: ['actions'],
    defaults: {}, params: [], summary: () => 'Enter LONG',
  },
  ENTER_SHORT: {
    label: 'Enter Short', icon: '🔴', category: 'ACTIONS', zones: ['actions'],
    defaults: {}, params: [], summary: () => 'Enter SHORT',
  },
  EXIT_POSITION: {
    label: 'Exit Position', icon: '⬛', category: 'ACTIONS', zones: ['actions'],
    defaults: {}, params: [], summary: () => 'Exit Position',
  },
  ALERT_ONLY: {
    label: 'Send Alert Only', icon: '🔔', category: 'ACTIONS', zones: ['actions'],
    defaults: {}, params: [], summary: () => 'Alert only (no order)',
  },
  STOP_LOSS: {
    label: 'Stop Loss', icon: '🛑', category: 'RISK', zones: ['actions'],
    defaults: { type: 'points', value: 0.5 },
    params: [
      { key: 'type', label: 'Type', type: 'select', options: ['points', 'rr'] },
      { key: 'value', label: 'Value', type: 'number', min: 0.0001, max: 100000 },
    ],
    summary: (p) => `SL: ${p.value}${p.type === 'rr' ? '× RR (TP÷RR)' : ' pts offset'}`,
  },
  TAKE_PROFIT: {
    label: 'Take Profit', icon: '🎯', category: 'RISK', zones: ['actions'],
    defaults: { type: 'rr', value: 2 },
    params: [
      { key: 'type', label: 'Type', type: 'select', options: ['rr', 'points'] },
      { key: 'value', label: 'Value', type: 'number', min: 0.0001, max: 100000 },
    ],
    summary: (p) => `TP: ${p.value}${p.type === 'rr' ? '× RR (SL×RR)' : ' pts offset'}`,
  },
  POSITION_SIZE: {
    label: 'Position Size', icon: '💰', category: 'RISK', zones: ['actions'],
    defaults: { type: 'pct_capital', value: 2 },
    params: [
      { key: 'type', label: 'Type', type: 'select', options: ['pct_capital', 'fixed_usdt'] },
      { key: 'value', label: 'Value', type: 'number', min: 0.01, max: 100000 },
    ],
    summary: (p) => `Size: ${p.value}${p.type === 'pct_capital' ? '% capital' : ' USDT'}`,
  },
};

const LIB_CATEGORIES = ['INDICATORS', 'PRICE ACTION', 'TREND', 'TIME', 'ACTIONS', 'RISK'];

// Coin autocomplete suggestions — ported from the inline <script> at the
// bottom of public/strategy.html.
const COIN_SUGGESTIONS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT',
  'AVAXUSDT', 'TRXUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT', 'LTCUSDT', 'UNIUSDT',
  'XLMUSDT', 'ATOMUSDT', 'ETCUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT',
  'INJUSDT', 'SUIUSDT', 'SEIUSDT', 'TONUSDT', 'WLDUSDT', 'FTMUSDT', 'SANDUSDT',
  'MANAUSDT', 'AAVEUSDT', 'SNXUSDT', 'CRVUSDT', 'LDOUSDT', 'RNDRUSDT', 'FETUSDT',
  'AGIXUSDT', 'GALAUSDT', 'AXSUSDT', 'GMTUSDT', 'STXUSDT', 'ENAUSDT', 'JUPUSDT',
  'PYTHUSDT', 'TIAUSDT', 'COMPUSDT', 'MKRUSDT', '1000PEPEUSDT', '1000SHIBUSDT',
  'WIFUSDT', 'BOMEUSDT', 'ORDIUSDT', 'TAOUSDT', 'EIGENUSDT', 'SCRUSDT', 'MOVEUSDT',
];

const TF_TO_PINE = { '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1D': 'D', '1W': 'W' };

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function emptyIfBlocks() {
  return [{ id: 'if_main', type: 'if', conditions: [], actions: [] }];
}

function normalizeBlock(b) {
  const out = { ...b };
  if (!out.id) out.id = newId('blk');
  if (!out.params) out.params = { ...(BLOCK_DEFS[out.type]?.defaults || {}) };
  if (!out.operator) out.operator = 'AND';
  return out;
}

function getZoneArray(canvas, zoneKey) {
  if (zoneKey === 'filters') return canvas.filters;
  if (zoneKey === 'exit') return canvas.exitConditions;
  if (zoneKey.startsWith('if:')) {
    const parts = zoneKey.split(':');
    const ifb = canvas.ifBlocks.find((b) => b.id === parts[1]);
    return ifb ? ifb[parts[2]] : null;
  }
  return null;
}

function setZoneArray(canvas, zoneKey, newArr) {
  if (zoneKey === 'filters') return { ...canvas, filters: newArr };
  if (zoneKey === 'exit') return { ...canvas, exitConditions: newArr };
  if (zoneKey.startsWith('if:')) {
    const parts = zoneKey.split(':');
    return {
      ...canvas,
      ifBlocks: canvas.ifBlocks.map((b) => (b.id === parts[1] ? { ...b, [parts[2]]: newArr } : b)),
    };
  }
  return canvas;
}

function findBlockInCanvas(canvas, blockId) {
  const zones = [
    { arr: canvas.filters, key: 'filters' },
    { arr: canvas.exitConditions, key: 'exit' },
  ];
  canvas.ifBlocks.forEach((ifb) => {
    zones.push({ arr: ifb.conditions, key: `if:${ifb.id}:conditions` });
    zones.push({ arr: ifb.actions, key: `if:${ifb.id}:actions` });
  });
  for (const { arr, key } of zones) {
    const block = arr.find((b) => b.id === blockId);
    if (block) return { block, zoneKey: key };
  }
  return null;
}

function computeMobileZones(blockType, canvas) {
  const def = BLOCK_DEFS[blockType];
  if (!def) return [];
  const zones = [];
  if (def.zones.includes('filters')) zones.push({ key: 'filters', label: '📋 Filters' });
  canvas.ifBlocks.forEach((ifb, idx) => {
    const typeLabel = ifb.type === 'if' ? 'IF' : ifb.type === 'elseif' ? `ELSE IF ${idx}` : 'ELSE';
    if (ifb.type !== 'else' && def.zones.includes('conditions')) {
      zones.push({ key: `if:${ifb.id}:conditions`, label: `🔵 ${typeLabel} — Conditions` });
    }
    if (def.zones.includes('actions')) {
      zones.push({ key: `if:${ifb.id}:actions`, label: `⚡ ${typeLabel} — Actions` });
    }
  });
  if (def.zones.includes('conditions')) zones.push({ key: 'exit', label: '🚪 Exit Conditions' });
  return zones;
}

function relativeTime(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatLogTime(entry) {
  const raw = entry.timestamp || entry.ts;
  return new Date(raw || Date.now()).toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour12: false });
}

function pineOp(op) { return op === '=' ? '==' : op; }

// ── Pine Script generator — ported from public/js/strategy.js (reads the
// passed-in name/canvas instead of the DOM). ──
function blockToPine(block) {
  const p = block.params;
  const mt = p.maType || 'EMA';
  const pfx = mt === 'SMA' ? 'sma' : 'ema';
  switch (block.type) {
    case 'RSI': return `rsiVal ${pineOp(p.condition)} ${p.value}`;
    case 'RSI_CROSS': return p.direction === 'cross_above'
      ? `ta.crossover(rsiVal, ${p.level})`
      : `ta.crossunder(rsiVal, ${p.level})`;
    case 'MACD_CROSS': return p.direction === 'bullish' ? '(histLine > 0 and histPrev <= 0)' : '(histLine < 0 and histPrev >= 0)';
    case 'MACD_HIST': return p.condition === 'above' ? 'histLine > 0' : 'histLine < 0';
    case 'EMA_CROSS':
    case 'MA_CROSS': return p.direction === 'above'
      ? `${pfx}${p.fastPeriod} > ${pfx}${p.slowPeriod}`
      : `${pfx}${p.fastPeriod} < ${pfx}${p.slowPeriod}`;
    case 'PRICE_EMA':
    case 'PRICE_MA': return p.direction === 'above' ? `close > ${pfx}${p.period}` : `close < ${pfx}${p.period}`;
    case 'BB': return p.condition === 'above_upper' ? 'close > bbUpper' : 'close < bbLower';
    case 'VOLUME_SPIKE': return `volRatio >= ${p.multiplier}`;
    case 'ATR': return `atrVal ${pineOp(p.condition)} ${p.value}`;
    case 'STOCHASTIC': {
      const cond = p.condition || 'k_below';
      const val = p.value ?? 20;
      if (cond === 'k_cross_above_d') return 'ta.crossover(stochK, stochD)';
      if (cond === 'k_cross_below_d') return 'ta.crossunder(stochK, stochD)';
      if (cond === 'k_below') return `stochK < ${val}`;
      if (cond === 'k_above') return `stochK > ${val}`;
      if (cond === 'kd_both_below') return `stochK < ${val} and stochD < ${val}`;
      if (cond === 'kd_both_above') return `stochK > ${val} and stochD > ${val}`;
      return 'true';
    }
    case 'CANDLE_PATTERN': {
      const pat = p.pattern || 'hammer';
      if (pat === 'doji') return 'math.abs(close - open) <= (high - low) * 0.1';
      if (pat === 'hammer') return '(math.min(open,close) - low >= math.abs(close-open)*2) and (high - math.max(open,close) <= math.abs(close-open)*0.5)';
      if (pat === 'shooting_star') return '(high - math.max(open,close) >= math.abs(close-open)*2) and (math.min(open,close) - low <= math.abs(close-open)*0.5)';
      if (pat === 'bullish_engulfing') return '(close > open) and (close[1] < open[1]) and (close > open[1]) and (open < close[1])';
      if (pat === 'bearish_engulfing') return '(close < open) and (close[1] > open[1]) and (open > close[1]) and (close < open[1])';
      if (pat === 'pinbar') return 'math.max(high-math.max(open,close), math.min(open,close)-low) >= math.abs(close-open)*2.5';
      if (pat === 'morning_star') return '(close[2] < open[2]) and (math.abs(close[1]-open[1]) <= (high[1]-low[1])*0.4) and (close > open) and (close > (open[2] + close[2]) / 2)';
      if (pat === 'evening_star') return '(close[2] > open[2]) and (math.abs(close[1]-open[1]) <= (high[1]-low[1])*0.4) and (close < open) and (close < (open[2] + close[2]) / 2)';
      return `true // candle pattern: ${pat}`;
    }
    case 'NEAR_SUPPORT': return `(close >= ta.lowest(low, 50) and close <= ta.lowest(low, 50) * (1 + ${+(p.pct ?? 1)} / 100))`;
    case 'NEAR_RESISTANCE': return `(close <= ta.highest(high, 50) and close >= ta.highest(high, 50) * (1 - ${+(p.pct ?? 1)} / 100))`;
    case 'HIGHER_HIGH': return '(not na(ta.pivothigh(high, 2, 2)) and not na(ta.pivothigh(high[1], 2, 2)) and ta.pivothigh(high, 2, 2) > ta.pivothigh(high[1], 2, 2))';
    case 'LOWER_LOW': return '(not na(ta.pivotlow(low, 2, 2)) and not na(ta.pivotlow(low[1], 2, 2)) and ta.pivotlow(low, 2, 2) < ta.pivotlow(low[1], 2, 2))';
    case 'TREND_MTF': {
      const v = `mtf${(p.timeframe || '4h').replace(/[^a-zA-Z0-9]/g, '')}`;
      if ((p.direction || 'bullish') === 'any') return `(math.abs(${v}Close - ${v}Ema50) / ${v}Ema50 > 0.002)`;
      return (p.direction === 'bearish') ? `${v}Close < ${v}Ema50` : `${v}Close > ${v}Ema50`;
    }
    case 'TREND_ALIGN': {
      const vA = `mtf${(p.tfA || '1h').replace(/[^a-zA-Z0-9]/g, '')}`;
      const vB = `mtf${(p.tfB || '4h').replace(/[^a-zA-Z0-9]/g, '')}`;
      if ((p.alignment || 'full') === 'partial') return `(${vA}Close > ${vA}Ema50 or ${vB}Close > ${vB}Ema50)`;
      return `((${vA}Close > ${vA}Ema50 and ${vB}Close > ${vB}Ema50) or (${vA}Close < ${vA}Ema50 and ${vB}Close < ${vB}Ema50))`;
    }
    default: return `true // ${BLOCK_DEFS[block.type]?.summary(p) || block.type}`;
  }
}

function condsToPine(blocks) {
  return blocks.map((b, i) => {
    const op = i === 0 ? '' : (b.operator === 'OR' ? ' or ' : ' and ');
    return op + blockToPine(b);
  }).join('');
}

function generatePineScript(name, canvas) {
  const sizeBlock = canvas.ifBlocks.flatMap((b) => b.actions).find((b) => b.type === 'POSITION_SIZE');
  const sizeVal = sizeBlock ? sizeBlock.params.value : 2;

  const allCondBlocks = [
    ...canvas.filters,
    ...canvas.ifBlocks.flatMap((b) => b.conditions),
    ...canvas.exitConditions,
  ];
  const usesRSI = allCondBlocks.some((b) => b.type === 'RSI');
  const usesRSICross = allCondBlocks.some((b) => b.type === 'RSI_CROSS');
  const usesMACD = allCondBlocks.some((b) => ['MACD_CROSS', 'MACD_HIST'].includes(b.type));
  const usesATR = [...allCondBlocks, ...canvas.ifBlocks.flatMap((b) => b.actions)].some((b) => b.type === 'ATR');
  const usesBB = allCondBlocks.some((b) => b.type === 'BB');
  const usesVol = allCondBlocks.some((b) => b.type === 'VOLUME_SPIKE');
  const usesStoch = allCondBlocks.some((b) => b.type === 'STOCHASTIC');
  const emaPeriods = new Set();
  const smaPeriods = new Set();
  allCondBlocks.forEach((b) => {
    if (b.type === 'EMA_CROSS' || b.type === 'MA_CROSS') {
      const mt = b.params.maType || 'EMA';
      if (mt === 'SMA') { smaPeriods.add(b.params.fastPeriod); smaPeriods.add(b.params.slowPeriod); }
      else { emaPeriods.add(b.params.fastPeriod); emaPeriods.add(b.params.slowPeriod); }
    }
    if (b.type === 'PRICE_EMA' || b.type === 'PRICE_MA') {
      const mt = b.params.maType || 'EMA';
      if (mt === 'SMA') smaPeriods.add(b.params.period);
      else emaPeriods.add(b.params.period);
    }
  });

  const mtfTfSet = new Set();
  allCondBlocks.forEach((b) => {
    if (b.type === 'TREND_MTF' && b.params.timeframe) mtfTfSet.add(b.params.timeframe);
    if (b.type === 'TREND_ALIGN') {
      if (b.params.tfA) mtfTfSet.add(b.params.tfA);
      if (b.params.tfB) mtfTfSet.add(b.params.tfB);
    }
  });

  const L = [];
  L.push('//@version=5');
  L.push(`strategy("${name}", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=${sizeVal})`);
  L.push('');
  L.push('// ── Indicators ──');
  if (usesRSI || usesRSICross) {
    const p = allCondBlocks.find((b) => b.type === 'RSI' || b.type === 'RSI_CROSS')?.params.period || 14;
    L.push(`rsiVal = ta.rsi(close, ${p})`);
    if (usesRSICross) L.push('rsiPrev = rsiVal[1]');
  }
  if (usesMACD) {
    L.push('[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)');
    L.push('histPrev = histLine[1]');
  }
  if (usesATR) L.push('atrVal = ta.atr(14)');
  [...emaPeriods].forEach((p) => L.push(`ema${p} = ta.ema(close, ${p})`));
  [...smaPeriods].forEach((p) => L.push(`sma${p} = ta.sma(close, ${p})`));
  if (usesBB) {
    const p = allCondBlocks.find((b) => b.type === 'BB')?.params.period || 20;
    L.push(`[bbMid, bbUpper, bbLower] = ta.bb(close, ${p}, 2.0)`);
  }
  if (usesVol) {
    L.push('volAvg = ta.sma(volume, 20)');
    L.push('volRatio = volume / volAvg');
  }
  if (usesStoch) {
    const stochBlock = allCondBlocks.find((b) => b.type === 'STOCHASTIC');
    const kp = stochBlock?.params.kPeriod || 14;
    const dp = stochBlock?.params.dPeriod || 3;
    L.push(`stochK = ta.stoch(close, high, low, ${kp})`);
    L.push(`stochD = ta.sma(stochK, ${dp})`);
    L.push('stochKPrev = stochK[1]');
    L.push('stochDPrev = stochD[1]');
  }
  if (mtfTfSet.size > 0) {
    L.push('// ── Multi-Timeframe Trends ──');
    mtfTfSet.forEach((tf) => {
      const ptf = TF_TO_PINE[tf] || '60';
      const v = `mtf${tf.replace(/[^a-zA-Z0-9]/g, '')}`;
      L.push(`${v}Close = request.security(syminfo.tickerid, "${ptf}", close)`);
      L.push(`${v}Ema50 = request.security(syminfo.tickerid, "${ptf}", ta.ema(close, 50))`);
    });
  }

  if (canvas.filters.length > 0) {
    L.push('');
    L.push('// ── Filters ──');
    const fConds = canvas.filters.map((b) => blockToPine(b)).filter(Boolean);
    L.push(`filterPass = ${fConds.join(' and ')}`);
  } else {
    L.push('filterPass = true');
  }

  L.push('');
  L.push('// ── Entry Logic ──');
  if (canvas.ifBlocks.some((b) => b.conditions.length > 0 || b.type === 'else')) {
    L.push('if filterPass');
    canvas.ifBlocks.forEach((ifBlock, idx) => {
      const keyword = ifBlock.type === 'if' ? '    if' : ifBlock.type === 'elseif' ? '    else if' : '    else';
      if (ifBlock.type === 'else') {
        L.push(`${keyword}`);
      } else {
        const condStr = ifBlock.conditions.length > 0 ? condsToPine(ifBlock.conditions) : 'false';
        L.push(`${keyword} ${condStr}`);
      }

      const slBlk = ifBlock.actions.find((b) => b.type === 'STOP_LOSS');
      const tpBlk = ifBlock.actions.find((b) => b.type === 'TAKE_PROFIT');
      const dir = ifBlock.actions.find((b) => ['ENTER_LONG', 'ENTER_SHORT'].includes(b.type));
      const isShort = dir?.type === 'ENTER_SHORT';
      const alertOnly = ifBlock.actions.some((b) => b.type === 'ALERT_ONLY');
      const exit = ifBlock.actions.some((b) => b.type === 'EXIT_POSITION');

      if (slBlk) {
        const dist = slBlk.params.type === 'points' ? `${slBlk.params.value}`
          : (slBlk.params.type === 'rr' && tpBlk) ? `tpDist${idx} / ${slBlk.params.value}`
          : `${slBlk.params.value}`;
        L.push(`        slDist${idx} = ${dist}`);
      }
      if (tpBlk) {
        const dist = tpBlk.params.type === 'points' ? `${tpBlk.params.value}`
          : (tpBlk.params.type === 'rr' && slBlk) ? `slDist${idx} * ${tpBlk.params.value}`
          : `${tpBlk.params.value}`;
        L.push(`        tpDist${idx} = ${dist}`);
      }

      if (exit) {
        L.push(`        strategy.close_all(comment="Exit Block ${idx + 1}")`);
      } else if (alertOnly) {
        L.push('        alert("Strategy signal triggered", alert.freq_once_per_bar)');
      } else if (dir) {
        const entryName = isShort ? `"Short${idx + 1}"` : `"Long${idx + 1}"`;
        const stratDir = isShort ? 'strategy.short' : 'strategy.long';
        const entryArgs = [entryName, stratDir];
        if (slBlk) entryArgs.push(isShort ? `stop=close + slDist${idx}` : `stop=close - slDist${idx}`);
        if (tpBlk) entryArgs.push(isShort ? `limit=close - tpDist${idx}` : `limit=close + tpDist${idx}`);
        L.push(`        strategy.entry(${entryArgs.join(', ')})`);
      }
    });
  }

  if (canvas.exitConditions.length > 0) {
    L.push('');
    L.push('// ── Exit Conditions ──');
    L.push('if strategy.position_size != 0');
    L.push(`    if ${condsToPine(canvas.exitConditions)}`);
    L.push('        strategy.close_all(comment="Exit condition")');
  }

  return L.join('\n');
}

export default function Strategy() {
  return (
    <PremiumGate>
      <StrategyContent />
    </PremiumGate>
  );
}

function BlockCard({ block, idx, zoneKey, onRemove, onToggleOp, onEdit }) {
  const def = BLOCK_DEFS[block.type];
  if (!def) return null;
  const isConditionZone = zoneKey === 'exit' || (zoneKey.startsWith('if:') && zoneKey.endsWith(':conditions'));
  const showOp = isConditionZone && idx > 0;
  const op = block.operator || 'AND';
  return (
    <div className="strat-block-card" onClick={() => onEdit(zoneKey, block.id)}>
      {showOp && (
        <button
          type="button"
          className={`bc-op ${op.toLowerCase()}`}
          title="Click to toggle"
          onClick={(e) => { e.stopPropagation(); onToggleOp(zoneKey, block.id); }}
        >
          {op}
        </button>
      )}
      <span className="bc-icon">{def.icon}</span>
      <span className="bc-label">{def.label}</span>
      <span className="bc-params">{def.summary(block.params)}</span>
      <button type="button" className="bc-remove" title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(zoneKey, block.id); }}>✕</button>
    </div>
  );
}

function TradeRow({ trade: t, strategies, live, onClose }) {
  const isOpen = t.status === 'open';
  const hasLive = isOpen && live;
  const pnlVal = hasLive ? live.pnl : (t.pnl != null ? t.pnl : null);
  const pnlPctVal = hasLive ? live.pnlPct : (t.pnl != null && t.entryPrice && t.quantity ? (t.pnl / (t.entryPrice * t.quantity)) * 100 : null);
  const cls = pnlVal != null && pnlVal >= 0 ? 'pnl-pos' : 'pnl-neg';
  const pnlStr = pnlVal != null ? `${pnlVal >= 0 ? '+' : ''}${pnlVal.toFixed(2)}` : '—';
  const date = t.openedAt ? new Date(t.openedAt).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const stratName = strategies.find((s) => s._id === t.strategyId)?.name || '—';
  return (
    <tr>
      <td>{date}</td>
      <td style={{ fontWeight: 700, color: '#e5e9f2' }}>{t.symbol}</td>
      <td><span className={`badge badge-${(t.side || '').toLowerCase()}`}>{(t.side || '').toUpperCase()}</span></td>
      <td>{t.entryPrice != null ? t.entryPrice.toFixed(4) : '—'}</td>
      <td>{t.exitPrice != null ? t.exitPrice.toFixed(4) : '—'}</td>
      <td className={pnlVal != null ? cls : undefined} style={{ fontWeight: 700 }}>
        {pnlVal != null ? `${pnlStr} USDT` : '—'}
        {pnlPctVal != null && <span style={{ fontSize: '0.8em', opacity: 0.8 }}> ({pnlPctVal >= 0 ? '+' : ''}{pnlPctVal.toFixed(2)}%)</span>}
      </td>
      <td><span className={`badge badge-${t.status}`}>{t.status}</span></td>
      <td style={{ color: '#8a95a8', fontSize: '0.8rem', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stratName}</td>
      <td>{isOpen && <button type="button" className="hist-close-btn" onClick={() => onClose(t._id)}>Close</button>}</td>
    </tr>
  );
}

function StrategyContent() {
  // ── Strategy meta + canvas state ──
  const [stratName, setStratName] = useState('Untitled Strategy');
  const [coins, setCoins] = useState([]);
  const [timeframe, setTimeframe] = useState('5m');
  const [maxTrades, setMaxTrades] = useState('3');
  const [drawdownLimit, setDrawdownLimit] = useState('50');
  const [canvas, setCanvas] = useState(() => ({ filters: [], ifBlocks: emptyIfBlocks(), exitConditions: [] }));
  const [currentStrategyId, setCurrentStrategyId] = useState(null);
  const [strategies, setStrategies] = useState([]);

  // ── Coin tagger ──
  const [coinInputVal, setCoinInputVal] = useState('');
  const [coinDropdown, setCoinDropdown] = useState([]);
  const [coinDdIdx, setCoinDdIdx] = useState(-1);

  // ── Block edit modal ──
  const [editingBlock, setEditingBlock] = useState(null); // { zoneKey, blockId, type }
  const [editValues, setEditValues] = useState({});

  // ── Overwrite modal ──
  const [overwrite, setOverwrite] = useState(null); // { name, existing, body }

  // ── Pine modal ──
  const [pineOpen, setPineOpen] = useState(false);

  // ── Bot modal ──
  const [botModalOpen, setBotModalOpen] = useState(false);
  const [botTab, setBotTab] = useState('controls');
  const [botActive, setBotActive] = useState(false);
  const [botStrategyId, setBotStrategyId] = useState(null);
  const [botSelId, setBotSelId] = useState('');
  const [botStatus, setBotStatus] = useState({ status: null, lastScan: null, tradesToday: null });
  const [botStats, setBotStats] = useState({ tradesToday: '—', winRate: '—', todayPnl: '—', todayPnlColor: '#e5e9f2' });
  const [ddStatus, setDdStatus] = useState({ text: '', color: '#6b7897' });
  const [discordRowVisible, setDiscordRowVisible] = useState(false);
  const [discordChecked, setDiscordChecked] = useState(true);
  const [logs, setLogs] = useState([]);
  const [logFilterFrom, setLogFilterFrom] = useState('');
  const [logFilterTo, setLogFilterTo] = useState('');

  // ── Trade history ──
  const [allTrades, setAllTrades] = useState([]);
  const [filterStrategy, setFilterStrategy] = useState('all');
  const [filterDir, setFilterDir] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortPnl, setSortPnl] = useState('default');
  const [tradePage, setTradePage] = useState(1);
  const [livePnl, setLivePnl] = useState({});

  // ── Misc UI ──
  const [dragOverZone, setDragOverZone] = useState(null);
  const [mobilePicker, setMobilePicker] = useState(null);
  const [collapsedCats, setCollapsedCats] = useState(() => new Set());
  const [mobileCat, setMobileCat] = useState('ALL');
  const [toast, setToast] = useState(null);

  const toastTimerRef = useRef(null);
  const logFeedRef = useRef(null);
  const logAtBottomRef = useRef(true);
  const coinInputRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // ── Data loading ──
  const fetchBotStatus = useCallback(async () => {
    try {
      const d = await api.get('/api/strategy/bot/status');
      if (d.ok) setBotStatus({ status: d.status, lastScan: d.lastScan, tradesToday: d.tradesToday });
    } catch { /* ignore */ }
  }, []);

  const loadAllTrades = useCallback(async () => {
    try {
      const d = await api.get('/api/strategy/bot/trades');
      if (d.ok) setAllTrades(d.trades || []);
    } catch { /* ignore */ }
  }, []);

  const loadStrategies = useCallback(async () => {
    try {
      const d = await api.get('/api/strategy');
      if (!d.ok) return;
      setStrategies(d.strategies);
      const activeSt = d.strategies.find((s) => s.isActive);
      if (activeSt) {
        setBotActive(true);
        setBotStrategyId(activeSt._id);
        setBotSelId(activeSt._id);
        fetchBotStatus();
      } else {
        setBotActive(false);
        setBotStrategyId(null);
      }
      loadAllTrades();
    } catch (e) { console.error('loadStrategies', e); }
  }, [fetchBotStatus, loadAllTrades]);

  useEffect(() => {
    loadStrategies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Socket.io — bot log / trade events ──
  useEffect(() => {
    if (typeof window.io !== 'function') return;
    const sock = window.io(API_BASE || undefined, { withCredentials: true });
    const push = (level, message) => setLogs((prev) => {
      const next = [...prev, { level, message, timestamp: Date.now() }];
      return next.length > 100 ? next.slice(next.length - 100) : next;
    });
    sock.on('strategy:log', (d) => push(d.level || 'info', d.message));
    sock.on('strategy:scan_started', (d) => push('info', `Scanning ${d.total} coins…`));
    sock.on('strategy:scan_complete', (d) => { push('success', `Scan done — ${d.found} signal(s) in ${d.duration}s`); fetchBotStatus(); });
    sock.on('strategy:conditions_met', (d) => push('success', `✔ ${d.symbol} — ${d.side} signal`));
    sock.on('strategy:order_placed', (d) => { push('success', `Order: ${d.symbol} ${d.side} @ ${d.entry}`); loadAllTrades(); });
    sock.on('strategy:trade_closed', (d) => { push('info', `Closed: ${d.symbol} ${d.type} PnL: ${d.pnl?.toFixed(2)}`); loadAllTrades(); });
    sock.on('strategy:order_failed', (d) => push('error', `Order failed ${d.symbol}: ${d.error}`));
    return () => sock.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll canvas while dragging a block near the viewport edge ──
  useEffect(() => {
    let scrollInterval = null;
    let dragClientY = 0;
    const ZONE = 100, SPEED = 8;
    function tick() {
      const wh = window.innerHeight;
      if (dragClientY > wh - ZONE) window.scrollBy(0, SPEED * ((dragClientY - (wh - ZONE)) / ZONE));
      else if (dragClientY < ZONE) window.scrollBy(0, -SPEED * ((ZONE - dragClientY) / ZONE));
    }
    function onDragOver(e) {
      dragClientY = e.clientY;
      if (!scrollInterval) scrollInterval = setInterval(tick, 16);
    }
    function stop() { if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null; } }
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragend', stop);
    document.addEventListener('drop', stop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragend', stop);
      document.removeEventListener('drop', stop);
      stop();
    };
  }, []);

  // Auto-scroll the bot log feed to the bottom when new entries arrive, but
  // only if the viewer was already at the bottom (matches strategy.js addLog).
  useEffect(() => {
    const el = logFeedRef.current;
    if (el && logAtBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  function onLogFeedScroll(e) {
    const el = e.currentTarget;
    logAtBottomRef.current = el.scrollTop >= el.scrollHeight - el.clientHeight - 10;
  }

  // Live PnL ticker for open trades. NOTE: this calls /api/proxy/binance,
  // which — same as in public/js/strategy.js and public/js/app.js — has no
  // matching Express route anywhere in this codebase. It fails silently
  // (caught per-symbol) exactly as it does today in production; see the
  // migration report for details instead of inventing a different endpoint.
  const updateOpenPnl = useCallback(async () => {
    const openTrades = allTrades.filter((t) => t.status === 'open');
    if (!openTrades.length) return;
    const symbols = [...new Set(openTrades.map((t) => t.symbol))];
    const prices = {};
    await Promise.all(symbols.map(async (sym) => {
      try {
        const d = await api.get(`/api/proxy/binance?path=/fapi/v1/ticker/price&symbol=${sym}`);
        const price = parseFloat(d?.price);
        if (!Number.isNaN(price)) prices[sym] = price;
      } catch { /* ignore — endpoint does not exist server-side */ }
    }));
    if (Object.keys(prices).length === 0) return;
    setLivePnl((prev) => {
      const next = { ...prev };
      openTrades.forEach((t) => {
        const price = prices[t.symbol];
        if (!price) return;
        const side = (t.side || '').toLowerCase();
        const entry = t.entryPrice;
        const qty = t.quantity;
        if (!entry || !qty) return;
        const pnl = side === 'long' ? (price - entry) * qty : (entry - price) * qty;
        const pnlPct = (pnl / (entry * qty)) * 100;
        next[t._id] = { pnl, pnlPct };
      });
      return next;
    });
  }, [allTrades]);

  useEffect(() => {
    const id = setInterval(updateOpenPnl, 3000);
    return () => clearInterval(id);
  }, [updateOpenPnl]);

  useEffect(() => { setTradePage(1); }, [filterStrategy, filterDir, filterStatus, sortPnl]);

  // ── Save / load / delete ──
  const applyStrategy = useCallback((s) => {
    setCurrentStrategyId(s._id);
    setStratName(s.name || 'My Strategy');
    setCoins((s.coins || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean));
    setTimeframe(s.timeframe || '5m');
    setMaxTrades(String(s.maxTradesPerDay || 3));
    setDrawdownLimit(String(s.dailyDrawdownLimit || 50));

    const blk = s.blocks || {};
    let nextCanvas;
    if (blk.ifBlocks) {
      nextCanvas = {
        filters: (blk.filters || []).map(normalizeBlock),
        ifBlocks: blk.ifBlocks.map((ib) => ({
          id: ib.id || newId('if'),
          type: ib.type || 'if',
          conditions: (ib.conditions || []).map(normalizeBlock),
          actions: (ib.actions || []).map(normalizeBlock),
        })),
        exitConditions: (blk.exitConditions || []).map(normalizeBlock),
      };
    } else {
      nextCanvas = {
        filters: (blk.filters || []).map(normalizeBlock),
        ifBlocks: [{ id: 'if_main', type: 'if', conditions: (blk.conditions || []).map(normalizeBlock), actions: (blk.actions || []).map(normalizeBlock) }],
        exitConditions: [],
      };
    }
    if (nextCanvas.ifBlocks.length === 0) nextCanvas.ifBlocks = emptyIfBlocks();
    setCanvas(nextCanvas);
  }, []);

  const stratLoad = useCallback((id) => {
    if (!id) return;
    const s = strategies.find((s2) => s2._id === id);
    if (!s) return;
    applyStrategy(s);
  }, [strategies, applyStrategy]);

  const stratNew = useCallback(() => {
    setCurrentStrategyId(null);
    setCanvas({ filters: [], ifBlocks: emptyIfBlocks(), exitConditions: [] });
    setStratName('Untitled Strategy');
    setCoins([]);
    setTimeframe('5m');
    setMaxTrades('3');
    setDrawdownLimit('50');
    setDdStatus({ text: '', color: '#6b7897' });
  }, []);

  const doPostStrategy = useCallback(async (body) => {
    try {
      const d = await api.post('/api/strategy', body);
      if (!d.ok) { window.alert('Save failed: ' + (d.error || 'Unknown error')); return; }
      setCurrentStrategyId(d.strategy._id);
      showToast('Strategy saved ✓');
      loadStrategies();
    } catch (e) { window.alert('Save failed: ' + e.message); }
  }, [loadStrategies, showToast]);

  const stratSave = useCallback(async () => {
    const name = stratName.trim() || 'Untitled Strategy';
    const pineScript = generatePineScript(name, canvas);
    const body = {
      name,
      blocks: canvas,
      pineScript,
      coins,
      timeframe,
      maxTradesPerDay: parseInt(maxTrades, 10) || 3,
      dailyDrawdownLimit: parseFloat(drawdownLimit) || 50,
    };
    try {
      if (currentStrategyId) {
        const d = await api.put(`/api/strategy/${currentStrategyId}`, body);
        if (!d.ok) { window.alert('Save failed: ' + (d.error || 'Unknown error')); return; }
        showToast('Strategy saved ✓');
        loadStrategies();
      } else {
        const existing = strategies.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
        if (existing) { setOverwrite({ name, existing, body }); return; }
        await doPostStrategy(body);
      }
    } catch (e) { window.alert('Save failed: ' + e.message); }
  }, [stratName, canvas, coins, timeframe, maxTrades, drawdownLimit, currentStrategyId, strategies, doPostStrategy, loadStrategies, showToast]);

  const confirmOverwrite = useCallback(async () => {
    if (!overwrite) return;
    const { existing, body } = overwrite;
    setOverwrite(null);
    try {
      const d = await api.put(`/api/strategy/${existing._id}`, body);
      if (!d.ok) { window.alert('Save failed: ' + (d.error || 'Unknown')); return; }
      setCurrentStrategyId(existing._id);
      showToast('Strategy overwritten ✓');
      loadStrategies();
    } catch (e) { window.alert('Error: ' + e.message); }
  }, [overwrite, loadStrategies, showToast]);

  const saveOverwriteAsNew = useCallback(async () => {
    if (!overwrite) return;
    const { body } = overwrite;
    setOverwrite(null);
    await doPostStrategy(body);
  }, [overwrite, doPostStrategy]);

  const stratDelete = useCallback(async () => {
    if (!currentStrategyId) return;
    if (botActive && botStrategyId === currentStrategyId) { window.alert('Stop the bot first before deleting this strategy.'); return; }
    if (!window.confirm(`Are you sure you want to delete "${stratName.trim()}"? This cannot be undone.`)) return;
    try {
      const d = await api.del(`/api/strategy/${currentStrategyId}`);
      if (!d.ok) { window.alert('Delete failed: ' + (d.error || 'Unknown')); return; }
      showToast('Strategy deleted');
      const delId = currentStrategyId;
      const dList = await api.get('/api/strategy');
      const list = dList.strategies || [];
      setStrategies(list);
      const remaining = list.filter((s) => s._id !== delId);
      if (remaining.length > 0) stratLoad(remaining[0]._id);
      else stratNew();
    } catch (e) { window.alert('Error: ' + e.message); }
  }, [currentStrategyId, botActive, botStrategyId, stratName, stratLoad, stratNew, showToast]);

  // ── Canvas block CRUD ──
  const handleBlockDrop = useCallback((zoneKey, blockType) => {
    const def = BLOCK_DEFS[blockType];
    if (!def) return false;
    let zoneType = zoneKey;
    if (zoneKey.startsWith('if:')) zoneType = zoneKey.split(':')[2];
    else if (zoneKey === 'exit') zoneType = 'conditions';
    if (!def.zones.includes(zoneType)) return false;

    const block = { id: newId('blk'), type: blockType, params: { ...def.defaults }, operator: 'AND' };
    setCanvas((prev) => {
      const arr = getZoneArray(prev, zoneKey);
      if (!arr) return prev;
      return setZoneArray(prev, zoneKey, [...arr, block]);
    });
    return true;
  }, []);

  const removeBlock = useCallback((zoneKey, blockId) => {
    setCanvas((prev) => {
      const arr = getZoneArray(prev, zoneKey);
      if (!arr) return prev;
      return setZoneArray(prev, zoneKey, arr.filter((b) => b.id !== blockId));
    });
  }, []);

  const toggleOperator = useCallback((zoneKey, blockId) => {
    setCanvas((prev) => {
      const arr = getZoneArray(prev, zoneKey);
      if (!arr) return prev;
      return setZoneArray(prev, zoneKey, arr.map((b) => (b.id === blockId ? { ...b, operator: b.operator === 'AND' ? 'OR' : 'AND' } : b)));
    });
  }, []);

  const addElseIf = useCallback((afterIdx) => {
    setCanvas((prev) => {
      const list = [...prev.ifBlocks];
      const elseIdx = list.findIndex((b) => b.type === 'else');
      const insertAt = elseIdx >= 0 ? Math.min(afterIdx + 1, elseIdx) : afterIdx + 1;
      list.splice(insertAt, 0, { id: newId('if'), type: 'elseif', conditions: [], actions: [] });
      return { ...prev, ifBlocks: list };
    });
  }, []);

  const addElse = useCallback(() => {
    setCanvas((prev) => (prev.ifBlocks.some((b) => b.type === 'else')
      ? prev
      : { ...prev, ifBlocks: [...prev.ifBlocks, { id: newId('if_else'), type: 'else', conditions: [], actions: [] }] }));
  }, []);

  const removeIfBlock = useCallback((id) => {
    setCanvas((prev) => {
      const idx = prev.ifBlocks.findIndex((b) => b.id === id);
      if (idx === -1 || (idx === 0 && prev.ifBlocks[0].type === 'if')) return prev;
      return { ...prev, ifBlocks: prev.ifBlocks.filter((b) => b.id !== id) };
    });
  }, []);

  const openBlockEdit = useCallback((zoneKey, blockId) => {
    const found = findBlockInCanvas(canvas, blockId);
    if (!found) return;
    const def = BLOCK_DEFS[found.block.type];
    if (!def || def.params.length === 0) return;
    setEditValues({ ...found.block.params });
    setEditingBlock({ zoneKey, blockId, type: found.block.type });
  }, [canvas]);

  const applyBlockEdit = useCallback(() => {
    if (!editingBlock) return;
    const def = BLOCK_DEFS[editingBlock.type];
    const newParams = {};
    def.params.forEach((p) => {
      const raw = editValues[p.key];
      newParams[p.key] = p.type === 'number' ? parseFloat(raw) : raw;
    });
    setCanvas((prev) => {
      const arr = getZoneArray(prev, editingBlock.zoneKey);
      if (!arr) return prev;
      const newArr = arr.map((b) => (b.id === editingBlock.blockId ? { ...b, params: newParams } : b));
      return setZoneArray(prev, editingBlock.zoneKey, newArr);
    });
    setEditingBlock(null);
  }, [editingBlock, editValues]);

  // ── Drag & drop handlers (native HTML5 DnD, no library) ──
  const onDropZone = useCallback((e, zoneKey) => {
    e.preventDefault();
    setDragOverZone(null);
    const type = e.dataTransfer.getData('block-type');
    if (!type || !BLOCK_DEFS[type]) return;
    if (!handleBlockDrop(zoneKey, type)) window.alert(`"${BLOCK_DEFS[type].label}" cannot be placed in this zone.`);
  }, [handleBlockDrop]);

  const onDragOverZone = useCallback((e, zoneKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverZone(zoneKey);
  }, []);

  const onDragLeaveZone = useCallback((zoneKey) => {
    setDragOverZone((z) => (z === zoneKey ? null : z));
  }, []);

  // ── Mobile tap-to-add zone picker ──
  const openMobilePicker = useCallback((type) => {
    const zones = computeMobileZones(type, canvas);
    if (zones.length === 0) { showToast('No valid zones for this block'); return; }
    setMobilePicker(type);
  }, [canvas, showToast]);

  const pickMobileZone = useCallback((zoneKey) => {
    const type = mobilePicker;
    setMobilePicker(null);
    if (!type) return;
    if (!handleBlockDrop(zoneKey, type)) showToast(`"${BLOCK_DEFS[type].label}" can't go there`);
  }, [mobilePicker, handleBlockDrop, showToast]);

  const toggleCat = useCallback((cat) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  // ── Coin tagger ──
  const addCoin = useCallback((raw) => {
    const c = raw.toUpperCase().trim();
    setCoinInputVal('');
    setCoinDropdown([]);
    setCoinDdIdx(-1);
    if (!c) return;
    setCoins((prev) => (prev.includes(c) ? prev : [...prev, c]));
  }, []);

  const removeCoinAt = useCallback((idx) => {
    setCoins((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  function onCoinInputChange(e) {
    const val = e.target.value;
    setCoinInputVal(val);
    const q = val.trim().toUpperCase();
    if (!q) { setCoinDropdown([]); return; }
    let matches = COIN_SUGGESTIONS.filter((c) => c.startsWith(q) && !coins.includes(c));
    if (!matches.length) matches = COIN_SUGGESTIONS.filter((c) => c.includes(q) && !coins.includes(c));
    if (!coins.includes(q) && q.length >= 3 && !matches.includes(q)) matches = [q, ...matches];
    setCoinDropdown(matches.slice(0, 10));
    setCoinDdIdx(-1);
  }

  function onCoinInputKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCoinDdIdx((i) => Math.min(i + 1, coinDropdown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCoinDdIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (coinDdIdx >= 0 && coinDropdown[coinDdIdx]) addCoin(coinDropdown[coinDdIdx]);
      else if (coinInputVal.trim()) addCoin(coinInputVal.trim());
    } else if (e.key === 'Backspace' && !coinInputVal && coins.length) {
      setCoins((prev) => prev.slice(0, -1));
    } else if (e.key === 'Escape') {
      setCoinDropdown([]);
    }
  }

  // ── Pine script ──
  const pineScript = useMemo(() => generatePineScript(stratName.trim() || 'My Strategy', canvas), [stratName, canvas]);

  const copyPine = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pineScript);
      showToast('Copied ✓');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = pineScript;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Copied ✓');
      } catch { /* ignore */ }
    }
  }, [pineScript, showToast]);

  // ── Bot ──
  const loadBotStats = useCallback(async () => {
    try {
      const d = await api.get('/api/strategy/bot/trades');
      if (!d.ok) return;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayTrades = (d.trades || []).filter((t) => t.openedAt && new Date(t.openedAt) >= today);
      const closed = todayTrades.filter((t) => t.status === 'closed');
      const wins = closed.filter((t) => (t.pnl || 0) > 0).length;
      const totalPnl = closed.reduce((s2, t) => s2 + (t.pnl || 0), 0);
      const winRate = closed.length ? Math.round((wins / closed.length) * 100) : null;
      setBotStats({
        tradesToday: todayTrades.length,
        winRate: winRate !== null ? `${winRate}%` : '—',
        todayPnl: closed.length ? `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT` : '—',
        todayPnlColor: closed.length ? (totalPnl >= 0 ? '#0ecb81' : '#f6465d') : '#e5e9f2',
      });
      if (closed.length) {
        const ddLimit = parseFloat(drawdownLimit) || 50;
        const loss = Math.min(totalPnl, 0);
        const lossAbs = Math.abs(loss);
        const sign = totalPnl >= 0 ? '+' : '-';
        setDdStatus({
          text: `Today: ${sign}$${Math.abs(totalPnl).toFixed(2)} / $${ddLimit} limit`,
          color: totalPnl < 0 && lossAbs >= ddLimit * 0.5 ? '#f6465d' : '#0ecb81',
        });
      }
    } catch { /* ignore */ }
  }, [drawdownLimit]);

  const loadDiscordToggle = useCallback(async () => {
    try {
      const d = await api.get('/api/discord/config');
      if (d.webhookUrl) { setDiscordRowVisible(true); setDiscordChecked(d.alerts?.strategyBotAlerts !== false); }
      else setDiscordRowVisible(false);
    } catch { /* ignore */ }
  }, []);

  const saveDiscordToggle = useCallback(async (checked) => {
    setDiscordChecked(checked);
    try {
      const cur = await api.get('/api/discord/config').catch(() => ({}));
      await api.post('/api/discord/config', {
        webhookUrl: cur.webhookUrl || '',
        alerts: { ...(cur.alerts || {}), strategyBotAlerts: checked },
      });
    } catch { /* ignore */ }
  }, []);

  const loadDbLogs = useCallback(async (from, to) => {
    try {
      let url = '/api/strategy/bot/logs?limit=500';
      if (from) url += `&from=${encodeURIComponent(from)}`;
      if (to) url += `&to=${encodeURIComponent(to)}`;
      const d = await api.get(url);
      if (d.ok) setLogs(d.logs || []);
    } catch { /* ignore */ }
  }, []);

  const applyLogFilter = useCallback(() => {
    const from = logFilterFrom ? new Date(logFilterFrom).toISOString() : null;
    const to = logFilterTo ? new Date(logFilterTo).toISOString() : null;
    loadDbLogs(from, to);
  }, [logFilterFrom, logFilterTo, loadDbLogs]);

  const clearLogFilter = useCallback(() => {
    setLogFilterFrom('');
    setLogFilterTo('');
    loadDbLogs();
  }, [loadDbLogs]);

  const clearAllLogs = useCallback(async () => {
    if (!window.confirm('Clear ALL bot logs from the database? This cannot be undone.')) return;
    try {
      const d = await api.del('/api/strategy/bot/logs');
      if (d.ok) setLogs([]);
    } catch { /* ignore */ }
  }, []);

  const openBotModal = useCallback(() => {
    setBotModalOpen(true);
    loadBotStats();
    loadDiscordToggle();
    loadDbLogs();
  }, [loadBotStats, loadDiscordToggle, loadDbLogs]);

  const startBotClick = useCallback(async () => {
    if (!botSelId) { window.alert('Please select a strategy to run.'); return; }
    try {
      const d = await api.post(`/api/strategy/${botSelId}/activate`);
      if (!d.ok) { window.alert('Failed to start bot: ' + (d.error || d.message || 'Unknown')); return; }
      setBotActive(true);
      setBotStrategyId(botSelId);
      showToast('Bot started ✓');
      loadAllTrades();
      fetchBotStatus();
      loadStrategies();
    } catch (e) { window.alert('Error: ' + e.message); }
  }, [botSelId, loadAllTrades, fetchBotStatus, loadStrategies, showToast]);

  const stopBotClick = useCallback(async () => {
    if (!botStrategyId) return;
    try {
      const d = await api.post(`/api/strategy/${botStrategyId}/stop`);
      if (!d.ok) { window.alert('Failed to stop bot: ' + (d.error || 'Unknown')); return; }
      setBotActive(false);
      setBotStrategyId(null);
      showToast('Bot stopped');
      loadStrategies();
    } catch (e) { window.alert('Error: ' + e.message); }
  }, [botStrategyId, loadStrategies, showToast]);

  const closeBotTrade = useCallback(async (tradeId) => {
    if (!window.confirm('Close this position now? A market close order will be placed immediately.')) return;
    try {
      const d = await api.post(`/api/strategy/close-trade/${tradeId}`);
      if (d.ok) loadAllTrades();
      else window.alert('Failed to close: ' + (d.error || 'Unknown error'));
    } catch (e) { window.alert('Error: ' + e.message); }
  }, [loadAllTrades]);

  const clearTradeHistory = useCallback(async () => {
    if (!window.confirm('This will permanently delete all closed trade history for all strategies.\nOpen trades will NOT be deleted.\n\nAre you sure?')) return;
    try {
      const d = await api.del('/api/strategy/trades/clear');
      if (d.ok) {
        let msg = `Cleared ${d.deleted} trade(s).`;
        if (d.openSkipped > 0) msg += ` ${d.openSkipped} open trade(s) were not cleared.`;
        showToast(msg);
        loadAllTrades();
      } else window.alert('Failed to clear: ' + (d.error || 'Unknown error'));
    } catch (e) { window.alert('Error: ' + e.message); }
  }, [loadAllTrades, showToast]);

  // ── Trade history derived state ──
  const strategyFilterOptions = useMemo(() => {
    const seen = new Set();
    const opts = [{ id: 'all', name: 'All Strategies' }];
    allTrades.forEach((t) => {
      if (!seen.has(t.strategyId)) {
        seen.add(t.strategyId);
        const strat = strategies.find((s) => s._id === t.strategyId);
        opts.push({ id: t.strategyId, name: strat?.name || t.strategyId?.slice(-6) || '?' });
      }
    });
    return opts;
  }, [allTrades, strategies]);

  const filteredTrades = useMemo(() => {
    let list = [...allTrades];
    if (filterStrategy !== 'all') list = list.filter((t) => t.strategyId === filterStrategy);
    if (filterDir !== 'all') list = list.filter((t) => (t.side || '').toLowerCase() === filterDir);
    if (filterStatus !== 'all') list = list.filter((t) => t.status === filterStatus);
    if (sortPnl === 'high') list.sort((a, b) => (b.pnl || 0) - (a.pnl || 0));
    else if (sortPnl === 'low') list.sort((a, b) => (a.pnl || 0) - (b.pnl || 0));
    return list;
  }, [allTrades, filterStrategy, filterDir, filterStatus, sortPnl]);

  const pagedTrades = useMemo(() => filteredTrades.slice((tradePage - 1) * 10, tradePage * 10), [filteredTrades, tradePage]);

  const histSummary = useMemo(() => {
    const closed = filteredTrades.filter((t) => t.status === 'closed');
    const wins = closed.filter((t) => (t.pnl || 0) > 0).length;
    const totalPnl = closed.reduce((a, t) => a + (t.pnl || 0), 0);
    const winRate = closed.length ? Math.round((wins / closed.length) * 100) : 0;
    return {
      winRate,
      winColor: wins > closed.length / 2 ? 'green' : 'red',
      pnlStr: `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT`,
      pnlColor: totalPnl >= 0 ? 'green' : 'red',
    };
  }, [filteredTrades]);

  const runningStrategyName = strategies.find((s) => s._id === botStrategyId)?.name || '—';
  const hasElse = canvas.ifBlocks.some((b) => b.type === 'else');
  const nonElseLength = canvas.ifBlocks.filter((b) => b.type !== 'else').length;

  const blocksByCategory = useMemo(() => {
    const map = {};
    LIB_CATEGORIES.forEach((cat) => {
      map[cat] = Object.entries(BLOCK_DEFS).filter(([, def]) => def.category === cat);
    });
    return map;
  }, []);

  function handleLibraryBlockClick(type) {
    if (window.innerWidth <= 768 || ('ontouchstart' in window)) openMobilePicker(type);
  }

  return (
    <div className="strat-page">
      {/* ── Top bar ── */}
      <div className="strat-topbar">
        <div className="strat-topbar-left">
          <span className="strat-page-title">Strategy Builder</span>
          <input
            className="strat-name-input"
            type="text"
            placeholder="Untitled Strategy"
            maxLength={60}
            value={stratName}
            onChange={(e) => setStratName(e.target.value)}
          />
        </div>
        <div className="strat-topbar-right">
          <select
            className="strat-load-sel"
            value={currentStrategyId || ''}
            onChange={(e) => { if (e.target.value) stratLoad(e.target.value); }}
          >
            <option value="">Switch Strategy…</option>
            {strategies.map((s) => (
              <option key={s._id} value={s._id}>{s.name}{s.isActive ? ' 🟢' : ''}</option>
            ))}
          </select>
          <button type="button" className="strat-btn primary" onClick={stratNew}>+ New</button>
          <button type="button" className="strat-btn accent" onClick={stratSave}><i className="fa-solid fa-floppy-disk" /> Save</button>
          <button type="button" className="strat-btn accent" onClick={() => setPineOpen(true)}><i className="fa-solid fa-code" /> Pine Script</button>
          <button type="button" className="strat-btn accent" onClick={openBotModal}><i className="fa-solid fa-robot" /> Bot</button>
          {currentStrategyId && <button type="button" className="strat-btn danger" onClick={stratDelete}>Delete</button>}
        </div>
      </div>

      {/* ── 3-column builder ── */}
      <div className="strat-builder">
        {/* LEFT: Block library */}
        <div className="strat-lib-outer">
          <div className="strat-lib-heading">Blocks</div>
          <div className="strat-library">
            {LIB_CATEGORIES.map((cat) => (
              <Fragment key={cat}>
                <div className={`strat-lib-cat${collapsedCats.has(cat) ? ' collapsed' : ''}`} onClick={() => toggleCat(cat)}>
                  {cat}<span className="cat-arrow">▾</span>
                </div>
                {!collapsedCats.has(cat) && blocksByCategory[cat].map(([type, def]) => (
                  <div
                    key={type}
                    className="strat-lib-block"
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('block-type', type); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => handleLibraryBlockClick(type)}
                  >
                    <span className="blk-icon">{def.icon}</span>{def.label}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>

        {/* CENTER: Canvas */}
        <div className="strat-canvas">
          <div className="strat-zone strat-zone-filters">
            <div className="strat-zone-header">
              <span className="zh-emoji"><i className="fa-solid fa-filter" /></span> Filters
              <small style={{ color: '#4a5568', fontWeight: 500, fontSize: '0.68rem', marginLeft: 'auto' }}>All must pass before IF blocks run</small>
            </div>
            <div
              className={`strat-zone-drop${dragOverZone === 'filters' ? ' drag-over' : ''}`}
              onDragOver={(e) => onDragOverZone(e, 'filters')}
              onDragLeave={() => onDragLeaveZone('filters')}
              onDrop={(e) => onDropZone(e, 'filters')}
            >
              {canvas.filters.length === 0
                ? <div className="strat-zone-empty">Drag filter blocks here</div>
                : canvas.filters.map((blk, idx) => (
                  <BlockCard key={blk.id} block={blk} idx={idx} zoneKey="filters" onRemove={removeBlock} onToggleOp={toggleOperator} onEdit={openBlockEdit} />
                ))}
            </div>
          </div>

          <div className="strat-zone-arrow">↓</div>

          <div className="strat-zone strat-zone-botcfg">
            <div className="strat-zone-header"><span className="zh-emoji">⚙</span> Bot Settings</div>
            <div className="bot-settings-row" style={{ padding: '0.75rem' }}>
              <div className="bot-field" style={{ flex: 2, minWidth: 200 }}>
                <label>Coins</label>
                <div className="strat-coins-wrap">
                  <div className="coins-tagger" onClick={() => coinInputRef.current?.focus()}>
                    {coins.map((c, i) => (
                      <span className="ct-chip" key={c}>
                        {c}
                        <button type="button" className="ct-chip-x" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); removeCoinAt(i); }}>✕</button>
                      </span>
                    ))}
                    <input
                      ref={coinInputRef}
                      className="ct-type"
                      type="text"
                      placeholder="Add coin…"
                      autoComplete="off"
                      spellCheck={false}
                      value={coinInputVal}
                      onChange={onCoinInputChange}
                      onKeyDown={onCoinInputKeyDown}
                      onBlur={() => setTimeout(() => setCoinDropdown([]), 150)}
                    />
                  </div>
                  {coinDropdown.length > 0 && (
                    <div className="ct-dropdown" style={{ display: 'block' }}>
                      {coinDropdown.map((c, i) => (
                        <div key={c} className={`ct-dd-item${i === coinDdIdx ? ' ct-active' : ''}`} onMouseDown={(e) => { e.preventDefault(); addCoin(c); }}>{c}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="bot-field">
                <label>Timeframe</label>
                <select className="strat-tf-sel" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                  {['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map((tf) => (
                    <option key={tf} value={tf}>{tf === '1d' ? '1D' : tf}</option>
                  ))}
                </select>
              </div>
              <div className="bot-field">
                <label>Max Trades / Day</label>
                <input className="strat-cfg-input" type="number" min={1} max={20} value={maxTrades} onChange={(e) => setMaxTrades(e.target.value)} />
              </div>
              <div className="bot-field">
                <label>Daily Drawdown Limit (USDT)</label>
                <input className="strat-cfg-input" type="number" min={1} placeholder="e.g. 50" value={drawdownLimit} onChange={(e) => setDrawdownLimit(e.target.value)} />
                <div style={{ fontSize: '0.72rem', marginTop: '0.3rem', color: ddStatus.color, minHeight: '1rem' }}>{ddStatus.text}</div>
              </div>
            </div>
          </div>

          {canvas.ifBlocks.map((ifb, idx) => {
            const typeLabel = ifb.type === 'if' ? '🔵 IF' : ifb.type === 'elseif' ? '🟡 ELSE IF' : '⚫ ELSE';
            const canDelete = !(ifb.type === 'if' && idx === 0);
            const condZoneKey = `if:${ifb.id}:conditions`;
            const actZoneKey = `if:${ifb.id}:actions`;
            return (
              <Fragment key={ifb.id}>
                <div className={`strat-if-block if-type-${ifb.type}`}>
                  <div className="strat-if-header">
                    <span className="if-header-type">{typeLabel}</span>
                    {canDelete && <button type="button" className="if-delete-btn" title="Delete block" onClick={() => removeIfBlock(ifb.id)}>✕</button>}
                  </div>
                  <div className="strat-if-body">
                    {ifb.type !== 'else' && (
                      <>
                        <div className="strat-if-sublabel">Conditions — drag here</div>
                        <div
                          className={`strat-zone-drop${dragOverZone === condZoneKey ? ' drag-over' : ''}`}
                          onDragOver={(e) => onDragOverZone(e, condZoneKey)}
                          onDragLeave={() => onDragLeaveZone(condZoneKey)}
                          onDrop={(e) => onDropZone(e, condZoneKey)}
                        >
                          {ifb.conditions.length === 0
                            ? <div className="strat-zone-empty">Drop condition blocks here</div>
                            : ifb.conditions.map((blk, i) => (
                              <BlockCard key={blk.id} block={blk} idx={i} zoneKey={condZoneKey} onRemove={removeBlock} onToggleOp={toggleOperator} onEdit={openBlockEdit} />
                            ))}
                        </div>
                      </>
                    )}
                    <div className="strat-then-label">THEN</div>
                    <div
                      className={`strat-zone-drop${dragOverZone === actZoneKey ? ' drag-over' : ''}`}
                      onDragOver={(e) => onDragOverZone(e, actZoneKey)}
                      onDragLeave={() => onDragLeaveZone(actZoneKey)}
                      onDrop={(e) => onDropZone(e, actZoneKey)}
                    >
                      {ifb.actions.length === 0
                        ? <div className="strat-zone-empty">Drop action blocks here (Enter Long/Short, SL, TP, Size)</div>
                        : ifb.actions.map((blk, i) => (
                          <BlockCard key={blk.id} block={blk} idx={i} zoneKey={actZoneKey} onRemove={removeBlock} onToggleOp={toggleOperator} onEdit={openBlockEdit} />
                        ))}
                    </div>
                  </div>
                </div>
                {ifb.type !== 'else' && (
                  <div className="strat-add-btn-wrap">
                    <button type="button" className="strat-add-if-btn" onClick={() => addElseIf(idx)}>+ Add ELSE IF</button>
                    {!hasElse && idx === nonElseLength - 1 && (
                      <button type="button" className="strat-add-if-btn else" onClick={addElse}>+ Add ELSE</button>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}

          <div className="strat-zone strat-zone-exit" style={{ marginTop: '0.5rem' }}>
            <div className="strat-zone-header">
              <span className="zh-emoji">🚪</span> Exit Conditions
              <small style={{ color: '#4a5568', fontWeight: 500, fontSize: '0.68rem', marginLeft: 'auto' }}>Optional — closes open position when met</small>
            </div>
            <div
              className={`strat-zone-drop${dragOverZone === 'exit' ? ' drag-over' : ''}`}
              onDragOver={(e) => onDragOverZone(e, 'exit')}
              onDragLeave={() => onDragLeaveZone('exit')}
              onDrop={(e) => onDropZone(e, 'exit')}
            >
              {canvas.exitConditions.length === 0
                ? <div className="strat-zone-empty">Drag condition blocks here</div>
                : canvas.exitConditions.map((blk, idx) => (
                  <BlockCard key={blk.id} block={blk} idx={idx} zoneKey="exit" onRemove={removeBlock} onToggleOp={toggleOperator} onEdit={openBlockEdit} />
                ))}
            </div>
          </div>
        </div>

        {/* MOBILE block library */}
        <div className="mobile-lib-panel">
          <div className="mobile-lib-cats">
            {['ALL', ...LIB_CATEGORIES].map((cat) => (
              <button key={cat} type="button" className={`mobile-cat-pill${mobileCat === cat ? ' active' : ''}`} onClick={() => setMobileCat(cat)}>
                {cat === 'ALL' ? 'All Blocks' : cat}
              </button>
            ))}
          </div>
          <div className="mobile-lib-blocks">
            {Object.entries(BLOCK_DEFS).filter(([, def]) => mobileCat === 'ALL' || def.category === mobileCat).map(([type, def]) => (
              <button key={type} type="button" className="mobile-lib-chip" onClick={() => openMobilePicker(type)}>
                <span>{def.icon}</span>{def.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Block Edit Modal ── */}
      {editingBlock && (() => {
        const def = BLOCK_DEFS[editingBlock.type];
        if (!def) return null;
        const allActions = canvas.ifBlocks.flatMap((b) => b.actions);
        const slBlk = allActions.find((b) => b.type === 'STOP_LOSS');
        const tpBlk = allActions.find((b) => b.type === 'TAKE_PROFIT');
        const bothRR = (editingBlock.type === 'STOP_LOSS' || editingBlock.type === 'TAKE_PROFIT')
          && slBlk?.params?.type === 'rr' && tpBlk?.params?.type === 'rr';
        return (
          <div className="strat-modal-bg open">
            <div className="strat-modal">
              <button type="button" className="strat-modal-close" onClick={() => setEditingBlock(null)}>✕</button>
              <h3>Edit — {def.label}</h3>
              <div>
                {def.params.map((p) => (
                  <div className="strat-field" key={p.key}>
                    <label>{p.label}</label>
                    {p.type === 'select' ? (
                      <select value={editValues[p.key] ?? ''} onChange={(e) => setEditValues((v) => ({ ...v, [p.key]: e.target.value }))}>
                        {p.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        type={p.type || 'text'}
                        min={p.min}
                        max={p.max}
                        placeholder={p.placeholder}
                        value={editValues[p.key] ?? ''}
                        onChange={(e) => setEditValues((v) => ({ ...v, [p.key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
                {bothRR && (
                  <div style={{ background: '#7c3b00', color: '#fbd38d', padding: '8px 10px', borderRadius: '6px', marginTop: '10px', fontSize: '12px', lineHeight: 1.4 }}>
                    ⚠️ Both SL and TP are set to RR — they reference each other and neither can be calculated. Set either SL or TP as Price Offset first, then use RR on the other. Recommended: SL = Price Offset, TP = RR.
                  </div>
                )}
              </div>
              <div className="strat-modal-btns">
                <button type="button" className="strat-btn primary" style={{ flex: 1 }} onClick={applyBlockEdit}>Apply</button>
                <button type="button" className="strat-btn" style={{ flex: 1 }} onClick={() => setEditingBlock(null)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Overwrite Conflict Modal ── */}
      {overwrite && (
        <div className="strat-modal-bg open">
          <div className="strat-modal">
            <h3>Strategy Already Exists</h3>
            <p style={{ color: '#9aa5b4', fontSize: '0.88rem', margin: '0 0 1rem' }}>
              Strategy &quot;{overwrite.name}&quot; already exists. Overwrite it or save as a new strategy?
            </p>
            <div className="strat-modal-btns">
              <button type="button" className="strat-btn danger" style={{ flex: 1 }} onClick={confirmOverwrite}>Overwrite</button>
              <button type="button" className="strat-btn" style={{ flex: 1 }} onClick={saveOverwriteAsNew}>Save as New</button>
              <button type="button" className="strat-btn" style={{ flex: 1 }} onClick={() => setOverwrite(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pine Script Modal ── */}
      {pineOpen && (
        <div className="strat-modal-bg open" id="pineModal">
          <div className="strat-modal">
            <div className="pine-modal-hdr">
              <span>📜 Pine Script Export</span>
              <button type="button" onClick={() => setPineOpen(false)} title="Close">✕</button>
            </div>
            <pre className="strat-pine-out">{pineScript}</pre>
            <div className="pine-modal-ftr">
              <button type="button" className="strat-btn" onClick={copyPine}>Copy</button>
              <button type="button" className="strat-btn" onClick={() => window.open('https://www.tradingview.com/pine-editor/', '_blank')}>TradingView ↗</button>
              <button type="button" className="strat-btn" onClick={() => setPineOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bot Modal ── */}
      {botModalOpen && (
        <div className="strat-modal-bg open" id="botModal">
          <div className="strat-modal">
            <div className="bot-modal-hdr">
              <div className="bot-modal-tabs">
                <button type="button" className={`bot-modal-tab${botTab === 'controls' ? ' active' : ''}`} onClick={() => setBotTab('controls')}>Bot Controls</button>
                <button type="button" className={`bot-modal-tab${botTab === 'history' ? ' active' : ''}`} onClick={() => setBotTab('history')}>Trade History</button>
              </div>
              <button type="button" className="bot-modal-close" onClick={() => setBotModalOpen(false)}>✕</button>
            </div>

            <div className={`bot-modal-pane${botTab === 'controls' ? ' active' : ''}`}>
              {!botActive ? (
                <div>
                  <select className="strat-bot-sel" value={botSelId} onChange={(e) => setBotSelId(e.target.value)}>
                    <option value="">Select Strategy to Run…</option>
                    {strategies.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.name}{s.createdAt ? ` — ${new Date(s.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}{s.isActive ? ' 🟢 Active' : ''}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="strat-btn primary strat-btn-full" disabled={!botSelId} onClick={startBotClick}>▶ Start Bot</button>
                </div>
              ) : (
                <div>
                  <div className="bot-running-label">🟢 Bot Running</div>
                  <div className="strat-bot-row"><span>Strategy</span><span style={{ color: '#0ecb81', fontWeight: 700 }}>{runningStrategyName}</span></div>
                  <div className="strat-bot-row"><span>Status</span><span>{botStatus.status || '—'}</span></div>
                  <div className="strat-bot-row"><span>Last scan</span><span>{botStatus.lastScan ? relativeTime(botStatus.lastScan) : '—'}</span></div>
                  <div className="strat-bot-row"><span>Trades today</span><span>{botStatus.tradesToday != null ? botStatus.tradesToday : '—'}</span></div>
                  <button type="button" className="strat-btn danger strat-btn-full" onClick={stopBotClick}>⏹ Stop Bot</button>
                </div>
              )}

              <div className="bot-stats-row">
                <div className="bot-stat-cell"><span>Trades Today</span><strong>{botStats.tradesToday}</strong></div>
                <div className="bot-stat-cell"><span>Win Rate</span><strong>{botStats.winRate}</strong></div>
                <div className="bot-stat-cell"><span>Today&apos;s PnL</span><strong style={{ color: botStats.todayPnlColor }}>{botStats.todayPnl}</strong></div>
              </div>

              {discordRowVisible && (
                <div className="bot-discord-row">
                  <div>
                    <div className="bot-discord-label">Discord Alerts</div>
                    <div className="bot-discord-sub">Strategy bot trade notifications</div>
                  </div>
                  <label className="bot-toggle">
                    <input type="checkbox" checked={discordChecked} onChange={(e) => saveDiscordToggle(e.target.checked)} />
                    <span className="bot-toggle-slider" />
                  </label>
                </div>
              )}

              <hr className="bot-divider" />
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#6b7897', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '0.4rem' }}>Bot Log</div>
              <div className="log-filter-row">
                <input type="datetime-local" className="log-filter-dt" title="From (PKT)" value={logFilterFrom} onChange={(e) => setLogFilterFrom(e.target.value)} />
                <span style={{ color: '#6b7897', fontSize: '0.72rem', flexShrink: 0 }}>to</span>
                <input type="datetime-local" className="log-filter-dt" title="To (PKT)" value={logFilterTo} onChange={(e) => setLogFilterTo(e.target.value)} />
                <button type="button" className="strat-btn" style={{ padding: '0.28rem 0.7rem', fontSize: '0.75rem' }} onClick={applyLogFilter}>Filter</button>
                <button type="button" className="strat-btn" style={{ padding: '0.28rem 0.7rem', fontSize: '0.75rem' }} onClick={clearLogFilter}>Clear</button>
                <button type="button" className="strat-btn danger" style={{ padding: '0.28rem 0.7rem', fontSize: '0.75rem' }} onClick={clearAllLogs}>Clear All</button>
                <span className="log-count-label">{logs.length ? `Showing ${logs.length} log${logs.length !== 1 ? 's' : ''}` : ''}</span>
              </div>
              <div className="strat-log-feed" ref={logFeedRef} onScroll={onLogFeedScroll}>
                {logs.length === 0
                  ? <span className="log-info">— No log entries —</span>
                  : logs.map((l, i) => <div key={i} className={`log-${l.level || 'info'}`}>{formatLogTime(l)} {l.message}</div>)}
              </div>
            </div>

            <div className={`bot-modal-pane${botTab === 'history' ? ' active' : ''}`}>
              <div className="bot-hist-header">
                <div className="strat-hist-summary">
                  <span className="strat-hist-stat">Total: <span>{filteredTrades.length}</span></span>
                  <span className="strat-hist-stat">Win rate: <span className={histSummary.winColor}>{histSummary.winRate}%</span></span>
                  <span className="strat-hist-stat">Net PnL: <span className={histSummary.pnlColor}>{histSummary.pnlStr}</span></span>
                </div>
                <button type="button" className="btn-clear-hist" onClick={clearTradeHistory}>Clear History</button>
              </div>

              <div className="hist-filters">
                <select className="hist-filter-sel" value={filterStrategy} onChange={(e) => setFilterStrategy(e.target.value)}>
                  {strategyFilterOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <select className="hist-filter-sel" value={filterDir} onChange={(e) => setFilterDir(e.target.value)}>
                  <option value="all">All Directions</option>
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
                <select className="hist-filter-sel" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="all">All Status</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
                <select className="hist-filter-sel" value={sortPnl} onChange={(e) => setSortPnl(e.target.value)}>
                  <option value="default">Sort: Default</option>
                  <option value="high">PnL: High → Low</option>
                  <option value="low">PnL: Low → High</option>
                </select>
                <span className="hist-trade-count">Showing {filteredTrades.length} trade{filteredTrades.length !== 1 ? 's' : ''}</span>
              </div>

              <div className="hist-table-scroll">
                <table className="strat-hist-table">
                  <thead>
                    <tr><th>Date</th><th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th><th>PnL</th><th>Status</th><th>Strategy</th><th /></tr>
                  </thead>
                  <tbody>
                    {pagedTrades.length === 0
                      ? <tr><td colSpan={9} style={{ textAlign: 'center', color: '#2a3545', padding: '1.5rem' }}>No trade history yet</td></tr>
                      : pagedTrades.map((t) => <TradeRow key={t._id} trade={t} strategies={strategies} live={livePnl[t._id]} onClose={closeBotTrade} />)}
                  </tbody>
                </table>
              </div>
              <Pagination page={tradePage} perPage={10} total={filteredTrades.length} onChange={setTradePage} />
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile Zone Picker ── */}
      {mobilePicker && (
        <div className="mobile-zone-bg open" onClick={(e) => { if (e.target === e.currentTarget) setMobilePicker(null); }}>
          <div className="mobile-zone-sheet">
            <div className="mobile-zone-handle" />
            <div className="mobile-zone-title">Add &quot;{BLOCK_DEFS[mobilePicker]?.label}&quot; to…</div>
            <div className="mobile-zone-list">
              {computeMobileZones(mobilePicker, canvas).map((z) => (
                <button key={z.key} type="button" className="mobile-zone-btn" onClick={() => pickMobileZone(z.key)}>{z.label}</button>
              ))}
            </div>
            <button type="button" className="strat-btn strat-btn-full" onClick={() => setMobilePicker(null)}>Cancel</button>
          </div>
        </div>
      )}

      {toast && <div className="strat-toast">{toast}</div>}
    </div>
  );
}
