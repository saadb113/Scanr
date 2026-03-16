'use strict';

// ── Auto-scroll during drag ─────────────────────────────────────────────────
const SCROLL_ZONE  = 100;
const SCROLL_SPEED = 8;
let _scrollInterval = null;
let _dragClientY    = 0;

function startAutoScroll(clientY) {
  _dragClientY = clientY;
  if (_scrollInterval) return; // already ticking
  _scrollInterval = setInterval(() => {
    const wh = window.innerHeight;
    if      (_dragClientY > wh - SCROLL_ZONE) window.scrollBy(0,  SCROLL_SPEED * ((_dragClientY - (wh - SCROLL_ZONE)) / SCROLL_ZONE));
    else if (_dragClientY < SCROLL_ZONE)      window.scrollBy(0, -SCROLL_SPEED * ((SCROLL_ZONE - _dragClientY) / SCROLL_ZONE));
  }, 16);
}
function stopAutoScroll() {
  if (_scrollInterval) { clearInterval(_scrollInterval); _scrollInterval = null; }
}

// ── Touch drag state ────────────────────────────────────────────────────────
let _touchDragData  = null;
let _touchDragGhost = null;
let _touchDragActive = false;

// ── Block definitions ──────────────────────────────────────────────────────
// zones: 'filters' | 'conditions' | 'actions'
// 'exit' is treated same as 'conditions' for drop validation
const BLOCK_DEFS = {
  // INDICATORS
  RSI: {
    label: 'RSI Value', icon: '📈', category: 'INDICATORS', zones: ['filters','conditions'],
    defaults: { period: 14, condition: '<', value: 30 },
    params: [
      { key: 'period', label: 'Period', type: 'number', min: 2, max: 500 },
      { key: 'condition', label: 'Condition', type: 'select', options: ['<','>','=','<=','>='] },
      { key: 'value', label: 'Value', type: 'number', min: 0, max: 100 },
    ],
    summary: p => `RSI(${p.period}) ${p.condition} ${p.value}`,
  },
  RSI_CROSS: {
    label: 'RSI Cross', icon: '📈', category: 'INDICATORS', zones: ['conditions'],
    defaults: { period: 14, level: 50, direction: 'cross_above' },
    params: [
      { key: 'period', label: 'Period', type: 'number', min: 2, max: 500 },
      { key: 'level', label: 'Level', type: 'number', min: 0, max: 100 },
      { key: 'direction', label: 'Direction', type: 'select', options: ['cross_above','cross_below'] },
    ],
    summary: p => `RSI(${p.period}) crosses ${p.direction === 'cross_above' ? 'above' : 'below'} ${p.level}`,
  },
  MACD_CROSS: {
    label: 'MACD Cross', icon: '📊', category: 'INDICATORS', zones: ['conditions'],
    defaults: { direction: 'bullish' },
    params: [
      { key: 'direction', label: 'Direction', type: 'select', options: ['bullish','bearish'] },
    ],
    summary: p => `MACD Cross ${p.direction}`,
  },
  MACD_HIST: {
    label: 'MACD Histogram', icon: '📊', category: 'INDICATORS', zones: ['filters','conditions'],
    defaults: { condition: 'above' },
    params: [
      { key: 'condition', label: 'Histogram', type: 'select', options: ['above','below'] },
    ],
    summary: p => `MACD Hist ${p.condition} zero`,
  },
  EMA_CROSS: {
    label: 'MA Cross', icon: '〰', category: 'INDICATORS', zones: ['conditions'],
    defaults: { maType: 'EMA', fastPeriod: 12, slowPeriod: 26, direction: 'above' },
    params: [
      { key: 'maType', label: 'MA Type', type: 'select', options: ['EMA','SMA'] },
      { key: 'fastPeriod', label: 'Fast Period', type: 'number', min: 1, max: 500 },
      { key: 'slowPeriod', label: 'Slow Period', type: 'number', min: 1, max: 500 },
      { key: 'direction', label: 'Fast MA is', type: 'select', options: ['above','below'] },
    ],
    summary: p => `${p.maType||'EMA'}(${p.fastPeriod}) ${p.direction} ${p.maType||'EMA'}(${p.slowPeriod})`,
  },
  PRICE_EMA: {
    label: 'Price vs MA', icon: '〰', category: 'INDICATORS', zones: ['filters','conditions'],
    defaults: { maType: 'EMA', period: 200, direction: 'above' },
    params: [
      { key: 'maType', label: 'MA Type', type: 'select', options: ['EMA','SMA'] },
      { key: 'period', label: 'Period', type: 'number', min: 1, max: 500 },
      { key: 'direction', label: 'Price is', type: 'select', options: ['above','below'] },
    ],
    summary: p => `Price ${p.direction} ${p.maType||'EMA'}(${p.period})`,
  },
  BB: {
    label: 'Bollinger Band', icon: '🎯', category: 'INDICATORS', zones: ['conditions'],
    defaults: { period: 20, condition: 'below_lower' },
    params: [
      { key: 'period', label: 'Period', type: 'number', min: 2, max: 200 },
      { key: 'condition', label: 'Price', type: 'select', options: ['above_upper','below_lower'] },
    ],
    summary: p => `Price ${p.condition.replace('_',' ')} BB(${p.period})`,
  },
  VOLUME_SPIKE: {
    label: 'Volume Spike', icon: '🔊', category: 'INDICATORS', zones: ['filters','conditions'],
    defaults: { multiplier: 2 },
    params: [
      { key: 'multiplier', label: 'X times avg', type: 'number', min: 1, max: 20 },
    ],
    summary: p => `Volume ≥ ${p.multiplier}× avg`,
  },
  ATR: {
    label: 'ATR Value', icon: '📏', category: 'INDICATORS', zones: ['filters','conditions'],
    defaults: { period: 14, condition: '>', value: 0.5 },
    params: [
      { key: 'period', label: 'Period', type: 'number', min: 1, max: 100 },
      { key: 'condition', label: 'Condition', type: 'select', options: ['>','<','>=','<='] },
      { key: 'value', label: 'Value', type: 'number', min: 0, max: 9999999 },
    ],
    summary: p => `ATR(${p.period}) ${p.condition} ${p.value}`,
  },
  STOCHASTIC: {
    label: 'Stochastic', icon: '〽', category: 'INDICATORS', zones: ['filters','conditions'],
    defaults: { kPeriod: 14, dPeriod: 3, condition: 'k_below', value: 20 },
    params: [
      { key: 'kPeriod', label: 'K Period', type: 'number', min: 2, max: 200 },
      { key: 'dPeriod', label: 'D Period', type: 'number', min: 1, max: 50 },
      { key: 'condition', label: 'Condition', type: 'select', options: ['k_cross_above_d','k_cross_below_d','k_below','k_above','kd_both_below','kd_both_above'] },
      { key: 'value', label: 'Level (for threshold conditions)', type: 'number', min: 0, max: 100 },
    ],
    summary: p => `Stoch(${p.kPeriod},${p.dPeriod}) ${p.condition.replace(/_/g,' ')} ${['k_cross_above_d','k_cross_below_d'].includes(p.condition) ? '' : p.value}`.trim(),
  },
  // PRICE ACTION
  CANDLE_PATTERN: {
    label: 'Candle Pattern', icon: '🕯', category: 'PRICE ACTION', zones: ['conditions'],
    defaults: { pattern: 'hammer' },
    params: [
      { key: 'pattern', label: 'Pattern', type: 'select', options: [
        'hammer','shooting_star','doji','bullish_engulfing','bearish_engulfing',
        'morning_star','evening_star','pinbar',
      ]},
    ],
    summary: p => `Candle: ${p.pattern.replace(/_/g,' ')}`,
  },
  NEAR_SUPPORT: {
    label: 'Price near Support', icon: '🔽', category: 'PRICE ACTION', zones: ['conditions'],
    defaults: { pct: 1.5 },
    params: [
      { key: 'pct', label: 'Within % of swing low', type: 'number', min: 0.1, max: 20 },
    ],
    summary: p => `Price within ${p.pct}% of support`,
  },
  NEAR_RESISTANCE: {
    label: 'Price near Resistance', icon: '🔼', category: 'PRICE ACTION', zones: ['conditions'],
    defaults: { pct: 1.5 },
    params: [
      { key: 'pct', label: 'Within % of swing high', type: 'number', min: 0.1, max: 20 },
    ],
    summary: p => `Price within ${p.pct}% of resistance`,
  },
  HIGHER_HIGH: {
    label: 'Higher High formed', icon: '📐', category: 'PRICE ACTION', zones: ['conditions'],
    defaults: {},
    params: [],
    summary: () => 'Higher High formed',
  },
  LOWER_LOW: {
    label: 'Lower Low formed', icon: '📐', category: 'PRICE ACTION', zones: ['conditions'],
    defaults: {},
    params: [],
    summary: () => 'Lower Low formed',
  },
  // TREND
  TREND_4H: {
    label: '4H Trend', icon: '📡', category: 'TREND', zones: ['filters','conditions'],
    defaults: { direction: 'bullish' },
    params: [
      { key: 'direction', label: 'Direction', type: 'select', options: ['bullish','bearish','neutral'] },
    ],
    summary: p => `4H Trend = ${p.direction}`,
  },
  TREND_1H: {
    label: '1H Trend', icon: '📡', category: 'TREND', zones: ['filters','conditions'],
    defaults: { direction: 'bullish' },
    params: [
      { key: 'direction', label: 'Direction', type: 'select', options: ['bullish','bearish','neutral'] },
    ],
    summary: p => `1H Trend = ${p.direction}`,
  },
  TREND_MTF: {
    label: 'Trend (Multi-TF)', icon: '📡', category: 'TREND', zones: ['filters','conditions'],
    defaults: { timeframe: '4h', direction: 'bullish' },
    params: [
      { key: 'timeframe', label: 'Timeframe', type: 'select', options: ['15m','30m','1h','2h','4h','1D','1W'] },
      { key: 'direction', label: 'Direction', type: 'select', options: ['bullish','bearish','any'] },
    ],
    summary: p => `${p.timeframe} Trend: ${p.direction}`,
  },
  TREND_ALIGN: {
    label: 'Trend Alignment', icon: '📡', category: 'TREND', zones: ['filters','conditions'],
    defaults: { tfA: '1h', tfB: '4h', alignment: 'full' },
    params: [
      { key: 'tfA', label: 'Timeframe A', type: 'select', options: ['15m','30m','1h','2h','4h','1D','1W'] },
      { key: 'tfB', label: 'Timeframe B', type: 'select', options: ['15m','30m','1h','2h','4h','1D','1W'] },
      { key: 'alignment', label: 'Alignment', type: 'select', options: ['full','partial'] },
    ],
    summary: p => `${p.tfA} & ${p.tfB} ${p.alignment} alignment`,
  },
  // TIME
  TRADING_HOURS: {
    label: 'Trading Hours (PKT)', icon: '🕐', category: 'TIME', zones: ['filters'],
    defaults: { startHour: 8, endHour: 18 },
    params: [
      { key: 'startHour', label: 'Start Hour (0-23)', type: 'number', min: 0, max: 23 },
      { key: 'endHour', label: 'End Hour (0-23)', type: 'number', min: 0, max: 23 },
    ],
    summary: p => `Hours ${p.startHour}:00–${p.endHour}:00 PKT`,
  },
  DAY_OF_WEEK: {
    label: 'Day of Week', icon: '📅', category: 'TIME', zones: ['filters'],
    defaults: { days: 'Mon,Tue,Wed,Thu,Fri' },
    params: [
      { key: 'days', label: 'Days (comma sep)', type: 'text', placeholder: 'Mon,Tue,Wed,Thu,Fri' },
    ],
    summary: p => `Days: ${p.days}`,
  },
  // ACTIONS
  ENTER_LONG: {
    label: 'Enter Long', icon: '🟢', category: 'ACTIONS', zones: ['actions'],
    defaults: {},
    params: [],
    summary: () => 'Enter LONG',
  },
  ENTER_SHORT: {
    label: 'Enter Short', icon: '🔴', category: 'ACTIONS', zones: ['actions'],
    defaults: {},
    params: [],
    summary: () => 'Enter SHORT',
  },
  EXIT_POSITION: {
    label: 'Exit Position', icon: '⬛', category: 'ACTIONS', zones: ['actions'],
    defaults: {},
    params: [],
    summary: () => 'Exit Position',
  },
  ALERT_ONLY: {
    label: 'Send Alert Only', icon: '🔔', category: 'ACTIONS', zones: ['actions'],
    defaults: {},
    params: [],
    summary: () => 'Alert only (no order)',
  },
  // RISK
  STOP_LOSS: {
    label: 'Stop Loss', icon: '🛑', category: 'RISK', zones: ['actions'],
    defaults: { type: 'points', value: 0.5 },
    params: [
      { key: 'type', label: 'Type', type: 'select', options: ['points','rr'] },
      { key: 'value', label: 'Value', type: 'number', min: 0.0001, max: 100000 },
    ],
    summary: p => `SL: ${p.value}${p.type === 'rr' ? '× RR (TP÷RR)' : ' pts offset'}`,
  },
  TAKE_PROFIT: {
    label: 'Take Profit', icon: '🎯', category: 'RISK', zones: ['actions'],
    defaults: { type: 'rr', value: 2 },
    params: [
      { key: 'type', label: 'Type', type: 'select', options: ['rr','points'] },
      { key: 'value', label: 'Value', type: 'number', min: 0.0001, max: 100000 },
    ],
    summary: p => `TP: ${p.value}${p.type === 'rr' ? '× RR (SL×RR)' : ' pts offset'}`,
  },
  POSITION_SIZE: {
    label: 'Position Size', icon: '💰', category: 'RISK', zones: ['actions'],
    defaults: { type: 'pct_capital', value: 2 },
    params: [
      { key: 'type', label: 'Type', type: 'select', options: ['pct_capital','fixed_usdt'] },
      { key: 'value', label: 'Value', type: 'number', min: 0.01, max: 100000 },
    ],
    summary: p => `Size: ${p.value}${p.type === 'pct_capital' ? '% capital' : ' USDT'}`,
  },
};

const LIB_CATEGORIES = ['INDICATORS','PRICE ACTION','TREND','TIME','ACTIONS','RISK'];

// ── Canvas State ───────────────────────────────────────────────────────────
// ifBlocks: array of { id, type:'if'|'elseif'|'else', conditions:[], actions:[] }
// First IF block always exists; user adds ELSE IF / ELSE blocks
let _canvas = {
  filters: [],
  ifBlocks: [{ id: 'if_main', type: 'if', conditions: [], actions: [] }],
  exitConditions: [],
};

let _currentStrategyId = null;
let _strategies = [];
let _editingBlock = null; // { zone, id }
let _botActive = false;
let _botStrategyId = null; // which strategy the running bot uses
let _socket = null;

const $ = id => document.getElementById(id);

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildLibrary();
  renderIfBlocks();
  loadStrategies();
  connectSocket();
  initMobileSummary();

  // Auto-scroll for desktop drag
  document.addEventListener('dragover', e => startAutoScroll(e.clientY));
  document.addEventListener('dragend',  stopAutoScroll);
  document.addEventListener('drop',     stopAutoScroll);

  // Auto-scroll update for touch drag (interval is started/stopped by initTouchDrag)
  document.addEventListener('touchmove', e => {
    if (_touchDragActive) _dragClientY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend',    stopAutoScroll);
  document.addEventListener('touchcancel', stopAutoScroll);
});

// ── Block library ──────────────────────────────────────────────────────────
function buildLibrary() {
  const lib = $('stratLibrary');
  lib.innerHTML = '';
  const mobileBlocks = {};   // blockType → el (for mobile chips rebuild)

  for (const cat of LIB_CATEGORIES) {
    const catEl = document.createElement('div');
    catEl.className = 'strat-lib-cat';
    catEl.textContent = cat;
    lib.appendChild(catEl);
    for (const [type, def] of Object.entries(BLOCK_DEFS)) {
      if (def.category !== cat) continue;
      const el = document.createElement('div');
      el.className = 'strat-lib-block';
      el.draggable = true;
      el.dataset.blockType = type;
      el.innerHTML = `<span class="blk-icon">${def.icon}</span>${def.label}`;
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('block-type', type);
        e.dataTransfer.effectAllowed = 'copy';
      });
      // Mobile tap-to-add (only on touch / narrow screens)
      el.addEventListener('click', () => {
        if (window.innerWidth <= 768 || 'ontouchstart' in window) showMobileZonePicker(type);
      });
      initTouchDrag(el, type);
      lib.appendChild(el);
      mobileBlocks[type] = { icon: def.icon, label: def.label, category: cat };
    }
  }
  buildMobileLibrary(mobileBlocks);
}

// ── Touch drag and drop ─────────────────────────────────────────────────────
function initTouchDrag(blockEl, blockType) {
  blockEl.addEventListener('touchstart', e => {
    // Only start drag if touch is held (not a quick tap)
    const touch = e.touches[0];
    let dragStarted = false;
    let holdTimer = setTimeout(() => {
      dragStarted = true;
      e.preventDefault();
      _touchDragActive = true;
      _touchDragData   = blockType;

      _touchDragGhost = blockEl.cloneNode(true);
      _touchDragGhost.style.cssText = [
        'position:fixed', 'opacity:0.85', 'pointer-events:none', 'z-index:99999',
        `width:${blockEl.offsetWidth}px`,
        `left:${touch.clientX - blockEl.offsetWidth / 2}px`,
        `top:${touch.clientY - 24}px`,
        'background:var(--accent-green,#29ffb8)', 'color:#000',
        'padding:8px 12px', 'border-radius:6px', 'font-size:13px', 'font-weight:600',
        'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
      ].join(';');
      document.body.appendChild(_touchDragGhost);
    }, 300); // 300ms hold to start drag

    blockEl.addEventListener('touchend', () => clearTimeout(holdTimer), { once: true });
    blockEl.addEventListener('touchmove', () => {
      // If movement before hold timer fires → cancel drag, keep scroll
      if (!dragStarted) clearTimeout(holdTimer);
    }, { once: true });
  });

  blockEl.addEventListener('touchmove', e => {
    if (!_touchDragActive) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (_touchDragGhost) {
      _touchDragGhost.style.left = (touch.clientX - _touchDragGhost.offsetWidth / 2) + 'px';
      _touchDragGhost.style.top  = (touch.clientY - 24) + 'px';
    }
    startAutoScroll(touch.clientY);
    // Highlight drop zone under finger
    document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('drag-over'));
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    el?.closest('.drop-zone')?.classList.add('drag-over');
  }, { passive: false });

  blockEl.addEventListener('touchend', e => {
    stopAutoScroll();
    if (_touchDragGhost) { _touchDragGhost.remove(); _touchDragGhost = null; }
    document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('drag-over'));

    if (_touchDragActive && _touchDragData) {
      const touch  = e.changedTouches[0];
      const below  = document.elementFromPoint(touch.clientX, touch.clientY);
      const dropZone = below?.closest('.drop-zone');
      if (dropZone?.dataset.zoneKey) {
        const def = BLOCK_DEFS[_touchDragData];
        if (!handleBlockDrop(dropZone.dataset.zoneKey, _touchDragData)) {
          showToast(def ? `"${def.label}" can't go there` : 'Invalid zone');
        }
      }
    }
    _touchDragActive = false;
    _touchDragData   = null;
  });
}

// ── Mobile block library ────────────────────────────────────────────────────
let _mobileCat = 'ALL';

function buildMobileLibrary(blocks) {
  const catsEl   = $('mobileLibCats');
  const blocksEl = $('mobileLibBlocks');
  if (!catsEl || !blocksEl) return;

  // Build category pills
  const cats = ['ALL', ...LIB_CATEGORIES];
  catsEl.innerHTML = '';
  cats.forEach(cat => {
    const pill = document.createElement('button');
    pill.className = 'mobile-cat-pill' + (cat === _mobileCat ? ' active' : '');
    pill.textContent = cat === 'ALL' ? 'All Blocks' : cat;
    pill.onclick = () => {
      _mobileCat = cat;
      catsEl.querySelectorAll('.mobile-cat-pill').forEach(p => p.classList.toggle('active', p.textContent === (cat === 'ALL' ? 'All Blocks' : cat)));
      renderMobileChips(blocks);
    };
    catsEl.appendChild(pill);
  });

  renderMobileChips(blocks);
}

function renderMobileChips(blocks) {
  const blocksEl = $('mobileLibBlocks');
  if (!blocksEl) return;
  blocksEl.innerHTML = '';
  for (const [type, info] of Object.entries(blocks)) {
    if (_mobileCat !== 'ALL' && info.category !== _mobileCat) continue;
    const chip = document.createElement('button');
    chip.className = 'mobile-lib-chip';
    chip.innerHTML = `<span>${info.icon}</span>${info.label}`;
    chip.onclick = () => showMobileZonePicker(type);
    blocksEl.appendChild(chip);
  }
}

// ── Mobile zone picker ──────────────────────────────────────────────────────
function showMobileZonePicker(blockType) {
  const def = BLOCK_DEFS[blockType];
  if (!def) return;

  $('mobilePickerTitle').textContent = `Add "${def.label}" to…`;
  const list = $('mobilePickerList');
  list.innerHTML = '';

  const zones = [];
  if (def.zones.includes('filters')) zones.push({ key: 'filters', label: '📋 Filters' });
  _canvas.ifBlocks.forEach((ifb, idx) => {
    const typeLabel = ifb.type === 'if' ? 'IF' : ifb.type === 'elseif' ? `ELSE IF ${idx}` : 'ELSE';
    if (ifb.type !== 'else' && def.zones.includes('conditions'))
      zones.push({ key: `if:${ifb.id}:conditions`, label: `🔵 ${typeLabel} — Conditions` });
    if (def.zones.includes('actions'))
      zones.push({ key: `if:${ifb.id}:actions`, label: `⚡ ${typeLabel} — Actions` });
  });
  if (def.zones.includes('conditions')) zones.push({ key: 'exit', label: '🚪 Exit Conditions' });

  if (zones.length === 0) { showToast('No valid zones for this block'); return; }

  zones.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className = 'mobile-zone-btn';
    btn.textContent = label;
    btn.onclick = () => {
      closeMobileZonePicker();
      if (!handleBlockDrop(key, blockType)) showToast(`"${def.label}" can't go there`);
    };
    list.appendChild(btn);
  });

  $('mobileZonePicker').classList.add('open');
}

function closeMobileZonePicker() {
  $('mobileZonePicker').classList.remove('open');
}

// Close picker on backdrop tap
document.addEventListener('click', e => {
  if (e.target === $('mobileZonePicker')) closeMobileZonePicker();
});

// ── Mobile summary accordion ────────────────────────────────────────────────
function toggleSummaryAccordion() {
  if (window.innerWidth > 768) return;
  const hdr = $('summaryMobHdr');
  hdr.classList.toggle('expanded');
}

function initMobileSummary() {
  if (window.innerWidth <= 768) {
    // Start collapsed on mobile
    $('summaryMobHdr')?.classList.remove('expanded');
  }
}

// ── Drag & Drop ────────────────────────────────────────────────────────────
function stratDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  e.currentTarget.classList.add('drag-over');
}
function stratDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

// zoneKey: 'filters' | 'exit' | 'if:{blockId}:conditions' | 'if:{blockId}:actions'
function stratDrop(e, zoneKey) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  stopAutoScroll();
  const type = e.dataTransfer.getData('block-type');
  if (!type || !BLOCK_DEFS[type]) return;
  if (!handleBlockDrop(zoneKey, type)) alert(`"${BLOCK_DEFS[type].label}" cannot be placed in this zone.`);
}

// Shared drop handler used by desktop DnD and mobile touch/tap
function handleBlockDrop(zoneKey, blockType) {
  const def = BLOCK_DEFS[blockType];
  if (!def) return false;

  // Determine zone type for validation
  let zoneType = zoneKey;
  if (zoneKey.startsWith('if:')) zoneType = zoneKey.split(':')[2]; // 'conditions' or 'actions'
  else if (zoneKey === 'exit') zoneType = 'conditions';

  if (!def.zones.includes(zoneType)) return false;

  const block = {
    id: `blk_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    type: blockType,
    params: { ...def.defaults },
    operator: 'AND',
  };

  if (zoneKey === 'filters') {
    _canvas.filters.push(block);
    renderZone('filters');
  } else if (zoneKey === 'exit') {
    _canvas.exitConditions.push(block);
    renderZone('exit');
  } else {
    const parts = zoneKey.split(':');
    const ifBlock = _canvas.ifBlocks.find(b => b.id === parts[1]);
    if (!ifBlock) return false;
    ifBlock[parts[2]].push(block);
    renderIfBlocks();
  }
  updateOutput();
  return true;
}

// ── Canvas rendering ───────────────────────────────────────────────────────
function renderCanvas() {
  renderZone('filters');
  renderIfBlocks();
  renderZone('exit');
  updateOutput();
}

// Render filter zone OR exit zone
function renderZone(zone) {
  const isExit = zone === 'exit';
  const blocks = isExit ? _canvas.exitConditions : _canvas.filters;
  const dropId = isExit ? 'dropExit' : 'dropFilters';
  const emptyId = isExit ? 'emptyExit' : 'emptyFilters';
  const drop = $(dropId);
  Array.from(drop.querySelectorAll('.strat-block-card')).forEach(el => el.remove());
  const emptyEl = $(emptyId);
  if (blocks.length === 0) { if (emptyEl) emptyEl.style.display = ''; return; }
  if (emptyEl) emptyEl.style.display = 'none';
  blocks.forEach((block, idx) => {
    drop.appendChild(buildBlockCard(block, idx, zone === 'exit' ? 'exit' : 'filters'));
  });
}

// Render all IF/ELSE IF/ELSE blocks into #ifBlocksContainer
function renderIfBlocks() {
  const container = $('ifBlocksContainer');
  container.innerHTML = '';
  _canvas.ifBlocks.forEach((ifBlock, idx) => {
    container.appendChild(buildIfBlockEl(ifBlock, idx));
    if (ifBlock.type !== 'else') {
      container.appendChild(buildAddButtons(idx));
    }
  });
}

function buildIfBlockEl(ifBlock, idx) {
  const wrapper = document.createElement('div');
  wrapper.className = `strat-if-block if-type-${ifBlock.type}`;
  wrapper.id = `ifblock_${ifBlock.id}`;

  const typeLabel = ifBlock.type === 'if' ? '🔵 IF' : ifBlock.type === 'elseif' ? '🟡 ELSE IF' : '⚫ ELSE';
  const canDelete = !(ifBlock.type === 'if' && idx === 0);

  // Header
  const header = document.createElement('div');
  header.className = 'strat-if-header';
  header.innerHTML = `<span class="if-header-type">${typeLabel}</span>`;
  if (canDelete) {
    const delBtn = document.createElement('button');
    delBtn.className = 'if-delete-btn';
    delBtn.title = 'Delete block';
    delBtn.textContent = '✕';
    delBtn.onclick = () => removeIfBlock(ifBlock.id);
    header.appendChild(delBtn);
  }
  wrapper.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'strat-if-body';

  // Conditions drop zone (not shown for ELSE)
  if (ifBlock.type !== 'else') {
    const condLabel = document.createElement('div');
    condLabel.className = 'strat-if-sublabel';
    condLabel.textContent = 'Conditions — drag here';
    body.appendChild(condLabel);

    const condDrop = document.createElement('div');
    condDrop.className = 'strat-zone-drop';
    condDrop.id = `drop_${ifBlock.id}_conditions`;
    if (ifBlock.conditions.length === 0) {
      condDrop.innerHTML = '<div class="strat-zone-empty">Drop condition blocks here</div>';
    } else {
      ifBlock.conditions.forEach((blk, i) => {
        condDrop.appendChild(buildBlockCard(blk, i, `if:${ifBlock.id}:conditions`));
      });
    }
    attachDropZone(condDrop, `if:${ifBlock.id}:conditions`);
    body.appendChild(condDrop);
  }

  // THEN label
  const thenLabel = document.createElement('div');
  thenLabel.className = 'strat-then-label';
  thenLabel.textContent = 'THEN';
  body.appendChild(thenLabel);

  // Actions drop zone
  const actDrop = document.createElement('div');
  actDrop.className = 'strat-zone-drop';
  actDrop.id = `drop_${ifBlock.id}_actions`;
  if (ifBlock.actions.length === 0) {
    actDrop.innerHTML = '<div class="strat-zone-empty">Drop action blocks here (Enter Long/Short, SL, TP, Size)</div>';
  } else {
    ifBlock.actions.forEach((blk, i) => {
      actDrop.appendChild(buildBlockCard(blk, i, `if:${ifBlock.id}:actions`));
    });
  }
  attachDropZone(actDrop, `if:${ifBlock.id}:actions`);
  body.appendChild(actDrop);

  wrapper.appendChild(body);
  return wrapper;
}

function attachDropZone(el, zoneKey) {
  el.classList.add('drop-zone');
  el.dataset.zoneKey = zoneKey;
  el.addEventListener('dragover', stratDragOver);
  el.addEventListener('dragleave', stratDragLeave);
  el.addEventListener('drop', e => stratDrop(e, zoneKey));
}

function buildAddButtons(afterIdx) {
  const wrap = document.createElement('div');
  wrap.className = 'strat-add-btn-wrap';

  const elseifBtn = document.createElement('button');
  elseifBtn.className = 'strat-add-if-btn';
  elseifBtn.textContent = '+ Add ELSE IF';
  elseifBtn.onclick = () => addElseIf(afterIdx);
  wrap.appendChild(elseifBtn);

  const hasElse = _canvas.ifBlocks.some(b => b.type === 'else');
  // Only show "+ Add ELSE" button after last non-else block
  if (!hasElse && afterIdx === _canvas.ifBlocks.filter(b => b.type !== 'else').length - 1) {
    const elseBtn = document.createElement('button');
    elseBtn.className = 'strat-add-if-btn else';
    elseBtn.textContent = '+ Add ELSE';
    elseBtn.onclick = () => addElse();
    wrap.appendChild(elseBtn);
  }
  return wrap;
}

// ── IF block management ────────────────────────────────────────────────────
function addElseIf(afterIdx) {
  const newBlock = {
    id: `if_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    type: 'elseif', conditions: [], actions: [],
  };
  // Insert after afterIdx, before any ELSE block
  const elseIdx = _canvas.ifBlocks.findIndex(b => b.type === 'else');
  const insertAt = elseIdx >= 0 ? Math.min(afterIdx + 1, elseIdx) : afterIdx + 1;
  _canvas.ifBlocks.splice(insertAt, 0, newBlock);
  renderIfBlocks();
}

function addElse() {
  if (_canvas.ifBlocks.some(b => b.type === 'else')) return;
  _canvas.ifBlocks.push({ id: `if_else_${Date.now()}`, type: 'else', conditions: [], actions: [] });
  renderIfBlocks();
}

function removeIfBlock(blockId) {
  const idx = _canvas.ifBlocks.findIndex(b => b.id === blockId);
  if (idx === -1) return;
  // Cannot remove the first IF block
  if (idx === 0 && _canvas.ifBlocks[0].type === 'if') return;
  _canvas.ifBlocks.splice(idx, 1);
  renderIfBlocks();
  updateOutput();
}

// ── Block card builder ─────────────────────────────────────────────────────
function buildBlockCard(block, idx, zoneKey) {
  const def = BLOCK_DEFS[block.type];
  if (!def) return document.createTextNode('');
  const card = document.createElement('div');
  card.className = 'strat-block-card';
  card.dataset.blockId = block.id;

  const paramsStr = def.summary(block.params);
  let opHtml = '';
  // AND/OR only for condition zones (not filters/actions)
  const isConditionZone = zoneKey === 'exit'
    || (zoneKey.startsWith('if:') && zoneKey.endsWith(':conditions'));
  if (isConditionZone && idx > 0) {
    const op = block.operator || 'AND';
    opHtml = `<span class="bc-op ${op.toLowerCase()}" data-block-id="${block.id}" title="Click to toggle">${op}</span>`;
  }
  card.innerHTML = `
    ${opHtml}
    <span class="bc-icon">${def.icon}</span>
    <span class="bc-label">${def.label}</span>
    <span class="bc-params">${paramsStr}</span>
    <button class="bc-remove" title="Remove">✕</button>
  `;
  card.querySelector('.bc-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeBlock(zoneKey, block.id);
  });
  const opEl = card.querySelector('.bc-op');
  if (opEl) opEl.addEventListener('click', e => { e.stopPropagation(); toggleOperator(zoneKey, block.id); });
  card.addEventListener('click', e => {
    if (e.target.classList.contains('bc-remove') || e.target.classList.contains('bc-op')) return;
    openBlockEdit(zoneKey, block.id);
  });
  return card;
}

function removeBlock(zoneKey, blockId) {
  const arr = getBlockArray(zoneKey);
  if (!arr) return;
  const idx = arr.findIndex(b => b.id === blockId);
  if (idx !== -1) arr.splice(idx, 1);
  if (zoneKey === 'filters') renderZone('filters');
  else if (zoneKey === 'exit') renderZone('exit');
  else renderIfBlocks();
  updateOutput();
}

function toggleOperator(zoneKey, blockId) {
  const arr = getBlockArray(zoneKey);
  if (!arr) return;
  const block = arr.find(b => b.id === blockId);
  if (block) block.operator = block.operator === 'AND' ? 'OR' : 'AND';
  if (zoneKey === 'exit') renderZone('exit');
  else renderIfBlocks();
  updateOutput();
}

function getBlockArray(zoneKey) {
  if (zoneKey === 'filters') return _canvas.filters;
  if (zoneKey === 'exit') return _canvas.exitConditions;
  if (zoneKey.startsWith('if:')) {
    const parts = zoneKey.split(':');
    const ifBlock = _canvas.ifBlocks.find(b => b.id === parts[1]);
    return ifBlock ? ifBlock[parts[2]] : null;
  }
  return null;
}

function findBlockInCanvas(blockId) {
  const zones = [
    { arr: _canvas.filters, key: 'filters' },
    { arr: _canvas.exitConditions, key: 'exit' },
  ];
  _canvas.ifBlocks.forEach(ifb => {
    zones.push({ arr: ifb.conditions, key: `if:${ifb.id}:conditions` });
    zones.push({ arr: ifb.actions, key: `if:${ifb.id}:actions` });
  });
  for (const { arr, key } of zones) {
    const block = arr.find(b => b.id === blockId);
    if (block) return { block, zoneKey: key };
  }
  return null;
}

// ── Block edit modal ───────────────────────────────────────────────────────
function openBlockEdit(zoneKey, blockId) {
  const found = findBlockInCanvas(blockId);
  if (!found) return;
  const { block } = found;
  const def = BLOCK_DEFS[block.type];
  if (!def || def.params.length === 0) return;
  _editingBlock = { zoneKey, blockId };
  $('modalTitle').textContent = `Edit — ${def.label}`;
  const fields = $('modalFields');
  fields.innerHTML = '';
  for (const param of def.params) {
    const div = document.createElement('div');
    div.className = 'strat-field';
    const lbl = document.createElement('label');
    lbl.textContent = param.label;
    div.appendChild(lbl);
    let input;
    if (param.type === 'select') {
      input = document.createElement('select');
      param.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (block.params[param.key] === opt) o.selected = true;
        input.appendChild(o);
      });
    } else {
      input = document.createElement('input');
      input.type = param.type || 'text';
      if (param.min != null) input.min = param.min;
      if (param.max != null) input.max = param.max;
      if (param.placeholder) input.placeholder = param.placeholder;
      input.value = block.params[param.key] ?? '';
    }
    input.dataset.paramKey = param.key;
    div.appendChild(input);
    fields.appendChild(div);
  }
  $('blockEditModal').classList.add('open');

  // Show double-RR warning for STOP_LOSS / TAKE_PROFIT blocks
  if (block.type === 'STOP_LOSS' || block.type === 'TAKE_PROFIT') {
    const allActions = _canvas.ifBlocks.flatMap(b => b.actions);
    const slBlk = allActions.find(b => b.type === 'STOP_LOSS');
    const tpBlk = allActions.find(b => b.type === 'TAKE_PROFIT');
    const bothRR = slBlk?.params?.type === 'rr' && tpBlk?.params?.type === 'rr';
    const existingWarn = $('rrWarning');
    if (existingWarn) existingWarn.remove();
    if (bothRR) {
      const warn = document.createElement('div');
      warn.id = 'rrWarning';
      warn.style.cssText = 'background:#7c3b00;color:#fbd38d;padding:8px 10px;border-radius:6px;margin-top:10px;font-size:12px;line-height:1.4';
      warn.textContent = '⚠️ Both SL and TP are set to RR — they reference each other and neither can be calculated. Set either SL or TP as Price Offset first, then use RR on the other. Recommended: SL = Price Offset, TP = RR.';
      fields.appendChild(warn);
    }
  }
}

function stratSaveBlock() {
  if (!_editingBlock) return;
  const { zoneKey, blockId } = _editingBlock;
  const found = findBlockInCanvas(blockId);
  if (!found) return;
  const { block } = found;
  const inputs = $('modalFields').querySelectorAll('[data-param-key]');
  inputs.forEach(inp => {
    const key = inp.dataset.paramKey;
    block.params[key] = inp.type === 'number' ? parseFloat(inp.value) : inp.value;
  });
  _editingBlock = null;
  stratCloseModal();
  if (zoneKey === 'filters') renderZone('filters');
  else if (zoneKey === 'exit') renderZone('exit');
  else renderIfBlocks();
  updateOutput();
}

function stratCloseModal() {
  $('blockEditModal').classList.remove('open');
  _editingBlock = null;
}
$('blockEditModal').addEventListener('click', e => {
  if (e.target === $('blockEditModal')) stratCloseModal();
});

// ── Output panel ───────────────────────────────────────────────────────────
function updateOutput() {
  updateSummary();
  updatePineScript();
}

function updateSummary() {
  const el = $('stratSummary');
  const hasBlocks = _canvas.filters.length > 0
    || _canvas.ifBlocks.some(b => b.conditions.length > 0 || b.actions.length > 0)
    || _canvas.exitConditions.length > 0;

  if (!hasBlocks) {
    el.innerHTML = 'Add blocks to the canvas to build your strategy.';
    return;
  }
  const coins = $('stratCoins').value.trim() || 'your coins';
  const tf = $('stratTf').value || '5m';
  const maxTrades = $('stratMaxTrades').value || 3;

  let html = `Scans <span>${coins}</span> on <span>${tf}</span> candles (continuous). Max <span>${maxTrades}</span> trades/day.<br><br>`;

  if (_canvas.filters.length > 0) {
    html += `<b style="color:#9f7aea">Filters:</b> `;
    html += _canvas.filters.map(b => BLOCK_DEFS[b.type]?.summary(b.params)).join(', ');
    html += '<br>';
  }

  _canvas.ifBlocks.forEach((ifBlock, i) => {
    const typeLabel = ifBlock.type === 'if' ? 'IF' : ifBlock.type === 'elseif' ? 'ELSE IF' : 'ELSE';
    const color = ifBlock.type === 'if' ? '#63b3ed' : ifBlock.type === 'elseif' ? '#f59e0b' : '#9aa5b4';
    html += `<b style="color:${color}">${typeLabel}:</b> `;
    if (ifBlock.type !== 'else' && ifBlock.conditions.length > 0) {
      html += ifBlock.conditions.map((b, ci) => {
        const s = BLOCK_DEFS[b.type]?.summary(b.params) || '';
        return ci === 0 ? s : `<span style="color:#4a5568">${b.operator}</span> ${s}`;
      }).join(' ');
    }
    if (ifBlock.actions.length > 0) {
      const acts = ifBlock.actions.map(b => BLOCK_DEFS[b.type]?.summary(b.params)).filter(Boolean);
      html += ` <span style="color:#29ffb8">→ ${acts.join(', ')}</span>`;
    }
    html += '<br>';
  });

  if (_canvas.exitConditions.length > 0) {
    html += `<b style="color:#ed8936">Exit when:</b> `;
    html += _canvas.exitConditions.map((b, i) => {
      const s = BLOCK_DEFS[b.type]?.summary(b.params) || '';
      return i === 0 ? s : `<span style="color:#4a5568">${b.operator}</span> ${s}`;
    }).join(' ');
  }

  el.innerHTML = html;
}

function updatePineScript() {
  $('stratPineOut').textContent = generatePineScript();
}

// ── Pine Script generator ──────────────────────────────────────────────────
function generatePineScript() {
  const name = $('stratName').value || 'My Strategy';
  const sizeBlock = _canvas.ifBlocks.flatMap(b => b.actions).find(b => b.type === 'POSITION_SIZE');
  const sizeVal = sizeBlock ? sizeBlock.params.value : 2;

  // Collect all blocks to figure out what indicators are needed
  const allCondBlocks = [
    ..._canvas.filters,
    ..._canvas.ifBlocks.flatMap(b => b.conditions),
    ..._canvas.exitConditions,
  ];
  const usesRSI      = allCondBlocks.some(b => b.type === 'RSI');
  const usesRSICross = allCondBlocks.some(b => b.type === 'RSI_CROSS');
  const usesMACD     = allCondBlocks.some(b => ['MACD_CROSS','MACD_HIST'].includes(b.type));
  const usesATR      = [...allCondBlocks, ..._canvas.ifBlocks.flatMap(b => b.actions)].some(b =>
    b.type === 'ATR');
  const usesBB       = allCondBlocks.some(b => b.type === 'BB');
  const usesVol      = allCondBlocks.some(b => b.type === 'VOLUME_SPIKE');
  const usesStoch    = allCondBlocks.some(b => b.type === 'STOCHASTIC');
  const emaPeriods   = new Set();
  const smaPeriods   = new Set();
  allCondBlocks.forEach(b => {
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

  // Collect MTF timeframes needed for TREND_MTF and TREND_ALIGN blocks
  const TF_TO_PINE = { '15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','1D':'D','1W':'W' };
  const mtfTfSet = new Set();
  allCondBlocks.forEach(b => {
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
    const p = allCondBlocks.find(b => b.type === 'RSI' || b.type === 'RSI_CROSS')?.params.period || 14;
    L.push(`rsiVal = ta.rsi(close, ${p})`);
    if (usesRSICross) L.push('rsiPrev = rsiVal[1]');
  }
  if (usesMACD) {
    L.push('[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)');
    L.push('histPrev = histLine[1]');
  }
  if (usesATR) L.push('atrVal = ta.atr(14)');
  [...emaPeriods].forEach(p => L.push(`ema${p} = ta.ema(close, ${p})`));
  [...smaPeriods].forEach(p => L.push(`sma${p} = ta.sma(close, ${p})`));
  if (usesBB) {
    const p = allCondBlocks.find(b => b.type === 'BB')?.params.period || 20;
    L.push(`[bbMid, bbUpper, bbLower] = ta.bb(close, ${p}, 2.0)`);
  }
  if (usesVol) {
    L.push('volAvg = ta.sma(volume, 20)');
    L.push('volRatio = volume / volAvg');
  }
  if (usesStoch) {
    const stochBlock = allCondBlocks.find(b => b.type === 'STOCHASTIC');
    const kp = stochBlock?.params.kPeriod || 14;
    const dp = stochBlock?.params.dPeriod || 3;
    L.push(`stochK = ta.stoch(close, high, low, ${kp})`);
    L.push(`stochD = ta.sma(stochK, ${dp})`);
    L.push('stochKPrev = stochK[1]');
    L.push('stochDPrev = stochD[1]');
  }
  if (mtfTfSet.size > 0) {
    L.push('// ── Multi-Timeframe Trends ──');
    mtfTfSet.forEach(tf => {
      const ptf = TF_TO_PINE[tf] || '60';
      const v = `mtf${tf.replace(/[^a-zA-Z0-9]/g,'')}`;
      L.push(`${v}Close = request.security(syminfo.tickerid, "${ptf}", close)`);
      L.push(`${v}Ema50 = request.security(syminfo.tickerid, "${ptf}", ta.ema(close, 50))`);
    });
  }

  // Filters
  if (_canvas.filters.length > 0) {
    L.push('');
    L.push('// ── Filters ──');
    const fConds = _canvas.filters.map(b => blockToPine(b)).filter(Boolean);
    L.push(`filterPass = ${fConds.join(' and ')}`);
  } else {
    L.push('filterPass = true');
  }

  // Entry logic
  L.push('');
  L.push('// ── Entry Logic ──');
  if (_canvas.ifBlocks.some(b => b.conditions.length > 0 || b.type === 'else')) {
    L.push('if filterPass');
    _canvas.ifBlocks.forEach((ifBlock, idx) => {
      const keyword = ifBlock.type === 'if' ? '    if' : ifBlock.type === 'elseif' ? '    else if' : '    else';
      if (ifBlock.type === 'else') {
        L.push(`${keyword}`);
      } else {
        const parts = ifBlock.conditions.map(b => blockToPine(b)).filter(Boolean);
        const condStr = parts.length > 0 ? condsToPine(ifBlock.conditions) : 'false';
        L.push(`${keyword} ${condStr}`);
      }

      // Resolve SL/TP for this block
      const slBlk = ifBlock.actions.find(b => b.type === 'STOP_LOSS');
      const tpBlk = ifBlock.actions.find(b => b.type === 'TAKE_PROFIT');
      const dir   = ifBlock.actions.find(b => ['ENTER_LONG','ENTER_SHORT'].includes(b.type));
      const isShort = dir?.type === 'ENTER_SHORT';
      const alertOnly = ifBlock.actions.some(b => b.type === 'ALERT_ONLY');
      const exit = ifBlock.actions.some(b => b.type === 'EXIT_POSITION');

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
        L.push(`        alert("Strategy signal triggered", alert.freq_once_per_bar)`);
      } else if (dir) {
        const entryName = isShort ? `"Short${idx + 1}"` : `"Long${idx + 1}"`;
        const stratDir  = isShort ? 'strategy.short' : 'strategy.long';
        let entryArgs   = [entryName, stratDir];
        if (slBlk) entryArgs.push(isShort ? `stop=close + slDist${idx}` : `stop=close - slDist${idx}`);
        if (tpBlk) entryArgs.push(isShort ? `limit=close - tpDist${idx}` : `limit=close + tpDist${idx}`);
        L.push(`        strategy.entry(${entryArgs.join(', ')})`);
      }
    });
  }

  // Exit conditions
  if (_canvas.exitConditions.length > 0) {
    L.push('');
    L.push('// ── Exit Conditions ──');
    L.push('if strategy.position_size != 0');
    L.push(`    if ${condsToPine(_canvas.exitConditions)}`);
    L.push('        strategy.close_all(comment="Exit condition")');
  }

  return L.join('\n');
}

function condsToPine(blocks) {
  return blocks.map((b, i) => {
    const op = i === 0 ? '' : (b.operator === 'OR' ? ' or ' : ' and ');
    return op + blockToPine(b);
  }).join('');
}

function blockToPine(block) {
  const p = block.params;
  const mt = p.maType || 'EMA';
  const pfx = mt === 'SMA' ? 'sma' : 'ema';
  switch (block.type) {
    case 'RSI':         return `rsiVal ${pineOp(p.condition)} ${p.value}`;
    case 'RSI_CROSS':   return p.direction === 'cross_above'
                          ? `ta.crossover(rsiVal, ${p.level})`
                          : `ta.crossunder(rsiVal, ${p.level})`;
    case 'MACD_CROSS':  return p.direction === 'bullish' ? '(histLine > 0 and histPrev <= 0)' : '(histLine < 0 and histPrev >= 0)';
    case 'MACD_HIST':   return p.condition === 'above' ? 'histLine > 0' : 'histLine < 0';
    case 'EMA_CROSS':
    case 'MA_CROSS':    return p.direction === 'above'
                          ? `${pfx}${p.fastPeriod} > ${pfx}${p.slowPeriod}`
                          : `${pfx}${p.fastPeriod} < ${pfx}${p.slowPeriod}`;
    case 'PRICE_EMA':
    case 'PRICE_MA':    return p.direction === 'above' ? `close > ${pfx}${p.period}` : `close < ${pfx}${p.period}`;
    case 'BB':          return p.condition === 'above_upper' ? 'close > bbUpper' : 'close < bbLower';
    case 'VOLUME_SPIKE':return `volRatio >= ${p.multiplier}`;
    case 'ATR':         return `atrVal ${pineOp(p.condition)} ${p.value}`;
    case 'STOCHASTIC': {
      const cond = p.condition || 'k_below';
      const val  = p.value ?? 20;
      if (cond === 'k_cross_above_d') return 'ta.crossover(stochK, stochD)';
      if (cond === 'k_cross_below_d') return 'ta.crossunder(stochK, stochD)';
      if (cond === 'k_below')         return `stochK < ${val}`;
      if (cond === 'k_above')         return `stochK > ${val}`;
      if (cond === 'kd_both_below')   return `stochK < ${val} and stochD < ${val}`;
      if (cond === 'kd_both_above')   return `stochK > ${val} and stochD > ${val}`;
      return 'true';
    }
    case 'CANDLE_PATTERN': {
      const pat = p.pattern || 'hammer';
      if (pat === 'doji')              return 'math.abs(close - open) <= (high - low) * 0.1';
      if (pat === 'hammer')            return '(math.min(open,close) - low >= math.abs(close-open)*2) and (high - math.max(open,close) <= math.abs(close-open)*0.5)';
      if (pat === 'shooting_star')     return '(high - math.max(open,close) >= math.abs(close-open)*2) and (math.min(open,close) - low <= math.abs(close-open)*0.5)';
      if (pat === 'bullish_engulfing') return '(close > open) and (close[1] < open[1]) and (close > open[1]) and (open < close[1])';
      if (pat === 'bearish_engulfing') return '(close < open) and (close[1] > open[1]) and (open > close[1]) and (close < open[1])';
      if (pat === 'pinbar')            return 'math.max(high-math.max(open,close), math.min(open,close)-low) >= math.abs(close-open)*2.5';
      if (pat === 'morning_star')      return '(close[2] < open[2]) and (math.abs(close[1]-open[1]) <= (high[1]-low[1])*0.4) and (close > open) and (close > (open[2] + close[2]) / 2)';
      if (pat === 'evening_star')      return '(close[2] > open[2]) and (math.abs(close[1]-open[1]) <= (high[1]-low[1])*0.4) and (close < open) and (close < (open[2] + close[2]) / 2)';
      return `true // candle pattern: ${pat}`;
    }
    case 'NEAR_SUPPORT':    return `(close >= ta.lowest(low, 50) and close <= ta.lowest(low, 50) * (1 + ${+(p.pct??1)} / 100))`;
    case 'NEAR_RESISTANCE': return `(close <= ta.highest(high, 50) and close >= ta.highest(high, 50) * (1 - ${+(p.pct??1)} / 100))`;
    case 'HIGHER_HIGH': {
      return '(not na(ta.pivothigh(high, 2, 2)) and not na(ta.pivothigh(high[1], 2, 2)) and ta.pivothigh(high, 2, 2) > ta.pivothigh(high[1], 2, 2))';
    }
    case 'LOWER_LOW': {
      return '(not na(ta.pivotlow(low, 2, 2)) and not na(ta.pivotlow(low[1], 2, 2)) and ta.pivotlow(low, 2, 2) < ta.pivotlow(low[1], 2, 2))';
    }
    case 'TREND_MTF': {
      const v = `mtf${(p.timeframe||'4h').replace(/[^a-zA-Z0-9]/g,'')}`;
      if ((p.direction||'bullish') === 'any') return `(math.abs(${v}Close - ${v}Ema50) / ${v}Ema50 > 0.002)`;
      return (p.direction === 'bearish') ? `${v}Close < ${v}Ema50` : `${v}Close > ${v}Ema50`;
    }
    case 'TREND_ALIGN': {
      const vA = `mtf${(p.tfA||'1h').replace(/[^a-zA-Z0-9]/g,'')}`;
      const vB = `mtf${(p.tfB||'4h').replace(/[^a-zA-Z0-9]/g,'')}`;
      if ((p.alignment||'full') === 'partial') {
        return `(${vA}Close > ${vA}Ema50 or ${vB}Close > ${vB}Ema50)`;
      }
      return `((${vA}Close > ${vA}Ema50 and ${vB}Close > ${vB}Ema50) or (${vA}Close < ${vA}Ema50 and ${vB}Close < ${vB}Ema50))`;
    }
    default:            return `true // ${BLOCK_DEFS[block.type]?.summary(p) || block.type}`;
  }
}
function pineOp(op) { return op === '=' ? '==' : op; }

// ── Save / Load ────────────────────────────────────────────────────────────
function stratNew() {
  _currentStrategyId = null;
  _canvas = {
    filters: [],
    ifBlocks: [{ id: 'if_main', type: 'if', conditions: [], actions: [] }],
    exitConditions: [],
  };
  $('stratName').value = 'Untitled Strategy';
  if (window.setCoinsTaggerCoins) window.setCoinsTaggerCoins([]);
  else $('stratCoins').value = '';
  $('stratTf').value = '5m';
  $('stratMaxTrades').value = 3;
  $('stratDeleteBtn').style.display = 'none';
  $('stratLoadSel').value = '';
  renderCanvas();
  updateOutput();
}


async function stratDelete() {
  if (!_currentStrategyId) return;
  const name = $('stratName').value.trim();
  if (_botActive && _botStrategyId === _currentStrategyId) {
    alert('Stop the bot first before deleting this strategy.');
    return;
  }
  if (!confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) return;
  try {
    const r = await fetch(`/api/strategy/${_currentStrategyId}`, { method: 'DELETE' });
    const d = await r.json();
    if (!d.ok) return alert('Delete failed: ' + (d.error || 'Unknown'));
    showToast('Strategy deleted');
    await loadStrategies();
    const remaining = _strategies.filter(s => s._id !== _currentStrategyId);
    if (remaining.length > 0) {
      stratLoad(remaining[0]._id);
    } else {
      stratNew();
    }
  } catch (e) { alert('Error: ' + e.message); }
}
async function loadStrategies() {
  try {
    const r = await fetch('/api/strategy');
    const d = await r.json();
    if (!d.ok) return;
    _strategies = d.strategies;

    const loadSel = $('stratLoadSel');
    const botSel  = $('botStratSel');
    loadSel.innerHTML = '<option value="">Load Strategy…</option>';
    botSel.innerHTML  = '<option value="">Select Strategy to Run…</option>';

    _strategies.forEach(s => {
      const badge   = s.isActive ? ' 🟢' : '';
      const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

      const lOpt = document.createElement('option');
      lOpt.value = s._id;
      lOpt.textContent = `${s.name}${badge}`;
      if (s._id === _currentStrategyId) lOpt.selected = true;
      loadSel.appendChild(lOpt);

      const bOpt = document.createElement('option');
      bOpt.value = s._id;
      bOpt.textContent = `${s.name}${dateStr ? ' — ' + dateStr : ''}${s.isActive ? ' 🟢 Active' : ''}`;
      if (s._id === _botStrategyId) bOpt.selected = true;
      botSel.appendChild(bOpt);
    });

    // Sync bot state based on active strategy
    const activeSt = _strategies.find(s => s.isActive);
    if (activeSt) {
      _botActive = true;
      _botStrategyId = activeSt._id;
      $('botStratSel').value = activeSt._id;
      $('outBotStratName').textContent = activeSt.name;
      fetchBotStatus();
      loadTrades(activeSt._id);
    } else {
      _botActive = false;
      _botStrategyId = null;
      loadAllTrades();
    }
    updateBotUI();
    botStratSelChanged(); // sync Start button enable state
  } catch (e) { console.error('loadStrategies', e); }
}

async function stratLoad(id) {
  if (!id) return;
  const s = _strategies.find(s => s._id === id);
  if (!s) return;
  applyStrategy(s);
  $('stratDeleteBtn').style.display = '';
  $('stratLoadSel').value = id;
}

function applyStrategy(s) {
  _currentStrategyId = s._id;
  $('stratName').value = s.name || 'My Strategy';
  if (window.setCoinsTaggerCoins) window.setCoinsTaggerCoins(s.coins || []);
  else $('stratCoins').value = (s.coins || []).join(', ');
  $('stratTf').value = s.timeframe || '5m';
  $('stratMaxTrades').value = s.maxTradesPerDay || 3;

  // Support both old format (filters/conditions/actions) and new (ifBlocks)
  const blk = s.blocks || {};
  if (blk.ifBlocks) {
    _canvas = {
      filters:        (blk.filters || []).map(normalizeBlock),
      ifBlocks:       blk.ifBlocks.map(ib => ({
        id: ib.id || `if_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        type: ib.type || 'if',
        conditions: (ib.conditions || []).map(normalizeBlock),
        actions:    (ib.actions    || []).map(normalizeBlock),
      })),
      exitConditions: (blk.exitConditions || []).map(normalizeBlock),
    };
  } else {
    // Migrate old format: conditions → first IF block conditions, actions → first IF block actions
    _canvas = {
      filters:  (blk.filters    || []).map(normalizeBlock),
      ifBlocks: [{ id: 'if_main', type: 'if', conditions: (blk.conditions || []).map(normalizeBlock), actions: (blk.actions || []).map(normalizeBlock) }],
      exitConditions: [],
    };
  }
  if (_canvas.ifBlocks.length === 0) {
    _canvas.ifBlocks = [{ id: 'if_main', type: 'if', conditions: [], actions: [] }];
  }

  renderCanvas();
}

function normalizeBlock(b) {
  if (!b.id) b.id = `blk_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  if (!b.params) b.params = { ...(BLOCK_DEFS[b.type]?.defaults || {}) };
  if (!b.operator) b.operator = 'AND';
  return b;
}

async function stratSave() {
  const name = $('stratName').value.trim() || 'Untitled Strategy';
  const coins = $('stratCoins').value.split(',').map(s => s.trim()).filter(Boolean);
  const timeframe = $('stratTf').value;
  const maxTradesPerDay = parseInt($('stratMaxTrades').value) || 3;
  const pineScript = generatePineScript();
  const body = { name, blocks: _canvas, pineScript, coins, timeframe, maxTradesPerDay };

  try {
    if (_currentStrategyId) {
      // Always PUT when a strategy is loaded
      const r = await fetch(`/api/strategy/${_currentStrategyId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) return alert('Save failed: ' + (d.error || 'Unknown error'));
      showToast('Strategy saved ✓');
      loadStrategies();
    } else {
      // New strategy — check for duplicate name
      const existing = _strategies.find(s => s.name.trim().toLowerCase() === name.toLowerCase());
      if (existing) {
        showOverwriteModal(name, existing, body);
        return;
      }
      await doPostStrategy(body);
    }
  } catch (e) { alert('Save failed: ' + e.message); }
}

async function doPostStrategy(body) {
  const r = await fetch('/api/strategy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!d.ok) { alert('Save failed: ' + (d.error || 'Unknown error')); return; }
  _currentStrategyId = d.strategy._id;
  $('stratDeleteBtn').style.display = '';
  $('stratLoadSel').value = d.strategy._id;
  showToast('Strategy saved ✓');
  loadStrategies();
}

function showOverwriteModal(name, existingStrategy, saveBody) {
  $('overwriteMsg').textContent = `Strategy "${name}" already exists. Overwrite it or save as a new strategy?`;
  const modal = $('overwriteModal');
  modal.classList.add('open');

  $('overwriteConfirmBtn').onclick = async () => {
    modal.classList.remove('open');
    try {
      const r = await fetch(`/api/strategy/${existingStrategy._id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saveBody),
      });
      const d = await r.json();
      if (!d.ok) return alert('Save failed: ' + (d.error || 'Unknown'));
      _currentStrategyId = existingStrategy._id;
      $('stratDeleteBtn').style.display = '';
      showToast('Strategy overwritten ✓');
      loadStrategies();
    } catch (e) { alert('Error: ' + e.message); }
  };

  $('overwriteNewBtn').onclick = async () => {
    modal.classList.remove('open');
    await doPostStrategy(saveBody);
  };
}

async function stratExportPine() {
  const pine = generatePineScript();
  try {
    await navigator.clipboard.writeText(pine);
    showToast('Pine Script copied ✓');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = pine; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    showToast('Pine Script copied ✓');
  }
}
function stratCopyPine() {
  const pine = $('stratPineOut').textContent;
  navigator.clipboard.writeText(pine).then(() => showToast('Copied ✓')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = pine; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    showToast('Copied ✓');
  });
}
function stratOpenTV() { window.open('https://www.tradingview.com/pine-editor/', '_blank'); }

// ── Bot ────────────────────────────────────────────────────────────────────
async function stratToggleBot() {
  if (_botActive) {
    await stopBot();
  } else {
    const stratId = $('botStratSel').value;
    if (!stratId) { alert('Please select a strategy to run.'); return; }
    await startBot(stratId);
  }
}

async function startBot(stratId) {
  try {
    const r = await fetch(`/api/strategy/${stratId}/activate`, { method: 'POST' });
    const d = await r.json();
    if (!d.ok) return alert('Failed to start bot: ' + (d.error || d.message || 'Unknown'));
    _botActive = true;
    _botStrategyId = stratId;
    const strat = _strategies.find(s => s._id === stratId);
    if (strat) $('outBotStratName').textContent = strat.name;
    updateBotUI();
    showToast('Bot started ✓');
    loadTrades(stratId);
    fetchBotStatus();
    loadStrategies();
  } catch (e) { alert('Error: ' + e.message); }
}

async function stopBot() {
  const id = _botStrategyId;
  if (!id) return;
  try {
    const r = await fetch(`/api/strategy/${id}/stop`, { method: 'POST' });
    const d = await r.json();
    if (!d.ok) return alert('Failed to stop bot: ' + (d.error || 'Unknown'));
    _botActive = false;
    _botStrategyId = null;
    updateBotUI();
    showToast('Bot stopped');
    loadStrategies();
  } catch (e) { alert('Error: ' + e.message); }
}

function updateBotUI() {
  const idleUI   = $('botIdleUI');
  const activeUI = $('botActiveUI');
  if (_botActive) {
    idleUI.style.display   = 'none';
    activeUI.style.display = '';
  } else {
    idleUI.style.display   = '';
    activeUI.style.display = 'none';
    botStratSelChanged();
  }
}

function botStratSelChanged() {
  const btn = $('stratStartBotBtn');
  if (btn) btn.disabled = !$('botStratSel').value;
}

async function fetchBotStatus() {
  try {
    const r = await fetch('/api/strategy/bot/status');
    const d = await r.json();
    if (d.ok) updateBotStatusPanel(d);
  } catch (_) {}
}

function updateBotStatusPanel(d) {
  const statusEl = $('outBotStatus');
  if (statusEl) statusEl.textContent = d.status || '—';
  const lastScanEl = $('outLastScan');
  if (lastScanEl) lastScanEl.textContent = d.lastScan ? relativeTime(d.lastScan) : '—';
  const tradesTodayEl = $('outTradesToday');
  if (tradesTodayEl) tradesTodayEl.textContent = d.tradesToday != null ? d.tradesToday : '—';
}

// ── Trade history ──────────────────────────────────────────────────────────
let _allTrades     = [];
let _filterStrategy = 'all';
let _filterDir      = 'all';
let _filterStatus   = 'all';
let _sortPnl        = 'default';
let _pnlInterval    = null;
let _filteredTrades = [];

async function loadAllTrades() {
  try {
    const r = await fetch('/api/strategy/bot/trades');
    const d = await r.json();
    if (d.ok) {
      _allTrades = d.trades;
      populateStrategyFilter();
      applyFilters();
      startPnlUpdater();
    }
  } catch (_) {}
}

// Keep old name as alias so existing callers still work
function loadTrades() { return loadAllTrades(); }

function populateStrategyFilter() {
  const sel = document.getElementById('filterStrategy');
  if (!sel) return;
  const seen = new Set();
  const opts = [{ id: 'all', name: 'All Strategies' }];
  _allTrades.forEach(t => {
    if (!seen.has(t.strategyId)) {
      seen.add(t.strategyId);
      const strat = _strategies.find(s => s._id === t.strategyId);
      opts.push({ id: t.strategyId, name: strat?.name || t.strategyId?.slice(-6) || '?' });
    }
  });
  const current = sel.value;
  sel.innerHTML = opts.map(o => `<option value="${o.id}"${o.id === current ? ' selected' : ''}>${o.name}</option>`).join('');
}

function applyFilters() {
  let filtered = [..._allTrades];
  if (_filterStrategy !== 'all') filtered = filtered.filter(t => t.strategyId === _filterStrategy);
  if (_filterDir !== 'all') filtered = filtered.filter(t => (t.side || '').toLowerCase() === _filterDir);
  if (_filterStatus !== 'all') filtered = filtered.filter(t => t.status === _filterStatus);
  if (_sortPnl === 'high') filtered.sort((a, b) => (b.pnl || 0) - (a.pnl || 0));
  else if (_sortPnl === 'low') filtered.sort((a, b) => (a.pnl || 0) - (b.pnl || 0));
  renderTrades(filtered);
  const countEl = document.getElementById('tradeCount');
  if (countEl) countEl.textContent = `Showing ${filtered.length} trade${filtered.length !== 1 ? 's' : ''}`;
}

function renderTrades(trades) {
  _filteredTrades = trades || [];
  pgSetup('stratHistBody', _filteredTrades, _doRenderTradesPage);
}

function _doRenderTradesPage(slice) {
  const tbody = $('stratHistBody');
  if (!_filteredTrades.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#2a3545;padding:1.5rem">No trade history yet</td></tr>';
    updateHistSummary([]);
    return;
  }
  tbody.innerHTML = slice.map(t => {
    const isOpen = t.status === 'open';
    const pnlVal = t.pnl != null ? t.pnl : 0;
    const cls = pnlVal >= 0 ? 'pnl-pos' : 'pnl-neg';
    const pnlStr = t.pnl != null ? ((pnlVal >= 0 ? '+' : '') + pnlVal.toFixed(2)) : '—';
    const pnlPct = t.pnl != null && t.entryPrice && t.quantity
      ? (t.pnl / (t.entryPrice * t.quantity) * 100).toFixed(2) : null;
    const pnlCell = `${pnlStr} USDT${pnlPct != null ? ` <span style="font-size:0.8em;opacity:0.8">(${parseFloat(pnlPct) >= 0 ? '+' : ''}${pnlPct}%)</span>` : ''}`;
    const date = t.openedAt ? new Date(t.openedAt).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'short', timeStyle: 'short' }) : '—';
    const strat = _strategies.find(s => s._id === t.strategyId);
    const stratName = strat?.name || '—';
    const closeBtn = isOpen
      ? `<button onclick="closeBotTrade('${t._id}')" style="background:#3a1a1a;border:1px solid #7f3a3a;border-radius:5px;color:#f56565;font-family:inherit;font-size:0.72rem;font-weight:700;padding:0.18rem 0.55rem;cursor:pointer;white-space:nowrap" onmouseover="this.style.background='#f56565';this.style.color='#fff'" onmouseout="this.style.background='#3a1a1a';this.style.color='#f56565'">Close</button>`
      : '';
    return `<tr data-trade-id="${t._id}" data-symbol="${t.symbol}" data-side="${t.side}" data-entry="${t.entryPrice}" data-qty="${t.quantity}" data-status="${t.status}">
      <td>${date}</td>
      <td style="font-weight:700;color:#e5e9f2">${t.symbol}</td>
      <td><span class="badge badge-${(t.side||'').toLowerCase()}">${(t.side||'').toUpperCase()}</span></td>
      <td>${t.entryPrice != null ? t.entryPrice.toFixed(4) : '—'}</td>
      <td>${t.exitPrice != null ? t.exitPrice.toFixed(4) : '—'}</td>
      <td id="pnl-${t._id}" class="${cls}" style="font-weight:700">${pnlCell}</td>
      <td><span class="badge badge-${t.status}">${t.status}</span></td>
      <td style="color:#8a95a8;font-size:0.8rem;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${stratName}</td>
      <td>${closeBtn}</td>
    </tr>`;
  }).join('');
  updateHistSummary(_filteredTrades);
}

function startPnlUpdater() {
  if (_pnlInterval) clearInterval(_pnlInterval);
  _pnlInterval = setInterval(updateOpenPnl, 3000);
}

async function updateOpenPnl() {
  const openRows = document.querySelectorAll('#stratHistBody tr[data-status="open"]');
  if (!openRows.length) return;
  const symbols = [...new Set([...openRows].map(r => r.dataset.symbol))];
  const prices = {};
  await Promise.all(symbols.map(async sym => {
    try {
      const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}`);
      const d = await r.json();
      const price = parseFloat(d?.result?.list?.[0]?.lastPrice);
      if (!isNaN(price)) prices[sym] = price;
    } catch (_) {}
  }));
  openRows.forEach(row => {
    const currentPrice = prices[row.dataset.symbol];
    if (!currentPrice) return;
    const side  = (row.dataset.side || '').toLowerCase();
    const entry = parseFloat(row.dataset.entry);
    const qty   = parseFloat(row.dataset.qty);
    if (isNaN(entry) || isNaN(qty) || qty === 0) return;
    const pnl    = side === 'long' ? (currentPrice - entry) * qty : (entry - currentPrice) * qty;
    const pnlPct = pnl / (entry * qty) * 100;
    const cls    = pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    const cell   = document.getElementById(`pnl-${row.dataset.tradeId}`);
    if (cell) {
      cell.className = cls;
      cell.innerHTML = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT <span style="font-size:0.8em;opacity:0.8">(${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)</span>`;
    }
  });
}

async function closeBotTrade(tradeId) {
  if (!confirm('Close this position now? A market close order will be placed immediately.')) return;
  try {
    const r = await fetch(`/api/strategy/close-trade/${tradeId}`, { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      await loadAllTrades();
    } else {
      alert('Failed to close: ' + (d.error || 'Unknown error'));
    }
  } catch (e) { alert('Error: ' + e.message); }
}

async function clearTradeHistory() {
  if (!confirm('This will permanently delete all closed trade history for all strategies.\nOpen trades will NOT be deleted.\n\nAre you sure?')) return;
  try {
    const r = await fetch('/api/strategy/trades/clear', { method: 'DELETE' });
    const d = await r.json();
    if (d.ok) {
      let msg = `Cleared ${d.deleted} trade(s).`;
      if (d.openSkipped > 0) msg += ` ${d.openSkipped} open trade(s) were not cleared.`;
      showToast(msg);
      await loadAllTrades();
    } else {
      alert('Failed to clear: ' + (d.error || 'Unknown error'));
    }
  } catch (e) { alert('Error: ' + e.message); }
}

function updateHistSummary(trades) {
  const closed = trades.filter(t => t.status === 'closed');
  const wins = closed.filter(t => (t.pnl || 0) > 0).length;
  const totalPnl = closed.reduce((a, t) => a + (t.pnl || 0), 0);
  $('stratHistSummary').innerHTML = `
    <span class="strat-hist-stat">Total: <span>${trades.length}</span></span>
    <span class="strat-hist-stat">Win rate: <span class="${wins > closed.length / 2 ? 'green' : 'red'}">${closed.length ? Math.round(wins / closed.length * 100) : 0}%</span></span>
    <span class="strat-hist-stat">Net PnL: <span class="${totalPnl >= 0 ? 'green' : 'red'}">${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT</span></span>
  `;
}

// ── Socket.io ──────────────────────────────────────────────────────────────
function connectSocket() {
  try {
    _socket = io();
    _socket.on('strategy:log',            data => addLog(data));
    _socket.on('strategy:scan_started',   d => addLog({ level: 'info',    message: `Scanning ${d.total} coins…` }));
    _socket.on('strategy:scan_complete',  d => { addLog({ level: 'success', message: `Scan done — ${d.found} signal(s) in ${d.duration}s` }); fetchBotStatus(); });
    _socket.on('strategy:conditions_met', d => addLog({ level: 'success', message: `✔ ${d.symbol} — ${d.side} signal` }));
    _socket.on('strategy:order_placed',   d => { addLog({ level: 'success', message: `Order: ${d.symbol} ${d.side} @ ${d.entry}` }); loadAllTrades(); });
    _socket.on('strategy:trade_closed',   d => { addLog({ level: 'info',    message: `Closed: ${d.symbol} ${d.type} PnL: ${d.pnl?.toFixed(2)}` }); loadAllTrades(); });
    _socket.on('strategy:order_failed',   d => addLog({ level: 'error',   message: `Order failed ${d.symbol}: ${d.error}` }));
  } catch (_) {}
}

function addLog(entry) {
  const feed = $('stratLogFeed');
  if (feed.querySelector('span')?.textContent?.includes('No log entries')) feed.innerHTML = '';
  const tsRaw = entry.timestamp || entry.ts;
  const ts = new Date(tsRaw || Date.now()).toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour12: false });
  const div = document.createElement('div');
  div.className = `log-${entry.level || 'info'}`;
  div.textContent = `${ts} ${entry.message}`;

  // Append to BOTTOM (newest logs at bottom)
  feed.appendChild(div);

  // Keep max 100 logs in memory (oldest auto-prune)
  while (feed.children.length > 100) feed.removeChild(feed.firstChild);

  // Smart auto-scroll: only scroll if user is at bottom (within 10px tolerance)
  const isAtBottom = feed.scrollTop >= feed.scrollHeight - feed.clientHeight - 10;
  if (isAtBottom) feed.scrollTop = feed.scrollHeight;
}

function renderLogs(logs) {
  if (!logs?.length) return;
  $('stratLogFeed').innerHTML = '';
  logs.slice(-20).forEach(entry => addLog(entry));
}

// ── Helpers ────────────────────────────────────────────────────────────────
function relativeTime(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function showToast(msg) {
  let t = document.getElementById('stratToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'stratToast';
    Object.assign(t.style, {
      position: 'fixed', bottom: '1.5rem', right: '1.5rem',
      background: '#1a3a2e', color: '#29ffb8', border: '1px solid #29ffb8',
      padding: '0.6rem 1rem', borderRadius: '8px', fontWeight: '700',
      fontSize: '0.85rem', zIndex: '9999', transition: 'opacity 0.3s',
    });
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}
