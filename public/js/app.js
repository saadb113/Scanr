// ═══════════════════════════════════════
//  PAGE ROUTING
// ═══════════════════════════════════════
const _PAGE = (() => {
    const p = window.location.pathname;
    if (p === '/settings') return 'settings';
    if (p === '/terminal') return 'terminal';
    return 'scanner';
})();
document.documentElement.setAttribute('data-page', _PAGE);

// ═══════════════════════════════════════
//  PERSISTENCE
// ═══════════════════════════════════════

const DEFS = {
    timeframe: '1m', rsiLen: 14, fastLen: 12, slowLen: 26, signalLen: 9, cellSize: 160,
    symbols: null,
    colors: { rsi:'#29ffb8', rsiOB:'#f56565', rsiOS:'#48bb78', macd:'#63b3ed', signal:'#f6ad55', bull:'#48bb78', bear:'#f56565', lw: 2, price:'#e5e9f2' },
    visibility: { price: true, rsi: true, macd: true },
    priceType: 'line'
};

// ─── API helpers ────────────────────────────────────────────
async function apiGet(path) {
    try { const r = await fetch(path); return r.ok ? r.json() : {}; } catch { return {}; }
}
async function apiPost(path, body) {
    try {
        const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        return await r.json();
    } catch(e) { return null; }
}
async function apiDelete(path, body) {
    try { await fetch(path, { method:'DELETE', headers:{'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined }); } catch(e) {}
}

// ─── Scanner settings ────────────────────────────────────────
let _savedSettings = {}; // loaded on boot via loadAppState()
function lsSave() {
    const body = {
        rsiLen:        +el('rsiLen').value,
        fastLen:       +el('fastLen').value,
        slowLen:       +el('slowLen').value,
        signalLen:     +el('signalLen').value,
        cellSize:      +el('cellSizeSlider').value,
        symbols:       [...symbols],
        activeSymbols: [...symbols],
        colors:        { ...colors },
        visibility:    { ...visibility },
        priceType:     priceType,
        activeSort:    activeSort
    };
    if (el('timeframe')) body.timeframe = el('timeframe').value;
    apiPost('/api/settings', body);
}

// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════
const saved = _savedSettings; // populated by loadAppState() before DOMContentLoaded fires
let symbols = [];
let cellSize = DEFS.cellSize;
let indicatorData = {};
let colors = Object.assign({}, DEFS.colors);

// Visibility settings
let visibility = Object.assign({}, DEFS.visibility);
let priceType = DEFS.priceType;


// Drawing
let isDrawing=false, currentTool='brush', currentColor='#29ffb8', toolSize=3;
let drawObjs=[], curDraw=null, drawHistory=[], histIdx=-1;
let activeCanvas=null, activeCtx=null, currentSym='';
let priceCvs=null, rsiCvs=null, macdCvs=null, priceCtx=null, rsiCtx=null, macdCtx=null;

// Filter
let activeFilter = 'all';

// Watchlist
let watchlist = [];
function saveWatchlist() { apiPost('/api/watchlist', { symbols: watchlist }); }

// Sort
let activeSort = 'default';

// Layout (grid | list)
let layout = localStorage.getItem('SCANR_layout') || 'grid';

// TradingView
let tvMode = false;
let tvWidget = null;
const TV_TF_MAP = {'1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','8h':'480','1d':'D','3d':'3D','1w':'W'};

const SCANNER_TIMEFRAMES_KEY = 'scanner_timeframes';
const SCANNER_TF_OPTIONS = [
    { value: '1m', label: '1m' },
    { value: '3m', label: '3m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' },
    { value: '30m', label: '30m' },
    { value: '1h', label: '1h' },
    { value: '2h', label: '2h' },
    { value: '4h', label: '4h' },
    { value: '1d', label: '1D' },
    { value: '1w', label: '1W' }
];
const FREE_TIMEFRAME_LIMIT = 3;
let scannerIsPremium = false;
let activeTimeframes = [];
let activeScannerTimeframe = '1m';

// Drag
let dragSrc=null;

const el = id => document.getElementById(id);
const gridEl = el.bind(null,'gridContainer'); // called later

// ═══════════════════════════════════════
//  ALL KNOWN FUTURES SYMBOLS
// ═══════════════════════════════════════
const UNIVERSE = [
    'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOTUSDT','DOGEUSDT',
    'AVAXUSDT','LINKUSDT','LTCUSDT','UNIUSDT','ATOMUSDT','NEARUSDT','FILUSDT','BCHUSDT',
    'XLMUSDT','VETUSDT','THETAUSDT','AXSUSDT','ETCUSDT','ALGOUSDT','SANDUSDT','MANAUSDT',
    'GALAUSDT','APEUSDT','GRTUSDT','AAVEUSDT','CHZUSDT','ENJUSDT','KAVAUSDT','RUNEUSDT',
    'STXUSDT','SUSHIUSDT','ZECUSDT','ZILLUSDT','ICPUSDT','ARUSDT','COMPUSDT','CRVUSDT',
    'DYDXUSDT','EGLDUSDT','ENSUSDT','IMXUSDT','INJUSDT','LDOUSDT','MKRUSDT','OPUSDT',
    'RENDERUSDT','ROSEUSDT','RVNUSDT','SKLUSDT','TRXUSDT','YFIUSDT','1INCHUSDT','CFXUSDT',
    'BANDUSDT','BATUSDT','CELRUSDT','DENTUSDT','PYTHUSDT','HOTUSDT','KNCUSDT','MASKUSDT',
    'NKNUSDT','ONTUSDT','QNTUSDT','TONUSDT','TIAUSDT','WIFUSDT','SUPERUSDT','HBARUSDT',
    'WOOUSDT','TRBUSDT','ANKRUSDT','CHRUSDT','SOLVUSDT','JUPUSDT','ORDIUSDT','TNSRUSDT',
    'HIVEUSDT','JSTUSDT','LPTUSDT','MINAUSDT','NMRUSDT','RLCUSDT','ACHUSDT','STRKUSDT',
    'TAOUSDT','BERAUSDT','HYPERUSDT','SEIUSDT','POLUSDT','PAXGUSDT','JTOUSDT','RSRUSDT',
    'PERPUSDT','ONDOUSDT','PHBUSDT','SXPUSDT','UMAUSDT','REZUSDT','ARPAUSDT','XTZUSDT',
    'MBOXUSDT','QTUMUSDT','KSMUSDT','ONEUSDT','COTIUSDT','FORMUSDT','TLMUSDT','PENGUUSDT',
    'BIOUSDT','SAGAUSDT','TRUMPUSDT','OMNIUSDT','NEOUSDT','DASHUSDT','C98USDT','BELLUSDT',
    'CTKUSDT','IOSTUSDT','FLOWUSDT','FETUSDT','AGIXUSDT','WLDUSDT','ARBUSDT','GMXUSDT',
    'APTUSDT','SUIUSDT','PEPEUSDT','FLOKIUSDT','BLURUSDT','PENDLEUSDT','CYBERUSDT','ARKMUSDT',
    'CELOUSDT','OCEANUSDT','IDUSDT','SFPUSDT','OMUSDT','RNDRUSDT','XVSUSDT','YGGUSDT',
    'HIGHUSDT','KEYUSDT','LINAUSDT','GTCUSDT','CTSIUSDT','DUSKUSDT','TOKENUSDT','VANRYUSDT'
];

const DEFAULT_SYMBOLS = [
    'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOTUSDT','DOGEUSDT',
    'AVAXUSDT','LINKUSDT','LTCUSDT','UNIUSDT','ATOMUSDT','NEARUSDT','FILUSDT','BCHUSDT',
    'XLMUSDT','VETUSDT','THETAUSDT','AXSUSDT','ETCUSDT','ALGOUSDT','SANDUSDT','MANAUSDT',
    'GALAUSDT','APEUSDT','GRTUSDT','AAVEUSDT','CHZUSDT','ENJUSDT','KAVAUSDT','RUNEUSDT',
    'STXUSDT','SUSHIUSDT','ZECUSDT','ZILLUSDT','ICPUSDT','ARUSDT','COMPUSDT','CRVUSDT',
    'DYDXUSDT','EGLDUSDT','INJUSDT','LDOUSDT','MKRUSDT','OPUSDT','RENDERUSDT','ROSEUSDT',
    'TRXUSDT','YFIUSDT','1INCHUSDT','CFXUSDT','BATUSDT','PYTHUSDT','KNCUSDT','MASKUSDT',
    'TONUSDT','TIAUSDT','WIFUSDT','SUPERUSDT','HBARUSDT','TRBUSDT','ANKRUSDT','SOLVUSDT',
    'JUPUSDT','ORDIUSDT','TNSRUSDT','LPTUSDT','MINAUSDT','STRKUSDT','TAOUSDT','SEIUSDT',
    'POLUSDT','PAXGUSDT','JTOUSDT','PERPUSDT','ONDOUSDT','SXPUSDT','XTZUSDT','NEOUSDT',
    'PENGUUSDT','SAGAUSDT','TRUMPUSDT','FETUSDT','ARBUSDT','APTUSDT','SUIUSDT','PEPEUSDT',
    'WLDUSDT','GMXUSDT','FLOKIUSDT','OCEANUSDT','PENDLEUSDT','CYBERUSDT'
];

// ═══════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════

async function loadAppState() {
    // Scanner settings — returns plain object
    const s = await apiGet('/api/settings');
    Object.assign(_savedSettings, s);
    if (s.cellSize)   cellSize   = s.cellSize;
    if (s.colors)     Object.assign(colors, s.colors);
    if (s.visibility) Object.assign(visibility, s.visibility);
    if (s.priceType)  priceType  = s.priceType;
    if (s.activeSort) activeSort = s.activeSort;
    // Restore symbols on every page so coins tab shows correct state
    if (s.symbols && s.symbols.length) symbols = [...s.symbols];
    // Apply accent color to all CSS vars immediately
    window._accentColor = s.accentColor || '#00e5a0';
    if (typeof window.applyAccentColor === 'function') window.applyAccentColor(window._accentColor);
    else document.documentElement.style.setProperty('--accent-green', window._accentColor);

    // Watchlist — returns [] directly
    const wl = await apiGet('/api/watchlist');
    if (Array.isArray(wl)) watchlist = wl;

    // Filter visibility — returns plain object
    const fv = await apiGet('/api/filter-vis');
    window._filterVis = (fv && typeof fv === 'object') ? fv : {};

    // Position calculator settings — returns plain object
    const ps = await apiGet('/api/pos-settings');
    window._posSettings = (ps && typeof ps === 'object') ? ps : {};

    // Drawings — returns plain { sym: { tf: [...] } } object
    const dr = await apiGet('/api/drawings');
    if (dr && typeof dr === 'object') _drawingsCache = dr;

    // Kimi AI settings — returns plain object
    const ks = await apiGet('/api/kimi-settings');
    window._kimiSettings = (ks && typeof ks === 'object') ? ks : {};

    // Kimi AI cache — returns plain { "SYM:TF": {...} } object
    const kc = await apiGet('/api/kimi-cache');
    if (kc && typeof kc === 'object') _kimiCache = kc;

    // Bybit credentials — returns { activeEnv, mainnet, testnet }
    const bs = await apiGet('/api/bybit-store');
    window._bybitStore = (bs && typeof bs === 'object') ? bs : {};

    // App name (public endpoint, used for branding)
    try {
        const an = await fetch('/api/public/app-name').then(r => r.json());
        window._appName = an.appName || '';
    } catch(_) { window._appName = ''; }
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadAppState();

    if (_PAGE === 'scanner') {
        await loadScannerTier();
        initTimeframePicker();
    }

    restoreControls();
    applyColorsToInputs();

    // control change listeners (scanner elements only)
    if (el('timeframe')) {
        ['timeframe','rsiLen','fastLen','slowLen','signalLen'].forEach(id =>
            el(id).addEventListener('change', () => { lsSave(); refresh(); }));
        el('cellSizeSlider').addEventListener('input', e => {
            cellSize = +e.target.value;
            const lbl = el('sCellSizeVal'); if (lbl) lbl.textContent = cellSize;
            updateGrid(); lsSave();
        });
        // Set initial cell size label
        { const lbl = el('sCellSizeVal'); if (lbl) lbl.textContent = cellSize; }
    }

    // Sort dropdown
    initSort();
    // Watchlist
    initWatchlistFilter();

    // settings panel — navigate to /settings page
    const _sb = el('settingsBtn'); if (_sb) _sb.addEventListener('click', () => window.location.href = '/settings');
    const _cs = el('closeSettings'); if (_cs) _cs.addEventListener('click', () => window.location.href = '/');

    // Tab switching
    document.querySelectorAll('.sp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.sp-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.sp-page').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const pg = document.getElementById('sp-' + tab.dataset.tab);
            if (pg) pg.classList.add('active');
            if (tab.dataset.tab === 'drawings') renderDrawingsManager();
            if (tab.dataset.tab === 'bybit') {
                // Reload store from server so latest saved credentials appear
                apiGet('/api/bybit-store').then(bs => {
                    if (bs && typeof bs === 'object') {
                        window._bybitStore = bs;
                        const store = bybitGetStore();
                        if (el('bybitLiveKey')) {
                            if (store.mainnet?.apiKey)    el('bybitLiveKey').value    = store.mainnet.apiKey;
                            if (store.mainnet?.apiSecret) el('bybitLiveSecret').value = store.mainnet.apiSecret;
                            if (store.testnet?.apiKey)    el('bybitDemoKey').value    = store.testnet.apiKey;
                            if (store.testnet?.apiSecret) el('bybitDemoSecret').value = store.testnet.apiSecret;
                            bybitSwitchAccount(store.activeEnv || 'mainnet', false);
                        }
                    }
                });
            }
        });
    });

    // Clear ALL drawings button
    document.addEventListener('click', e => {
        if (e.target && e.target.id === 'clearAllDrawingsBtn') {
            if (confirm('Clear ALL drawings from ALL coins? This cannot be undone.')) {
                drawingsClearAll();
                drawObjs = []; drawHistory = []; histIdx = -1;
                if (el('modal') && el('modal').classList.contains('open')) { redrawModal(); updateUndoBtns(); }
                renderDrawingsManager();
            }
        }
    });

    // Toggle API key show/hide
    document.addEventListener('click', e => {
        if (e.target && e.target.id === 'toggleApiKey') {
            const inp = document.getElementById('kimiApiKey');
            const isPass = inp.type === 'password';
            inp.type = isPass ? 'text' : 'password';
            e.target.textContent = isPass ? 'Hide' : 'Show';
        }
    });
    // Settings panel element listeners (not present on terminal.html)
    if (el('resetSettings')) {
        el('resetSettings').addEventListener('click', async () => {
            if (!confirm('Reset everything to defaults?')) return;
            await apiDelete('/api/settings');
            location.reload();
        });
        ['sRsiColor','sRsiOBColor','sRsiOSColor','sMacdColor','sSignalColor','sBullColor','sBearColor'].forEach(id =>
            el(id).addEventListener('input', onColorChange));
        el('sLineWidth').addEventListener('input', e => {
            el('sLWVal').textContent = e.target.value; onColorChange();
        });
        // Price chart settings
        el('sPriceColor').addEventListener('input', onColorChange);
        el('sShowPrice').addEventListener('change', onColorChange);
        el('sShowRSI').addEventListener('change', onColorChange);
        el('sShowMACD').addEventListener('change', onColorChange);
        el('sPriceType').addEventListener('change', onColorChange);
        // Indicator params + cell size — only on settings page (scanner handles these inside if(el('timeframe')))
        if (!el('timeframe')) {
            ['rsiLen','fastLen','slowLen','signalLen'].forEach(id =>
                el(id).addEventListener('change', lsSave));
            el('cellSizeSlider').addEventListener('input', e => {
                cellSize = +e.target.value;
                const lbl = el('sCellSizeVal'); if (lbl) lbl.textContent = cellSize;
                lsSave();
            });
        }
    }

    // modal (scanner only)
    if (el('closeModal')) el('closeModal').addEventListener('click', closeModal);
    if (el('modal')) el('modal').addEventListener('click', e => { if (e.target === el('modal')) closeModal(); });

    // search (scanner only)
    if (el('searchInput')) initSearch();
    document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) closeDropdown(); });

    if (_PAGE === 'scanner') {
        // On scanner page: ensure symbols are set (use defaults if nothing saved yet)
        if (!symbols.length) symbols = [...DEFAULT_SYMBOLS];
        symbols.forEach(s => { indicatorData[s] = null; });
        setLayout(layout);   // apply saved layout (grid or list)
        refresh();
        setInterval(refresh, 20000);
        new ResizeObserver(() => { updateGrid(); redrawAll(); }).observe(document.getElementById('gridContainer'));
        initFilter();
        loadLastScan();
    }
    // initFilterToggles runs on all pages — filter toggles are in the settings panel
    initFilterToggles();
    initCoinList();
    initKimiAI();
    initPosCalculator();
    initBybit();

    if (_PAGE === 'settings') {
        document.title = 'Settings — ' + (window._appName || 'SCANR');
        // Tab selection from sessionStorage is handled by the inline script in settings.html
    }

    if (_PAGE === 'terminal') {
        document.title = 'Terminal — ' + (window._appName || 'SCANR');
        const _prefill = (() => { try { return JSON.parse(sessionStorage.getItem('bybit_prefill')); } catch { return null; } })();
        sessionStorage.removeItem('bybit_prefill');
        bybitTerminalOpen(_prefill ? _prefill.sym : undefined);
        if (_prefill) {
            setTimeout(() => {
                bytSetDir(_prefill.dir === 'LONG' ? 'Buy' : 'Sell');
                if (_prefill.entry) el('bytEntry').value = _prefill.entry;
                if (_prefill.sl)    el('bytSL').value    = _prefill.sl;
                if (_prefill.tp)    el('bytTP').value    = _prefill.tp;
                if (_prefill.maxLev) {
                    bytMaxLev = _prefill.maxLev;
                    el('bytLevSlider').max   = _prefill.maxLev;
                    el('bytLevInput').max    = _prefill.maxLev;
                    el('bytLevSlider').value = _prefill.maxLev;
                    el('bytLevInput').value  = _prefill.maxLev;
                    el('bytMaxLevLabel').textContent = `Max: ${_prefill.maxLev}x`;
                    bytUpdateSummary();
                }
            }, 200);
        }
        // If autopilot was running when the page was last closed, resume the display
        apCheckResume();
    }
});

function restoreControls() {
    const tf = el('timeframe');
    if (tf && saved.timeframe && _PAGE !== 'scanner') tf.value = saved.timeframe;
    const ri = el('rsiLen');    if (ri && saved.rsiLen)    ri.value = saved.rsiLen;
    const fa = el('fastLen');   if (fa && saved.fastLen)   fa.value = saved.fastLen;
    const sl = el('slowLen');   if (sl && saved.slowLen)   sl.value = saved.slowLen;
    const sg = el('signalLen'); if (sg && saved.signalLen) sg.value = saved.signalLen;
    if (saved.cellSize) { const cs = el('cellSizeSlider'); if (cs) { cs.value = saved.cellSize; cellSize = saved.cellSize; } }
    if (saved.activeSort) { activeSort = saved.activeSort; }
}

async function loadScannerTier() {
    try {
        const res = await fetch('/api/auth/session-check', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const tier = (data && data.user && data.user.accountTier) || data.accountTier || 'free';
        scannerIsPremium = tier === 'premium';
    } catch (_) {}
}

function getTimeframeLabel(v) {
    const found = SCANNER_TF_OPTIONS.find(x => x.value === v);
    return found ? found.label : v;
}

function saveScannerTimeframes() {
    try { localStorage.setItem(SCANNER_TIMEFRAMES_KEY, JSON.stringify(activeTimeframes)); } catch(_) {}
}

function loadScannerTimeframesFromStorage() {
    let savedList = null;
    try {
        const raw = localStorage.getItem(SCANNER_TIMEFRAMES_KEY);
        savedList = raw ? JSON.parse(raw) : null;
    } catch(_) {}

    const valid = Array.isArray(savedList)
        ? savedList.filter(v => SCANNER_TF_OPTIONS.some(o => o.value === v))
        : [];

    if (valid.length) {
        if (!scannerIsPremium) return valid.slice(0, FREE_TIMEFRAME_LIMIT);
        return valid;
    }

    return scannerIsPremium ? ['1h', '4h'] : ['1m', '3m', '15m'];
}

function syncActiveTimeframeToSelect() {
    const tfSel = el('timeframe');
    if (!tfSel) return;
    tfSel.value = activeScannerTimeframe;
}

function hideTfDropdownAndTooltip() {
    const dd = el('tfDropdown');
    const tip = el('tfLimitTooltip');
    if (dd) dd.classList.remove('open');
    if (tip) tip.style.display = 'none';
}

function showTfLimitTooltip() {
    const tip = el('tfLimitTooltip');
    if (!tip) return;
    tip.innerHTML = `Free users can add up to 3 timeframes.<br>Upgrade to Premium for unlimited timeframes.<br><button class="tf-limit-upgrade" id="tfLimitUpgradeBtn">Upgrade ⚡</button>`;
    tip.style.display = 'block';
    const btn = el('tfLimitUpgradeBtn');
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.showUpgradeModal === 'function') window.showUpgradeModal();
            else window.location.href = '/pricing';
        });
    }
}

function renderTfPills() {
    const wrap = el('tfPills');
    if (!wrap) return;
    wrap.innerHTML = '';
    activeTimeframes.forEach(tf => {
        const pill = document.createElement('button');
        pill.className = 'tf-pill' + (tf === activeScannerTimeframe ? ' active' : '');
        pill.type = 'button';
        pill.innerHTML = `<span>${getTimeframeLabel(tf)}</span><span class="tf-pill-remove" title="Remove" role="button" aria-label="Remove timeframe">×</span>`;
        pill.addEventListener('click', () => {
            if (activeScannerTimeframe !== tf) {
                activeScannerTimeframe = tf;
                syncActiveTimeframeToSelect();
                renderTfPills();
                lsSave();
                refresh();
            }
        });
        const rm = pill.querySelector('.tf-pill-remove');
        rm.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeTimeframes.length <= 1) return;
            activeTimeframes = activeTimeframes.filter(x => x !== tf);
            if (activeScannerTimeframe === tf) {
                activeScannerTimeframe = activeTimeframes[0];
                syncActiveTimeframeToSelect();
                lsSave();
                refresh();
            }
            saveScannerTimeframes();
            renderTfPills();
            renderTfDropdown();
        });
        wrap.appendChild(pill);
    });
}

function renderTfDropdown() {
    const dd = el('tfDropdown');
    if (!dd) return;
    dd.innerHTML = '';
    SCANNER_TF_OPTIONS.forEach(opt => {
        const isActive = activeTimeframes.includes(opt.value);
        const canAddMore = scannerIsPremium || activeTimeframes.length < FREE_TIMEFRAME_LIMIT;
        const locked = !scannerIsPremium && !isActive && !canAddMore;

        const row = document.createElement('div');
        row.className = 'tf-option' + (isActive ? ' active' : '') + (locked ? ' locked' : '');
        row.innerHTML = `
            <span>${opt.label}</span>
            <span class="tf-opt-right">
                <span class="tf-opt-check">${isActive ? '✓' : ''}</span>
                <span>${locked ? '🔒' : ''}</span>
            </span>
        `;

        row.addEventListener('click', () => {
            if (isActive) {
                if (activeTimeframes.length <= 1) return;
                activeTimeframes = activeTimeframes.filter(x => x !== opt.value);
                if (activeScannerTimeframe === opt.value) {
                    activeScannerTimeframe = activeTimeframes[0];
                    syncActiveTimeframeToSelect();
                    lsSave();
                    refresh();
                }
                saveScannerTimeframes();
                renderTfPills();
                renderTfDropdown();
                return;
            }

            if (!scannerIsPremium && activeTimeframes.length >= FREE_TIMEFRAME_LIMIT) {
                showTfLimitTooltip();
                return;
            }

            activeTimeframes.push(opt.value);
            saveScannerTimeframes();
            renderTfPills();
            renderTfDropdown();
        });

        dd.appendChild(row);
    });
}

function initTimeframePicker() {
    const tfSel = el('timeframe');
    if (!tfSel) return;

    activeTimeframes = loadScannerTimeframesFromStorage();
    activeScannerTimeframe = (saved.timeframe && activeTimeframes.includes(saved.timeframe))
        ? saved.timeframe
        : activeTimeframes[0];

    syncActiveTimeframeToSelect();
    saveScannerTimeframes();

    renderTfPills();
    renderTfDropdown();

    const plusBtn = el('tfPlusBtn');
    const dd = el('tfDropdown');
    if (plusBtn && dd) {
        plusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dd.classList.contains('open');
            hideTfDropdownAndTooltip();
            if (!isOpen) dd.classList.add('open');
        });
    }

    document.addEventListener('click', (e) => {
        const picker = el('tfPicker');
        if (!picker) return;
        if (!picker.contains(e.target)) hideTfDropdownAndTooltip();
    });
}

function applyColorsToInputs() {
    if (!el('sRsiColor')) return;
    el('sRsiColor').value    = colors.rsi;
    el('sRsiOBColor').value  = colors.rsiOB;
    el('sRsiOSColor').value  = colors.rsiOS;
    el('sMacdColor').value   = colors.macd;
    el('sSignalColor').value = colors.signal;
    el('sBullColor').value   = colors.bull;
    el('sBearColor').value   = colors.bear;
    el('sLineWidth').value   = colors.lw;
    el('sLWVal').textContent = colors.lw;
    el('sPriceColor').value  = colors.price;
    el('sShowPrice').checked = visibility.price;
    el('sShowRSI').checked   = visibility.rsi;
    el('sShowMACD').checked  = visibility.macd;
    el('sPriceType').value   = priceType;
    const _ac = window._accentColor || '#00e5a0';
    const _acp = el('sAccentColor');    if (_acp) _acp.value = _ac;
    const _ach = el('sAccentColorHex'); if (_ach) _ach.value = _ac;
}

function onColorChange() {
    colors.rsi    = el('sRsiColor').value;
    colors.rsiOB  = el('sRsiOBColor').value;
    colors.rsiOS  = el('sRsiOSColor').value;
    colors.macd   = el('sMacdColor').value;
    colors.signal = el('sSignalColor').value;
    colors.bull   = el('sBullColor').value;
    colors.bear   = el('sBearColor').value;
    colors.lw     = +el('sLineWidth').value;
    colors.price  = el('sPriceColor').value;
    visibility.price = el('sShowPrice').checked;
    visibility.rsi   = el('sShowRSI').checked;
    visibility.macd  = el('sShowMACD').checked;
    priceType        = el('sPriceType').value;
    lsSave(); redrawAll();
    if (el('modal')?.classList.contains('open')) { drawModalPrice(); drawModalRSI(); drawModalMACD(); }
}

// ═══════════════════════════════════════
//  SEARCH / ADD / REMOVE
// ═══════════════════════════════════════
function initSearch() {
    const inp = el('searchInput');
    inp.addEventListener('input',  () => renderDropdown(inp.value.trim()));
    inp.addEventListener('focus',  () => renderDropdown(inp.value.trim()));
    inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeDropdown(); inp.blur(); return; }
        if (e.key === 'Enter') {
            let q = inp.value.trim().toUpperCase();
            if (!q) return;
            if (!q.endsWith('USDT')) q += 'USDT';
            toggleSymbol(q);
            inp.value = ''; closeDropdown();
        }
    });
}

function renderDropdown(raw) {
    const drop = el('searchDropdown');
    const q = raw.toUpperCase().replace('USDT','').trim();
    if (!q) { closeDropdown(); return; }
    let list = UNIVERSE.filter(s => s.replace('USDT','').startsWith(q))
        .concat(UNIVERSE.filter(s => !s.replace('USDT','').startsWith(q) && s.replace('USDT','').includes(q)));
    list = list.slice(0, 40);
    if (!list.length) {
        drop.innerHTML = `<div class="sd-empty">No results for "${raw}"</div>`;
    } else {
        drop.innerHTML = list.map(sym => {
            const base = sym.replace('USDT','');
            return `<div class="sd-item" data-sym="${sym}">
                <span class="sd-sym">${base}</span><span class="sd-sub">/USDT</span>
            </div>`;
        }).join('');
        drop.querySelectorAll('.sd-item').forEach(item =>
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                el('searchInput').value = ''; closeDropdown();
                openModal(item.dataset.sym);
            }));
    }
    drop.classList.add('open');
}

function closeDropdown() { const d = el('searchDropdown'); if (d) d.classList.remove('open'); }

function toggleSymbol(sym) {
    if (symbols.includes(sym)) {
        symbols = symbols.filter(s => s !== sym);
        delete indicatorData[sym];
        const cell = document.querySelector(`.cell[data-symbol="${sym}"]`);
        if (cell) cell.remove();
        updateGrid();
    } else {
        symbols.unshift(sym);
        indicatorData[sym] = null;
        const grid = document.getElementById('gridContainer');
        const cell = makeCell(sym);
        grid.prepend(cell);
        requestAnimationFrame(() => drawPlaceholder(cell.querySelector('canvas'), sym));
        updateGrid();
        fetchAndDraw(sym);
    }
    lsSave();
}

// ═══════════════════════════════════════
//  LAYOUT TOGGLE
// ═══════════════════════════════════════
function toggleLayout() { setLayout(layout === 'grid' ? 'list' : 'grid'); }

function setLayout(mode) {
    layout = mode;
    localStorage.setItem('SCANR_layout', mode);
    const lbl = el('layoutBtnLabel');
    if (lbl) lbl.textContent = mode === 'list' ? '☰ List' : '⊞ Grid';
    buildGrid();
    if (mode === 'grid') {
        updateGrid();
        symbols.forEach(sym => {
            const c = document.querySelector(`canvas[data-symbol="${sym}"]`);
            if (c && indicatorData[sym]) drawCell(c, indicatorData[sym], sym);
        });
    }
}

function makeRow(sym) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.dataset.symbol = sym;
    row.innerHTML = buildRowHtml(sym, indicatorData[sym]);
    row.addEventListener('click', () => openModal(sym));
    const star = row.querySelector('.wl-star');
    if (star) star.addEventListener('click', e => { e.stopPropagation(); toggleWatchlist(sym, star, row); });
    return row;
}

function buildRowHtml(sym, data) {
    const ohlc = data?.ohlc || [], closes = ohlc.map(c => c[3]);
    const price = closes.length ? closes[closes.length - 1] : 0;
    const prev  = closes.length > 1 ? closes[closes.length - 2] : price;
    const pct   = prev ? (price - prev) / prev * 100 : 0;
    const rsi   = data?.rsi?.length ? data.rsi[data.rsi.length - 1] : null;
    const macd  = data?.macd?.length ? data.macd[data.macd.length - 1] : null;
    const sig   = data?.signal?.length ? data.signal[data.signal.length - 1] : null;
    const macdDir = (macd != null && sig != null) ? (macd > sig ? '▲' : '▼') : '—';
    const macdCol = macdDir === '▲' ? '#22c55e' : '#ef4444';
    const pctCol  = pct >= 0 ? '#22c55e' : '#ef4444';
    const priceStr = price >= 1000 ? price.toFixed(1) : price >= 1 ? price.toFixed(3) : price.toFixed(5);
    const f = data?.flags || {};
    let tags = '';
    if (f.ob)        tags += `<span class="lr-tag" style="background:#f56565">OB</span>`;
    if (f.os)        tags += `<span class="lr-tag" style="background:#48bb78;color:#000">OS</span>`;
    if (f.mxBull)    tags += `<span class="lr-tag" style="background:#29ffb8;color:#000">MX↑</span>`;
    if (f.mxBear)    tags += `<span class="lr-tag" style="background:#fc8181">MX↓</span>`;
    if (f.rdivBull)  tags += `<span class="lr-tag" style="background:#f6ad55;color:#000">R↑</span>`;
    if (f.rdivBear)  tags += `<span class="lr-tag" style="background:#e05c00">R↓</span>`;
    if (f.mdivBull)  tags += `<span class="lr-tag" style="background:#63b3ed;color:#000">M↑</span>`;
    if (f.mdivBear)  tags += `<span class="lr-tag" style="background:#3a7bd5">M↓</span>`;
    if (f.rsiGolden) tags += `<span class="lr-tag" style="background:#ffd700;color:#000">G✦</span>`;
    if (f.rsiDeath)  tags += `<span class="lr-tag" style="background:#c0392b">D✦</span>`;
    const starred = watchlist.includes(sym);
    return `<div class="lr-sym">${sym.replace('USDT', '')}</div>
            <div class="lr-price">${price ? priceStr : '—'}</div>
            <div class="lr-pct" style="color:${pctCol}">${price ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—'}</div>
            <div class="lr-stat"><span class="lr-label">RSI</span><span class="lr-rsi">${rsi != null ? rsi.toFixed(1) : '—'}</span></div>
            <div class="lr-stat"><span class="lr-label">MACD</span><span class="lr-macd" style="color:${macdCol}">${macdDir}</span></div>
            <div class="lr-tags">${tags}</div>
            <button class="wl-star${starred ? ' starred' : ''}" title="Watchlist">★</button>`;
}

function updateRowData(sym, data) {
    const row = document.querySelector(`.list-row[data-symbol="${sym}"]`);
    if (!row) return;
    row.innerHTML = buildRowHtml(sym, data);
    const star = row.querySelector('.wl-star');
    if (star) star.addEventListener('click', e => { e.stopPropagation(); toggleWatchlist(sym, star, row); });
}

// ═══════════════════════════════════════
//  GRID BUILD & LAYOUT
// ═══════════════════════════════════════
function buildGrid() {
    const grid = document.getElementById('gridContainer');
    grid.innerHTML = '';
    if (layout === 'list') {
        grid.classList.add('list-mode');
        symbols.forEach(sym => grid.appendChild(makeRow(sym)));
    } else {
        grid.classList.remove('list-mode');
        symbols.forEach(sym => {
            const cell = makeCell(sym);
            grid.appendChild(cell);
            requestAnimationFrame(() => drawPlaceholder(cell.querySelector('canvas'), sym));
        });
        updateGrid();
    }
}

function makeCell(sym) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.symbol = sym;
    cell.draggable = true;

    // drag handle
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
        <circle cx="3.5" cy="2" r="1.1"/><circle cx="8.5" cy="2" r="1.1"/>
        <circle cx="3.5" cy="6" r="1.1"/><circle cx="8.5" cy="6" r="1.1"/>
        <circle cx="3.5" cy="10" r="1.1"/><circle cx="8.5" cy="10" r="1.1"/>
    </svg>`;
    cell.appendChild(handle);

    const canvas = document.createElement('canvas');
    canvas.dataset.symbol = sym;
    cell.appendChild(canvas);

    // Watchlist star
    const star = document.createElement('button');
    star.className = 'wl-star' + (watchlist.includes(sym) ? ' starred' : '');
    star.title = 'Add to Watchlist';
    star.textContent = '★';
    star.addEventListener('click', e => { e.stopPropagation(); toggleWatchlist(sym, star, cell); });
    cell.appendChild(star);
    if (watchlist.includes(sym)) cell.classList.add('in-watchlist');

    cell.addEventListener('mouseover', onHover);
    cell.addEventListener('mouseout',  onHoverOut);
    cell.addEventListener('click',     e => { if (!e.target.closest('.drag-handle') && !e.target.closest('.wl-star')) openModal(sym); });

    // drag
    cell.addEventListener('dragstart', dragStart);
    cell.addEventListener('dragover',  dragOver);
    cell.addEventListener('dragleave', dragLeave);
    cell.addEventListener('drop',      dragDrop);
    cell.addEventListener('dragend',   dragEnd);

    return cell;
}

function updateGrid() {
    const cells = document.querySelectorAll('.cell');
    const h = cellSize, w = Math.round(cellSize * 1.6), gap = 8;
    let cols = Math.floor((document.getElementById('gridContainer').clientWidth + gap) / (w + gap));
    if (cols < 2) cols = 2;
    document.getElementById('gridContainer').style.gridTemplateColumns = `repeat(${cols},${w}px)`;
    cells.forEach(c => { c.style.width = w+'px'; c.style.height = h+'px'; });
}

function drawPlaceholder(canvas, sym) {
    if (!canvas) return;
    const pr = window.devicePixelRatio||1;
    const W = canvas.offsetWidth||Math.round(cellSize*1.6), H = canvas.offsetHeight||cellSize;
    if (!W||!H) return;
    canvas.width=W*pr; canvas.height=H*pr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0); ctx.scale(pr,pr);
    ctx.fillStyle='#13171f'; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='#1e2535'; ctx.lineWidth=0.5;
    ctx.beginPath(); ctx.moveTo(0,H*.52); ctx.lineTo(W,H*.52); ctx.stroke();
    ctx.font=`bold ${Math.max(8,W*.065)}px Inter,sans-serif`;
    ctx.fillStyle='#252d3d'; ctx.textAlign='right';
    ctx.fillText(sym.replace('USDT',''),W-3,11);
}

// ═══════════════════════════════════════
//  DRAG & DROP
// ═══════════════════════════════════════
function dragStart(e) {
    dragSrc = this;
    this.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.symbol);
}
function dragOver(e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (this !== dragSrc) this.classList.add('drag-over');
}
function dragLeave()  { this.classList.remove('drag-over'); }
function dragEnd()    { this.classList.remove('is-dragging'); document.querySelectorAll('.cell').forEach(c=>c.classList.remove('drag-over')); dragSrc=null; }

function dragDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    if (!dragSrc || this === dragSrc) return;

    const srcSym = dragSrc.dataset.symbol;
    const dstSym = this.dataset.symbol;
    const si = symbols.indexOf(srcSym), di = symbols.indexOf(dstSym);
    if (si<0||di<0) return;

    // reorder array
    symbols.splice(si,1); symbols.splice(di,0,srcSym);

    // reorder DOM
    const grid = document.getElementById('gridContainer');
    if (si < di) grid.insertBefore(dragSrc, this.nextSibling);
    else         grid.insertBefore(dragSrc, this);

    lsSave();
}

// ═══════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════
function refresh() {
    const tf  = el('timeframe').value;
    const rl  = +el('rsiLen').value||14;
    const fa  = +el('fastLen').value||12;
    const sl  = +el('slowLen').value||26;
    const sig = +el('signalLen').value||9; 
    // Show scan progress bar
    const wrap = el('scanProgressWrap'), fill = el('scanProgressFill');
    if (wrap && fill) { wrap.style.display='block'; fill.style.width='0%'; }
    let done = 0; const total = symbols.length;
    symbols.forEach(sym => fetchAndDraw(sym, tf, rl, fa, sl, sig).then(() => {
        done++;
        if (fill) fill.style.width = Math.round(done / total * 100) + '%';
        if (done >= total) {
            setTimeout(() => { if (wrap) wrap.style.display='none'; if (fill) fill.style.width='0%'; }, 600);
            saveLastScan();
        }
    }));
}

async function fetchAndDraw(sym, tf, rl, fa, sl, sig) {
    tf  = tf  || el('timeframe').value;
    rl  = rl  || +el('rsiLen').value||14;
    fa  = fa  || +el('fastLen').value||12;
    sl  = sl  || +el('slowLen').value||26;
    sig = sig || +el('signalLen').value||9;
    try {
        const limit = Math.max(sl+sig+rl+150, 200);  // extra bars for pivot divergence
        const res = await fetch(`/api/proxy/binance?path=/fapi/v1/klines&symbol=${sym}&interval=${tf}&limit=${limit}`);
        const raw = await res.json();
        const klines = Array.isArray(raw) ? raw : [];
        if (!Array.isArray(klines)||klines.length<10) return;
        const highs   = klines.map(k=>parseFloat(k[2]));
        const lows    = klines.map(k=>parseFloat(k[3]));
        const closes  = klines.map(k=>parseFloat(k[4]));
        const price   = closes[closes.length-1];
        const rsiArr  = calcRSI(closes,rl);
        const {ml,sl2,hl} = calcMACD(closes,fa,sl,sig);
        const N=50;
        const ohlcFull = klines.map(k=>[parseFloat(k[1]),parseFloat(k[2]),parseFloat(k[3]),parseFloat(k[4])]);
        const ohlcSlice = ohlcFull.slice(-N);
        const rsiSlice = rsiArr.slice(-N);
        const macdSlice = ml.slice(-N), sigSlice = sl2.slice(-N), histSlice = hl.slice(-N);
        // detect signals using FULL arrays — pivot algo needs all bars
        const flags = detectSignals(highs, lows, closes, rsiArr, ml, sl2, hl);
        indicatorData[sym] = {
            price, ohlc: ohlcSlice,
            rsi: rsiSlice, macd: macdSlice, signal: sigSlice, hist: histSlice,
            rsiFullLen: rsiArr.length,    // for pivot idx mapping
            macdFullLen: ml.length,
            flags,
            // Full arrays for AI analysis (all fetched candles)
            ohlcFull, rsiArr, macdArr: ml, signalArr: sl2, histArr: hl,
            timestamps: klines.map(k => k[0])
        };
        const canvas = document.querySelector(`canvas[data-symbol="${sym}"]`);
        if (canvas) drawCell(canvas, indicatorData[sym], sym);
        if (layout === 'list') updateRowData(sym, indicatorData[sym]);
        applyFilter();
    } catch(_){}
}

// ── Last Scanned Coins ────────────────────────────────────────
const LAST_SCAN_KEY = 'SCANR-last-scan';

function saveLastScan() {
    const bar = el('lastScanBar');
    if (!bar) return;
    const timeEl = el('lastScanTime');
    const coinsEl = el('lastScanCoins');
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });
    // Collect coins with any signal flags
    const matched = symbols
        .filter(sym => {
            const f = indicatorData[sym]?.flags || {};
            return Object.values(f).some(v => v);
        })
        .map(sym => ({ sym, price: indicatorData[sym]?.price || 0 }));
    try { localStorage.setItem(LAST_SCAN_KEY, JSON.stringify({ time: now.toISOString(), coins: matched })); } catch(_) {}
    timeEl.textContent = timeStr;
    coinsEl.textContent = matched.length > 0 ? matched.map(c => c.sym.replace('USDT','')).join(', ') : 'No signals found';
    bar.style.display = 'flex';
}

function loadLastScan() {
    try {
        const raw = localStorage.getItem(LAST_SCAN_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!data?.time) return;
        const bar = el('lastScanBar'), timeEl = el('lastScanTime'), coinsEl = el('lastScanCoins');
        if (!bar || !timeEl || !coinsEl) return;
        const t = new Date(data.time);
        timeEl.textContent = t.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });
        coinsEl.textContent = (data.coins||[]).length > 0 ? (data.coins).map(c => c.sym.replace('USDT','')).join(', ') : 'No matching coins';
        bar.style.display = 'flex';
    } catch(_) {}
}


// ═══════════════════════════════════════
function calcRSI(closes,len) {
    if (closes.length<len+1) return [];
    let gS=0,lS=0;
    for(let i=1;i<=len;i++){const d=closes[i]-closes[i-1];d>=0?gS+=d:lS-=d;}
    let aG=gS/len,aL=lS/len;
    const out=[];
    for(let i=len;i<closes.length-1;i++){
        const d=closes[i+1]-closes[i];
        aG=(aG*(len-1)+Math.max(0,d))/len;
        aL=(aL*(len-1)+Math.max(0,-d))/len;
        out.push(aL===0?100:100-(100/(1+aG/aL)));
    }
    return out;
}

function ema(data,p) {
    if(data.length<p) return [];
    const k=2/(p+1); let e=data.slice(0,p).reduce((a,b)=>a+b,0)/p;
    const out=[e];
    for(let i=p;i<data.length;i++){e=data[i]*k+e*(1-k);out.push(e);}
    return out;
}

function calcMACD(closes,fast,slow,sig) {
    const ef=ema(closes,fast),es=ema(closes,slow);
    const off=slow-fast;
    const ml=es.map((s,i)=>ef[i+off]-s);
    const sl2=ema(ml,sig);
    const mla=ml.slice(sig-1);
    const hl=mla.map((m,i)=>m-sl2[i]);
    const N=Math.min(mla.length,sl2.length,hl.length);
    return {ml:mla.slice(-N),sl2:sl2.slice(-N),hl:hl.slice(-N)};
}

// ═══════════════════════════════════════
//  DRAW CELL
// ═══════════════════════════════════════
function redrawAll() {
    if (layout === 'list') {
        symbols.forEach(sym => { if (indicatorData[sym]) updateRowData(sym, indicatorData[sym]); });
        return;
    }
    symbols.forEach(sym=>{
        const c=document.querySelector(`canvas[data-symbol="${sym}"]`);
        if(c&&indicatorData[sym]) drawCell(c,indicatorData[sym],sym);
    });
}

function drawCell(canvas,data,sym) {
    const pr=window.devicePixelRatio||1;
    const W=canvas.offsetWidth||Math.round(cellSize*1.6),H=canvas.offsetHeight||cellSize;
    if(!W||!H) return;
    canvas.width=W*pr; canvas.height=H*pr;
    const ctx=canvas.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0); ctx.scale(pr,pr);
    ctx.fillStyle='#13171f'; ctx.fillRect(0,0,W,H);

    // Calculate which charts are visible
    const showPrice = visibility.price;
    const showRSI = visibility.rsi;
    const showMACD = visibility.macd;

    // Count visible charts
    const visibleCount = (showPrice?1:0) + (showRSI?1:0) + (showMACD?1:0);
    if(visibleCount === 0) return;

    // Calculate heights based on visibility
    const gap=2;
    let yPos = 0;

    if(visibleCount === 1) {
        const chartH = H - gap*2;
        if(showPrice) { miniPrice(ctx,data,0,yPos,W,chartH,sym); }
        else if(showRSI) { miniRSI(ctx,data,0,yPos,W,chartH,sym); }
        else if(showMACD) { miniMACD(ctx,data,0,yPos,W,chartH); }
    } else if(visibleCount === 2) {
        const chartH = Math.floor(H/2) - gap;
        if(showPrice) {
            miniPrice(ctx,data,0,yPos,W,chartH,sym);
            yPos += chartH + gap;
        }
        if(showRSI) {
            miniRSI(ctx,data,0,yPos,W,chartH,sym);
            yPos += chartH + gap;
        }
        if(showMACD) {
            miniMACD(ctx,data,0,yPos,W,H-yPos);
        }
    } else {
        const pH=Math.floor(H*.40)-gap;
        const rH=Math.floor(H*.30)-gap;
        const mH=H-pH-rH-gap*4;

        miniPrice(ctx,data,0,0,W,pH,sym);
        miniRSI(ctx,data,0,pH+gap,W,rH,sym);
        miniMACD(ctx,data,0,pH+rH+gap*2,W,mH);
    }

    if (data.flags) drawSignalTags(ctx, data.flags, W, H);

    if (_PAGE === 'scanner') {
        const tfLabel = getTimeframeLabel(el('timeframe') ? el('timeframe').value : activeScannerTimeframe);
        ctx.font = `bold ${Math.max(7, W * 0.055)}px Inter,sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#f0b90b';
        ctx.fillText(tfLabel, 4, H - 6);
    }
}

function drawSignalTags(ctx, f, W, H) {
    const tags = [];
    if (f.ob)              tags.push({c:'#f56565', label:'OB'});
    if (f.os)              tags.push({c:'#48bb78', label:'OS'});
    if (f.mxBull)          tags.push({c:'#29ffb8', label:'MX↑'});
    if (f.mxBear)          tags.push({c:'#fc8181', label:'MX↓'});
    if (f.rdivBull)        tags.push({c:'#f6ad55', label:'R↑'});
    if (f.rdivBear)        tags.push({c:'#e05c00', label:'R↓'});
    if (f.mdivBull)        tags.push({c:'#63b3ed', label:'M↑'});
    if (f.mdivBear)        tags.push({c:'#3a7bd5', label:'M↓'});
    if (f.rsiGolden)       tags.push({c:'#ffd700', label:'G✦'});
    if (f.rsiDeath)        tags.push({c:'#c0392b', label:'D✦'});
    const dotR = 3.5, spacing = 10;
    let xOff = W - 6;
    tags.forEach(({c}) => {
        ctx.beginPath(); ctx.arc(xOff, H - 6, dotR, 0, Math.PI*2);
        ctx.fillStyle = c; ctx.globalAlpha = 0.92; ctx.fill();
        xOff -= spacing;
    });
    ctx.globalAlpha = 1;
}

function miniPrice(ctx,data,x,y,W,H,sym) {
    const ohlc = data.ohlc;
    if(!ohlc||ohlc.length<2) return;
    const n=ohlc.length;
    const rW=W*.95,sX=rW/(n-1);
    const isCandle = priceType === 'candle';

    const highs=ohlc.map(c=>c[1]),lows=ohlc.map(c=>c[2]),closes=ohlc.map(c=>c[3]);
    const pMin=Math.min(...lows),pMax=Math.max(...highs);
    const pRng=pMax-pMin||pMin*.001;
    const pad=pRng*.05;
    const lo=pMin-pad,hi=pMax+pad,rng=hi-lo;
    const toY=v=>y+H-(v-lo)/rng*H;

    const midY=toY((hi+lo)/2);
    ctx.strokeStyle='#1e2535'; ctx.lineWidth=.5; ctx.setLineDash([2,3]);
    ctx.beginPath();ctx.moveTo(x,midY);ctx.lineTo(x+W,midY);ctx.stroke();ctx.setLineDash([]);

    if(isCandle) {
        const candleW=Math.max(1.5,sX*.7);
        for(let i=0;i<n;i++){
            const [o,h,l,c]=ohlc[i];
            const bull=c>=o;
            const px=x+i*sX;
            const cy1=toY(Math.max(o,c)),cy2=toY(Math.min(o,c));
            const bodyH=Math.max(1,cy2-cy1);

            ctx.strokeStyle=bull?colors.bull:colors.bear;
            ctx.lineWidth=Math.max(.8,candleW*.12);
            ctx.globalAlpha=.6;
            ctx.beginPath();ctx.moveTo(px,toY(h));ctx.lineTo(px,toY(l));ctx.stroke();

            ctx.fillStyle=bull?colors.bull:colors.bear;
            ctx.globalAlpha=bull?.85:.7;
            ctx.fillRect(px-candleW/2,cy1,candleW,bodyH);
        }
        ctx.globalAlpha=1;
    } else {
        ctx.beginPath(); ctx.strokeStyle=colors.price;
        ctx.lineWidth=Math.max(1,colors.lw*.7); ctx.lineJoin='round';
        for(let i=0;i<n;i++){const px=x+i*sX,py=toY(closes[i]);i?ctx.lineTo(px,py):ctx.moveTo(px,py);}
        ctx.stroke();
    }

    ctx.font=`bold ${Math.max(8,W*.07)}px Inter,sans-serif`;
    ctx.textAlign='left'; ctx.fillStyle='#6b7897';
    ctx.fillText(sym.replace('USDT',''),x+2,y+11);

    const lastClose=closes[closes.length-1];
    const priceStr=lastClose>=1000?lastClose.toFixed(1):lastClose>=1?lastClose.toFixed(2):lastClose.toFixed(4);
    ctx.textAlign='right'; ctx.fillStyle='#29ffb8';
    ctx.fillText(priceStr,x+W-2,y+11);

    const lastPx=x+(n-1)*sX,lastPy=toY(lastClose);
    ctx.beginPath();ctx.arc(lastPx,lastPy,2.5,0,Math.PI*2);ctx.fillStyle='#29ffb8';ctx.fill();
}

function miniRSI(ctx,data,x,y,W,H,sym) {
    const rsi = data.rsi;
    if(!rsi||rsi.length<2) return;
    const n=rsi.length,rW=W*.9,sX=rW/(n-1);
    const mn=Math.max(0,Math.min(...rsi)-5),mx=Math.min(100,Math.max(...rsi)+5);
    const rng=mx-mn||20,sY=H/rng;
    const toY=v=>y+H-(v-mn)*sY;
    const y70=toY(70),y30=toY(30);
    if(y70>y&&y70<y+H){ctx.fillStyle='rgba(245,101,101,0.05)';ctx.fillRect(x,y,W,y70-y);}
    if(y30<y+H&&y30>y){ctx.fillStyle='rgba(72,187,120,0.05)';ctx.fillRect(x,y30,W,y+H-y30);}
    ctx.setLineDash([2,3]); ctx.lineWidth=.6;
    [[70,colors.rsiOB],[30,colors.rsiOS]].forEach(([v,c])=>{
        const gy=toY(v); if(gy<y||gy>y+H) return;
        ctx.strokeStyle=c; ctx.globalAlpha=.35;
        ctx.beginPath();ctx.moveTo(x,gy);ctx.lineTo(x+W,gy);ctx.stroke();
    });
    ctx.setLineDash([]); ctx.globalAlpha=1;
    ctx.beginPath(); ctx.strokeStyle=colors.rsi;
    ctx.lineWidth=Math.max(1.1,colors.lw*.6); ctx.lineJoin='round';
    for(let i=0;i<n;i++){const px=x+i*sX,py=toY(rsi[i]);i?ctx.lineTo(px,py):ctx.moveTo(px,py);}
    ctx.stroke();
    // RSI divergence line overlay
    if (data.flags && data.flags.rdivLine) {
        const dl = data.flags.rdivLine;
        // Map full-array pivot idx to display-slice idx
        const dispStart = (data.rsiFullLen || (n)) - n; // first display bar = this full idx
        const curDisp  = dl.oscCur.idx  - dispStart;
        const prevDisp = dl.oscPrev.idx - dispStart;
        if (curDisp >= 0 && prevDisp >= 0 && curDisp < n && prevDisp < n) {
            const px1 = x + prevDisp*sX, py1 = toY(dl.oscPrev.val);
            const px2 = x + curDisp*sX,  py2 = toY(dl.oscCur.val);
            const divCol = dl.type==='bull' ? '#48bb78' : '#f56565';
            ctx.save();
            ctx.strokeStyle = divCol; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(px1,py1); ctx.lineTo(px2,py2); ctx.stroke();
            [px1,px2].forEach((px,i)=>{
                ctx.beginPath(); ctx.arc(px, i===0?py1:py2, 2.5, 0, Math.PI*2);
                ctx.fillStyle=divCol; ctx.fill();
            });
            ctx.restore();
        }
    }
    const lr=rsi[n-1],rc=lr>=70?colors.rsiOB:lr<=30?colors.rsiOS:colors.rsi;
    ctx.font=`bold ${Math.max(7,W*.062)}px Inter,sans-serif`;
    ctx.textAlign='right'; ctx.fillStyle=rc;
    ctx.fillText(sym.replace('USDT',''),W-2,y+10);
}

function miniMACD(ctx,data,x,y,W,H) {
    const {macd,signal,hist}=data;
    if(!hist||hist.length<2) return;
    const n=hist.length,rW=W*.9,sX=rW/(n-1);
    const all=[...macd,...signal,...hist];
    const aM=Math.max(...all.map(Math.abs))||.0001;
    const hH=H*.44,sY=(H*.9)/(aM*2),zY=y+H*.5;
    ctx.strokeStyle='#1e2535'; ctx.lineWidth=.5; ctx.setLineDash([2,3]);
    ctx.beginPath();ctx.moveTo(x,zY);ctx.lineTo(x+W,zY);ctx.stroke();
    ctx.setLineDash([]);
    for(let i=0;i<n;i++){
        const px=x+i*sX,bW=Math.max(1,sX*.65);
        const bH=Math.abs(hist[i])/aM*hH;
        const by=hist[i]>=0?zY-bH:zY;
        const grow=i>0?Math.abs(hist[i])>=Math.abs(hist[i-1]):true;
        ctx.fillStyle=hist[i]>=0?colors.bull:colors.bear;
        ctx.globalAlpha=grow?.85:.4;
        ctx.fillRect(px-bW/2,by,bW,Math.max(1,bH));
    }
    ctx.globalAlpha=1;
    ctx.beginPath();ctx.strokeStyle=colors.macd;
    ctx.lineWidth=Math.max(1,colors.lw*.65);ctx.lineJoin='round';
    for(let i=0;i<n;i++){const px=x+i*sX,py=zY-macd[i]*sY;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}
    ctx.stroke();
    ctx.beginPath();ctx.strokeStyle=colors.signal;
    ctx.lineWidth=Math.max(.8,colors.lw*.5);ctx.setLineDash([3,2]);
    for(let i=0;i<n;i++){const px=x+i*sX,py=zY-signal[i]*sY;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}
    ctx.stroke();ctx.setLineDash([]);
    // MACD divergence line overlay (on MACD line, not histogram)
    if (data.flags && data.flags.mdivLine) {
        const dl = data.flags.mdivLine;
        const dispStart = (data.macdFullLen || n) - n;
        const curDisp  = dl.oscCur.idx  - dispStart;
        const prevDisp = dl.oscPrev.idx - dispStart;
        if (curDisp >= 0 && prevDisp >= 0 && curDisp < n && prevDisp < n) {
            const px1 = x + prevDisp*sX, py1 = zY - dl.oscPrev.val*sY;
            const px2 = x + curDisp*sX,  py2 = zY - dl.oscCur.val*sY;
            const divCol = dl.type==='bull' ? '#48bb78' : '#f56565';
            ctx.save();
            ctx.strokeStyle = divCol; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(px1,py1); ctx.lineTo(px2,py2); ctx.stroke();
            [px1,px2].forEach((px,i)=>{
                ctx.beginPath(); ctx.arc(px, i===0?py1:py2, 2.5, 0, Math.PI*2);
                ctx.fillStyle=divCol; ctx.fill();
            });
            ctx.restore();
        }
    }
}

// ═══════════════════════════════════════
//  TOOLTIP
// ═══════════════════════════════════════
const tooltip = document.getElementById('tooltip');
function onHover(e){
    const sym=e.currentTarget.dataset.symbol,d=indicatorData[sym];if(!d)return;
    const rsi=d.rsi[d.rsi.length-1],h=d.hist[d.hist.length-1],m=d.macd[d.macd.length-1];
    const dp=Math.abs(m)>10?2:Math.abs(m)>1?4:6;
    const rc=rsi>=70?colors.rsiOB:rsi<=30?colors.rsiOS:colors.rsi;
    const hc=h>=0?colors.bull:colors.bear;
    tooltip.innerHTML=`<div class="t-sym">${sym}</div>
        <div class="t-row"><span class="t-label">Price</span><span>${d.price.toFixed(4)}</span></div>
        <div class="t-row"><span class="t-label">RSI</span><span style="color:${rc};font-weight:700">${rsi.toFixed(1)}</span></div>
        <div class="t-row"><span class="t-label">MACD</span><span style="color:${colors.macd}">${m.toFixed(dp)}</span></div>
        <div class="t-row"><span class="t-label">Signal</span><span style="color:${colors.signal}">${d.signal[d.signal.length-1].toFixed(dp)}</span></div>
        <div class="t-row"><span class="t-label">Hist</span><span style="color:${hc}">${h.toFixed(dp)}</span></div>`;
    tooltip.style.display='block';
    document.addEventListener('mousemove',moveTip);
}
function moveTip(e){tooltip.style.left=(e.clientX+14)+'px';tooltip.style.top=(e.clientY+14)+'px';}
function onHoverOut(){tooltip.style.display='none';document.removeEventListener('mousemove',moveTip);}

// ═══════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════
function updateModalInfobar(d,sym){
    const rsi=d.rsi[d.rsi.length-1],h=d.hist[d.hist.length-1];
    const m=d.macd[d.macd.length-1],s=d.signal[d.signal.length-1];
    const dp=Math.abs(m)>10?2:Math.abs(m)>1?4:6;
    const rc=rsi>=70?colors.rsiOB:rsi<=30?colors.rsiOS:colors.rsi;
    el('mPrice').textContent=d.price.toFixed(4);
    el('mRsi').textContent=rsi.toFixed(2); el('mRsi').style.color=rc;
    el('mMacd').textContent=m.toFixed(dp);
    el('mSignal').textContent=s.toFixed(dp);
    el('mHist').textContent=h.toFixed(dp);
    el('mHist').style.color=h>=0?colors.bull:colors.bear;

    // Position size — 1:1 RR, SL = 1× ATR(14) from entry
    const posS = posGetSettings();
    const capital = parseFloat(posS.capital) || 0;
    const wrap = el('mPosSizeWrap');
    if (capital > 0 && d.ohlcFull && d.ohlcFull.length >= 14) {
        const recent = d.ohlcFull.slice(-14);
        const atr = recent.reduce((acc, c) => acc + (c[1] - c[2]), 0) / 14; // c[1]=high, c[2]=low
        if (atr > 0) {
            const riskPct = parseFloat(posS.riskPerTrade ?? posS.risk) || 1;
            const riskAmt = capital * (riskPct / 100);
            const qty = riskAmt / atr;
            const posValue = qty * d.price; // $ entry size
            const posFmt = posValue >= 10000 ? '$' + (posValue/1000).toFixed(1) + 'K'
                         : '$' + posValue.toFixed(2);
            el('mPosSize').textContent = posFmt;
            wrap.style.display = '';
        } else { wrap.style.display = 'none'; }
    } else { wrap.style.display = 'none'; }
}

function openModal(sym) {
    currentSym=sym;
    // If data not loaded yet (e.g. from search), fetch it first
    if (!indicatorData[sym]) {
        indicatorData[sym] = null;
        fetchAndDraw(sym).then(() => {
            if (el('modal').classList.contains('open') && currentSym===sym) {
                const d2=indicatorData[sym];
                if(d2){ updateModalInfobar(d2,sym); setupModalCvs(); drawModalPrice(); drawModalRSI(); drawModalMACD(); }
            }
        });
    }
    const d=indicatorData[sym];
    el('modalTitle').textContent=sym;
    if(d) updateModalInfobar(d,sym);
    setupDrawTools();
    // Modal watchlist btn
    const mwb = el('modalWlBtn');
    if (mwb) {
        const inWl = watchlist.includes(sym);
        mwb.style.color = inWl ? '#ffd700' : '#3a4560';
        mwb.style.borderColor = inWl ? '#ffd700' : '#252d3d';
        mwb.onclick = () => {
            const starEl = document.querySelector(`.cell[data-symbol="${sym}"] .wl-star`);
            const cellEl = document.querySelector(`.cell[data-symbol="${sym}"]`);
            toggleWatchlist(sym, starEl, cellEl);
            const nowIn = watchlist.includes(sym);
            mwb.style.color = nowIn ? '#ffd700' : '#3a4560';
            mwb.style.borderColor = nowIn ? '#ffd700' : '#252d3d';
        };
    }
    el('modal').classList.add('open');
    requestAnimationFrame(()=>{ setupModalCvs(); if(d){drawModalPrice();drawModalRSI();drawModalMACD();} restoreAIPanel(); });
}
function closeModal(){
    el('modal').classList.remove('open');
    document.removeEventListener('keydown',onKey);
}

function openCoinDetail() {
    const sym = currentSym;
    if (!sym) return;
    closeModal();
    window.location.href = '/coin-detail?sym=' + encodeURIComponent(sym);
}

function setupModalCvs(){
    priceCvs=el('modalPriceChart'); rsiCvs=el('modalRsiChart'); macdCvs=el('modalMacdChart');
    priceCtx=priceCvs.getContext('2d'); rsiCtx=rsiCvs.getContext('2d'); macdCtx=macdCvs.getContext('2d');
    [priceCvs,rsiCvs,macdCvs].forEach(c=>{
        const pr=window.devicePixelRatio||1;
        const W=c.parentElement.clientWidth-2,H=c.parentElement.clientHeight-2;
        c.width=W*pr;c.height=H*pr;c.style.width=W+'px';c.style.height=H+'px';
        c.getContext('2d').setTransform(1,0,0,1,0,0);
        c.getContext('2d').scale(pr,pr);
    });
    [priceCvs,rsiCvs,macdCvs].forEach(c=>{
        c.onmousedown=e=>{activeCanvas=c;activeCtx=c.getContext('2d');startDraw(e);};
        c.onmousemove=onDraw;c.onmouseup=stopDraw;c.onmouseleave=stopDraw;
        // Touch events are set by setCanvasTouchMode() inside setupDrawTools()
        c.ontouchstart=null; c.ontouchmove=null; c.ontouchend=null;
    });
    drawObjs = drawingsLoad(currentSym, el('timeframe').value);
    curDraw=null;
    drawHistory=[JSON.stringify(drawObjs)];
    histIdx=0;
    updateUndoBtns();
}

function drawModalPrice(){
    const d=indicatorData[currentSym];if(!d||!priceCvs||!d.ohlc||d.ohlc.length<2)return;
    const ctx=priceCtx,pr=window.devicePixelRatio||1;
    const W=priceCvs.width/pr,H=priceCvs.height/pr;
    ctx.setTransform(1,0,0,1,0,0);ctx.scale(pr,pr);
    ctx.fillStyle='#0f1117';ctx.fillRect(0,0,W,H);

    const ohlc=d.ohlc;
    const n=ohlc.length;
    const mL=14,mR=54,mT=14,mB=22;
    const cW=W-mL-mR,cH=H-mT-mB;

    // price range with padding
    const allH=ohlc.map(c=>c[1]),allL=ohlc.map(c=>c[2]);
    const pMin=Math.min(...allL),pMax=Math.max(...allH);
    const pRng=pMax-pMin||pMin*.001;
    const pad=pRng*.06;
    const lo=pMin-pad,hi=pMax+pad,rng=hi-lo;
    const toY=v=>mT+cH-(v-lo)/rng*cH;

    const candleW=Math.max(1.5,cW/n*.7);
    const sX=cW/(n);  // slot width per candle

    // grid lines
    ctx.font='10px Inter,sans-serif';ctx.textAlign='left';ctx.fillStyle='#4a5568';
    const steps=5;
    for(let i=0;i<=steps;i++){
        const v=lo+rng/steps*i;
        const gy=toY(v);
        ctx.beginPath();ctx.strokeStyle='#1e2535';ctx.lineWidth=.5;
        ctx.moveTo(mL,gy);ctx.lineTo(mL+cW,gy);ctx.stroke();
        // price label - format nicely
        let label;
        if(v>=1000) label=v.toFixed(1);
        else if(v>=1) label=v.toFixed(3);
        else label=v.toFixed(6);
        ctx.fillText(label,mL+cW+4,gy+4);
    }

    // EMA 9 & 21 overlays
    const closes=ohlc.map(c=>c[3]);
    const ema9=ema(closes,9),ema21=ema(closes,21);
    const ema9off=n-ema9.length,ema21off=n-ema21.length;

    [[ema9,ema9off,'#f6ad55','EMA9'],[ema21,ema21off,'#a78bfa','EMA21']].forEach(([arr,off,col,lbl])=>{
        if(!arr.length) return;
        ctx.beginPath();ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.lineJoin='round';ctx.globalAlpha=.8;
        for(let i=0;i<arr.length;i++){
            const px=mL+(i+off)*sX+sX/2;
            const py=toY(arr[i]);
            i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
        }
        ctx.stroke();ctx.globalAlpha=1;
    });

    // Candlesticks
    for(let i=0;i<n;i++){
        const [o,h,l,c]=ohlc[i];
        const bull=c>=o;
        const px=mL+i*sX+sX/2;
        const cy1=toY(Math.max(o,c)),cy2=toY(Math.min(o,c));
        const bodyH=Math.max(1,cy2-cy1);

        // wick
        ctx.strokeStyle=bull?colors.bull:colors.bear;
        ctx.lineWidth=Math.max(.8,candleW*.12);
        ctx.globalAlpha=.7;
        ctx.beginPath();ctx.moveTo(px,toY(h));ctx.lineTo(px,toY(l));ctx.stroke();
        ctx.globalAlpha=1;

        // body
        ctx.fillStyle=bull?colors.bull:colors.bear;
        ctx.globalAlpha=bull?.85:.85;
        ctx.fillRect(px-candleW/2,cy1,candleW,bodyH);
        ctx.globalAlpha=1;
    }

    // Current price line
    const lastClose=closes[closes.length-1];
    const priceY=toY(lastClose);
    ctx.setLineDash([4,3]);ctx.strokeStyle='#e5e9f2';ctx.lineWidth=.7;ctx.globalAlpha=.35;
    ctx.beginPath();ctx.moveTo(mL,priceY);ctx.lineTo(mL+cW,priceY);ctx.stroke();
    ctx.setLineDash([]);ctx.globalAlpha=1;

    // Price label on right
    let prLabel;
    if(lastClose>=1000) prLabel=lastClose.toFixed(2);
    else if(lastClose>=1) prLabel=lastClose.toFixed(4);
    else prLabel=lastClose.toFixed(6);
    ctx.font='bold 11px Inter,monospace';ctx.textAlign='left';
    ctx.fillStyle='#e5e9f2';
    const lblW=ctx.measureText(prLabel).width+8;
    ctx.fillStyle='#29ffb8';ctx.fillRect(mL+cW+2,priceY-8,lblW,16);
    ctx.fillStyle='#0f1117';ctx.fillText(prLabel,mL+cW+6,priceY+4);

    // EMA legend bottom
    ctx.font='10px Inter,sans-serif';ctx.textAlign='left';
    [[ema9,'#f6ad55','EMA 9'],[ema21,'#a78bfa','EMA 21']].forEach(([arr,col,lbl],idx)=>{
        if(!arr.length) return;
        const lx=mL+4+idx*70,ly=mT+cH+mB-6;
        ctx.fillStyle=col;ctx.fillRect(lx,ly-5,14,2);
        ctx.fillStyle='#6b7897';ctx.fillText(lbl,lx+18,ly);
    });

    drawObjs.filter(o=>o.canvas==='price').forEach(o=>drawObj(priceCtx,o));
}

function drawModalRSI(){
    const d=indicatorData[currentSym];if(!d||!rsiCvs)return;
    const ctx=rsiCtx,pr=window.devicePixelRatio||1;
    const W=rsiCvs.width/pr,H=rsiCvs.height/pr;
    ctx.setTransform(1,0,0,1,0,0);ctx.scale(pr,pr);
    ctx.fillStyle='#0f1117';ctx.fillRect(0,0,W,H);
    const rsi=d.rsi;if(!rsi||rsi.length<2)return;
    const n=rsi.length,mL=14,mR=54,mT=12,mB=14;
    const cW=W-mL-mR,cH=H-mT-mB;
    const mn=Math.max(0,Math.min(...rsi)-8),mx=Math.min(100,Math.max(...rsi)+8);
    const rng=mx-mn||20,sY=cH/rng,sX=cW/(n-1);
    const toY=v=>mT+cH-(v-mn)*sY;
    ctx.font='10px Inter,sans-serif';
    for(let v=Math.ceil(mn/10)*10;v<=mx;v+=10){
        const gy=toY(v);
        ctx.beginPath();ctx.strokeStyle=v===50?'#2a3350':'#1e2535';ctx.lineWidth=v===50?1:.5;
        ctx.moveTo(mL,gy);ctx.lineTo(mL+cW,gy);ctx.stroke();
        ctx.fillStyle='#4a5568';ctx.textAlign='left';ctx.fillText(v,mL+cW+4,gy+4);
    }
    const y70=toY(70),y30=toY(30);
    if(y70>=mT){ctx.fillStyle='rgba(245,101,101,0.07)';ctx.fillRect(mL,mT,cW,y70-mT);}
    if(y30<=mT+cH){ctx.fillStyle='rgba(72,187,120,0.07)';ctx.fillRect(mL,y30,cW,mT+cH-y30);}
    ctx.setLineDash([4,4]);
    [[70,colors.rsiOB],[50,'#2a3350'],[30,colors.rsiOS]].forEach(([v,c])=>{
        const gy=toY(v);if(gy<mT||gy>mT+cH)return;
        ctx.strokeStyle=c;ctx.globalAlpha=v===50?.5:.6;ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(mL,gy);ctx.lineTo(mL+cW,gy);ctx.stroke();
    });
    ctx.setLineDash([]);ctx.globalAlpha=1;
    ctx.beginPath();ctx.strokeStyle=colors.rsi;ctx.lineWidth=colors.lw;ctx.lineJoin='round';
    for(let i=0;i<n;i++){const px=mL+i*sX,py=toY(rsi[i]);i?ctx.lineTo(px,py):ctx.moveTo(px,py);}
    ctx.stroke();
    const lr=rsi[n-1],dy=toY(lr);
    ctx.beginPath();ctx.arc(mL+(n-1)*sX,dy,3,0,Math.PI*2);ctx.fillStyle=colors.rsi;ctx.fill();
    ctx.font='bold 11px Inter,sans-serif';ctx.textAlign='right';ctx.fillStyle=colors.rsi;
    ctx.fillText(lr.toFixed(1),W-2,dy+4);
    // RSI divergence line in modal
    const rd = indicatorData[currentSym];
    if (rd && rd.flags && rd.flags.rdivLine) {
        const dl = rd.flags.rdivLine;
        const rdisp=(rd.rsiFullLen||n)-n; const curDisp=dl.oscCur.idx-rdisp, prevDisp=dl.oscPrev.idx-rdisp;
        if (curDisp>=0&&prevDisp>=0&&curDisp<n&&prevDisp<n) {
            const px1=mL+prevDisp*sX, py1=toY(dl.oscPrev.val);
            const px2=mL+curDisp*sX,  py2=toY(dl.oscCur.val);
            const divCol = dl.type==='bull' ? '#48bb78' : '#f56565';
            ctx.save();
            ctx.strokeStyle=divCol; ctx.lineWidth=2; ctx.globalAlpha=0.95; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(px1,py1); ctx.lineTo(px2,py2); ctx.stroke();
            [[px1,py1],[px2,py2]].forEach(([px,py])=>{
                ctx.beginPath(); ctx.arc(px,py,4,0,Math.PI*2);
                ctx.fillStyle=divCol; ctx.globalAlpha=0.95; ctx.fill();
            });
            // Label
            ctx.fillStyle=divCol; ctx.font='bold 10px Inter,sans-serif'; ctx.textAlign='center';
            ctx.fillText(dl.type==='bull'?'Bull Div':'Bear Div', (px1+px2)/2, Math.min(py1,py2)-6);
            ctx.restore();
        }
    }
    drawObjs.filter(o=>o.canvas==='rsi').forEach(o=>drawObj(rsiCtx,o));
}

function drawModalMACD(){
    const d=indicatorData[currentSym];if(!d||!macdCvs)return;
    const ctx=macdCtx,pr=window.devicePixelRatio||1;
    const W=macdCvs.width/pr,H=macdCvs.height/pr;
    ctx.setTransform(1,0,0,1,0,0);ctx.scale(pr,pr);
    ctx.fillStyle='#0f1117';ctx.fillRect(0,0,W,H);
    const {macd,signal,hist}=d;if(!hist||hist.length<2)return;
    const n=hist.length,mL=14,mR=54,mT=10,mB=10;
    const cW=W-mL-mR,cH=H-mT-mB,sX=cW/(n-1);
    const all=[...macd,...signal,...hist];
    const aM=Math.max(...all.map(Math.abs))||.0001;
    const dp=aM>10?2:aM>1?4:6;
    const sY=(cH*.45)/aM,zY=mT+cH/2;
    const toY=v=>zY-v*sY;
    ctx.font='10px Inter,sans-serif';ctx.fillStyle='#4a5568';ctx.textAlign='left';
    [-aM*.6,0,aM*.6].forEach(v=>{
        const gy=toY(v);if(gy<mT||gy>mT+cH)return;
        ctx.beginPath();ctx.strokeStyle=v===0?'#2a3350':'#1e2535';ctx.lineWidth=v===0?1:.5;
        ctx.moveTo(mL,gy);ctx.lineTo(mL+cW,gy);ctx.stroke();
        ctx.fillText(v.toFixed(dp),mL+cW+4,gy+4);
    });
    const hH=cH*.44;
    for(let i=0;i<n;i++){
        const px=mL+i*sX,bW=Math.max(1.5,sX*.65);
        const bH=Math.abs(hist[i])/aM*hH,by=hist[i]>=0?zY-bH:zY;
        const grow=i>0?Math.abs(hist[i])>=Math.abs(hist[i-1]):true;
        ctx.fillStyle=hist[i]>=0?colors.bull:colors.bear;ctx.globalAlpha=grow?.9:.45;
        ctx.fillRect(px-bW/2,by,bW,Math.max(1,bH));
    }
    ctx.globalAlpha=1;
    ctx.beginPath();ctx.strokeStyle=colors.macd;ctx.lineWidth=colors.lw;ctx.lineJoin='round';
    for(let i=0;i<n;i++){const px=mL+i*sX,py=toY(macd[i]);i?ctx.lineTo(px,py):ctx.moveTo(px,py);}
    ctx.stroke();
    ctx.beginPath();ctx.strokeStyle=colors.signal;ctx.lineWidth=Math.max(1,colors.lw*.75);ctx.setLineDash([5,3]);
    for(let i=0;i<n;i++){const px=mL+i*sX,py=toY(signal[i]);i?ctx.lineTo(px,py):ctx.moveTo(px,py);}
    ctx.stroke();ctx.setLineDash([]);
    const lM=macd[n-1],lS=signal[n-1],lH=hist[n-1];
    ctx.font='bold 10px Inter,monospace';ctx.textAlign='right';
    ctx.fillStyle=colors.macd;ctx.fillText(`M ${lM.toFixed(dp)}`,W-2,toY(lM)+4);
    ctx.fillStyle=colors.signal;ctx.fillText(`S ${lS.toFixed(dp)}`,W-2,toY(lS)-6);
    ctx.fillStyle=lH>=0?colors.bull:colors.bear;
    ctx.fillText(`H ${lH.toFixed(dp)}`,W-2,zY+(lH>=0?-cH*.15:cH*.15));
    // MACD divergence line in modal
    const md = indicatorData[currentSym];
    if (md && md.flags && md.flags.mdivLine) {
        const dl = md.flags.mdivLine;
        const mdisp=(md.macdFullLen||n)-n; const curDisp=dl.oscCur.idx-mdisp, prevDisp=dl.oscPrev.idx-mdisp;
        if (curDisp>=0&&prevDisp>=0&&curDisp<n&&prevDisp<n) {
            const px1=mL+prevDisp*sX, py1=toY(dl.oscPrev.val);
            const px2=mL+curDisp*sX,  py2=toY(dl.oscCur.val);
            const divCol = dl.type==='bull' ? '#48bb78' : '#f56565';
            ctx.save();
            ctx.strokeStyle=divCol; ctx.lineWidth=2; ctx.globalAlpha=0.95; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(px1,py1); ctx.lineTo(px2,py2); ctx.stroke();
            [[px1,py1],[px2,py2]].forEach(([px,py])=>{
                ctx.beginPath(); ctx.arc(px,py,4,0,Math.PI*2);
                ctx.fillStyle=divCol; ctx.globalAlpha=0.95; ctx.fill();
            });
            ctx.fillStyle=divCol; ctx.font='bold 10px Inter,sans-serif'; ctx.textAlign='center';
            ctx.fillText(dl.type==='bull'?'Bull Div':'Bear Div', (px1+px2)/2, Math.min(py1,py2)-6);
            ctx.restore();
        }
    }
    drawObjs.filter(o=>o.canvas==='macd').forEach(o=>drawObj(macdCtx,o));
}

// ═══════════════════════════════════════
//  DRAWING TOOLS
// ═══════════════════════════════════════
function setupDrawTools(){
    drawObjs=[];curDraw=null;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>{
        const c=b.cloneNode(true);b.parentNode.replaceChild(c,b);
    });

    const isMobile = window.matchMedia('(max-width:700px)').matches || ('ontouchstart' in window && window.innerWidth <= 900);

    // On mobile: drawing starts OFF. On desktop: brush always active on open.
    let drawModeActive = !isMobile;
    if (!isMobile) {
        document.querySelector('.tool-btn[data-tool="brush"]')?.classList.add('active');
        currentTool = 'brush';
    } else {
        // Remove active from all tool buttons, add a visual hint
        document.querySelectorAll('.tool-btn[data-tool]').forEach(x => x.classList.remove('active'));
        currentTool = 'brush'; // ready to use when activated
    }

    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
        b.addEventListener('click', () => {
            const wasThisTool = b.classList.contains('active');
            document.querySelectorAll('.tool-btn[data-tool]').forEach(x => x.classList.remove('active'));

            if (isMobile && wasThisTool) {
                // Tap active tool again → deactivate draw mode
                drawModeActive = false;
                setCanvasTouchMode(false);
            } else {
                // Activate this tool
                b.classList.add('active');
                currentTool = b.dataset.tool;
                drawModeActive = true;
                setCanvasTouchMode(true);
            }
        });
    });

    el('toolSize').oninput=e=>{toolSize=+e.target.value;el('toolSizeVal').textContent=toolSize;};
    el('drawColor').oninput=e=>{currentColor=e.target.value;};
    el('undoBtn').onclick=undo; el('redoBtn').onclick=redo;
    el('clearBtn').onclick=()=>{if(confirm('Clear drawings?'))clearDraws();};
    el('exportBtn').onclick=exportBoth;
    document.addEventListener('keydown',onKey);

    // Apply initial touch mode
    if (isMobile) setCanvasTouchMode(false);
}

function setCanvasTouchMode(drawOn) {
    [priceCvs, rsiCvs, macdCvs].forEach(c => {
        if (!c) return;
        if (drawOn) {
            c.ontouchstart = e => { activeCanvas=c; activeCtx=c.getContext('2d'); touchDraw(e); };
            c.ontouchmove  = touchDraw;
            c.ontouchend   = stopDraw;
            c.style.touchAction = 'none'; // block scroll while drawing
        } else {
            c.ontouchstart = null;
            c.ontouchmove  = null;
            c.ontouchend   = null;
            c.style.touchAction = 'auto'; // allow scroll
        }
    });
}

const cvId=c=>c===priceCvs?'price':c===rsiCvs?'rsi':'macd';

function startDraw(e){
    if(!activeCanvas)return;
    isDrawing=true;
    const r=activeCanvas.getBoundingClientRect();
    const x=e.clientX-r.left,y=e.clientY-r.top;
    lastX=x;lastY=y; // need lastX/Y defined
    const cid=cvId(activeCanvas);
    if(currentTool==='brush') curDraw={type:'brush',points:[[x,y]],color:currentColor,size:toolSize,canvas:cid};
    else if(currentTool==='trendline') curDraw={type:'trendline',points:[[x,y],[x,y]],color:currentColor,size:toolSize,canvas:cid};
    else if(currentTool==='eraser') eraseAt(x,y,cid);
}

function onDraw(e){
    if(!isDrawing||!activeCanvas||!curDraw)return;
    const r=activeCanvas.getBoundingClientRect();
    const x=e.clientX-r.left,y=e.clientY-r.top;
    if(currentTool==='brush'){curDraw.points.push([x,y]);redrawModal();drawObj(activeCtx,curDraw);}
    else if(currentTool==='trendline'){curDraw.points[1]=[x,y];redrawModal();drawObj(activeCtx,curDraw);}
    else if(currentTool==='eraser') eraseAt(x,y,cvId(activeCanvas));
}

function stopDraw(){
    if(isDrawing&&curDraw){drawObjs.push(curDraw);saveDState();curDraw=null;}
    isDrawing=false;
}

function touchDraw(e){
    e.preventDefault();const t=e.touches[0];
    if(e.type==='touchstart') startDraw({clientX:t.clientX,clientY:t.clientY});
    else if(e.type==='touchmove') onDraw({clientX:t.clientX,clientY:t.clientY});
}

function eraseAt(x,y,cid){
    for(let i=drawObjs.length-1;i>=0;i--){
        const o=drawObjs[i];if(o.canvas!==cid)continue;
        if(o.type==='brush'&&o.points.some(([px,py])=>Math.hypot(px-x,py-y)<o.size*4)){
            drawObjs.splice(i,1);redrawModal();saveDState();return;
        }
        if(o.type==='trendline'&&o.points.length===2){
            const[[x1,y1],[x2,y2]]=o.points;
            if(segDist(x,y,x1,y1,x2,y2)<o.size*4){drawObjs.splice(i,1);redrawModal();saveDState();return;}
        }
    }
}

function segDist(px,py,x1,y1,x2,y2){
    const dx=x2-x1,dy=y2-y1,t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy)||0));
    return Math.hypot(px-x1-t*dx,py-y1-t*dy);
}

function drawObj(ctx,obj){
    if(!ctx)return;ctx.save();
    if(obj.type==='brush'){
        ctx.beginPath();ctx.strokeStyle=obj.color;ctx.lineWidth=obj.size;ctx.lineCap='round';ctx.lineJoin='round';
        obj.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();
    }else if(obj.type==='trendline'&&obj.points.length===2){
        ctx.beginPath();ctx.strokeStyle=obj.color;ctx.lineWidth=obj.size;ctx.setLineDash([5,3]);
        ctx.moveTo(obj.points[0][0],obj.points[0][1]);ctx.lineTo(obj.points[1][0],obj.points[1][1]);
        ctx.stroke();ctx.setLineDash([]);
    }
    ctx.restore();
}

function redrawModal(){drawModalPrice();drawModalRSI();drawModalMACD();}

function saveDState(){
    drawHistory=drawHistory.slice(0,histIdx+1);
    drawHistory.push(JSON.stringify(drawObjs));histIdx++;updateUndoBtns();
    drawingsSave(currentSym, el('timeframe').value, drawObjs);
}
function undo(){
    if(histIdx>0){histIdx--;drawObjs=JSON.parse(drawHistory[histIdx]);}
    else{histIdx=0;drawObjs=JSON.parse(drawHistory[0]||'[]');}
    redrawModal();updateUndoBtns();
    drawingsSave(currentSym, el('timeframe').value, drawObjs);
}
function redo(){
    if(histIdx<drawHistory.length-1){histIdx++;drawObjs=JSON.parse(drawHistory[histIdx]);redrawModal();updateUndoBtns();
    drawingsSave(currentSym, el('timeframe').value, drawObjs);}
}
function clearDraws(){
    drawObjs=[];drawHistory=[JSON.stringify([])];histIdx=0;redrawModal();updateUndoBtns();
    drawingsSave(currentSym, el('timeframe').value, []);
}
function updateUndoBtns(){
    el('undoBtn').disabled = histIdx <= 0;
    el('redoBtn').disabled = histIdx >= drawHistory.length - 1;
}

function exportBoth(){
    const pr=window.devicePixelRatio||1;
    const W=priceCvs.width/pr,pH=priceCvs.height/pr,rH=rsiCvs.height/pr,mH=macdCvs.height/pr;
    const totalH=pH+rH+mH+16;
    const cv=document.createElement('canvas');cv.width=W*pr;cv.height=totalH*pr;
    const ctx=cv.getContext('2d');ctx.scale(pr,pr);
    ctx.fillStyle='#0f1117';ctx.fillRect(0,0,W,totalH);
    ctx.drawImage(priceCvs,0,0,W,pH,0,0,W,pH);
    ctx.drawImage(rsiCvs,0,0,W,rH,0,pH+8,W,rH);
    ctx.drawImage(macdCvs,0,0,W,mH,0,pH+rH+16,W,mH);
    const a=document.createElement('a');a.download=`${currentSym}_Price_RSI_MACD.png`;a.href=cv.toDataURL();a.click();
}

function onKey(e){
    if(!el('modal').classList.contains('open'))return;
    if(e.ctrlKey||e.metaKey){
        if(e.key==='z'){e.preventDefault();undo();}
        if(e.key==='y'){e.preventDefault();redo();}
    }else{
        const m={b:'brush',t:'trendline',e:'eraser'},tool=m[e.key.toLowerCase()];
        if(tool){currentTool=tool;document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));}
    }
}

// ═══════════════════════════════════════
//  PIVOT HELPERS — exact Pine pivotlow/pivothigh
//  A pivot low at index i requires: arr[i] < all bars within [i-lbL, i+lbR]
//  Confirmed when current bar reaches i+lbR (i.e. i <= len-lbR-1)
// ═══════════════════════════════════════
const DIV_LBL=5, DIV_LBR=5, DIV_RANGE_LO=5, DIV_RANGE_HI=60;

function pivotLows(arr, lbL, lbR) {
    // exact Pine: strict minimum — all surrounding bars must be strictly greater
    const pivots = [];
    for (let i = lbL; i <= arr.length - lbR - 1; i++) {
        const v = arr[i];
        let ok = true;
        for (let j = i - lbL; j <= i + lbR; j++) {
            if (j !== i && arr[j] <= v) { ok = false; break; }
        }
        if (ok) pivots.push({ idx: i, val: v });
    }
    return pivots;
}

function pivotHighs(arr, lbL, lbR) {
    const pivots = [];
    for (let i = lbL; i <= arr.length - lbR - 1; i++) {
        const v = arr[i];
        let ok = true;
        for (let j = i - lbL; j <= i + lbR; j++) {
            if (j !== i && arr[j] >= v) { ok = false; break; }
        }
        if (ok) pivots.push({ idx: i, val: v });
    }
    return pivots;
}

// ═══════════════════════════════════════
//  SIGNAL DETECTION — exact Pine indicator logic
//
//  RSI Divergence (Pine RSI div indicator):
//    Bull: price[lbR] < prev_price_pivot  AND  rsi[lbR] > prev_rsi_pivot
//          AND barsBetween in [rangeLo, rangeHi]
//    Bear: price[lbR] > prev_price_pivot  AND  rsi[lbR] < prev_rsi_pivot
//
//  MACD Divergence (Pine MACD div indicator):
//    Same structure but uses macd line as oscillator.
//    Extra: "don't touch zero" — highest(osc, lbL+lbR+5) < 0 for bull
//                               — lowest(osc, lbL+lbR+5)  > 0 for bear
//    This checks that within the window around the cur pivot, osc stayed same side.
//
//  We scan ALL consecutive pivot pairs (most recent first), no age cutoff.
//  divergenceAge = bars from last confirmed cur-pivot to end of array (for sorting).
//  Lower age = divergence line closer to right edge of chart = more visible.
// ═══════════════════════════════════════
function detectSignals(highs, lows, closes, rsiArr, macdLine, sigLine, histArr) {
    const flags = {
        ob:false, os:false,
        rdivBull:false, rdivBear:false,
        mdivBull:false, mdivBear:false,
        mxBull:false,   mxBear:false,
        rsiGolden:false, rsiDeath:false,
        rdivLine:null,  mdivLine:null,
        rdivAge: Infinity, mdivAge: Infinity
    };

    const rN = rsiArr.length;
    const mN = macdLine.length;
    if (rN < DIV_LBL + DIV_LBR + 5) return flags;

    // ── OB / OS ──
    flags.ob = rsiArr[rN-1] >= 70;
    flags.os = rsiArr[rN-1] <= 30;

    // ── MACD Histogram Cross (last bar sign flip) ──
    if (histArr.length >= 2) {
        const h1 = histArr[histArr.length-2], h2 = histArr[histArr.length-1];
        if (h1 < 0 && h2 >= 0) flags.mxBull = true;
        if (h1 > 0 && h2 <= 0) flags.mxBear = true;
    }

    // ── RSI Golden/Death Cross (RSI crosses EMA-9) ──
    if (rN >= 10) {
        const rsiEma9 = ema(rsiArr, 9);
        const eOff = rN - rsiEma9.length;
        const ri = rN - 1, ei = ri - eOff;
        if (ei >= 1) {
            if (rsiArr[ri-1] <= rsiEma9[ei-1] && rsiArr[ri] > rsiEma9[ei]) flags.rsiGolden = true;
            if (rsiArr[ri-1] >= rsiEma9[ei-1] && rsiArr[ri] < rsiEma9[ei]) flags.rsiDeath  = true;
        }
    }

    // ═══════════════════════════════════════════════════
    //  RSI DIVERGENCE
    //  Pine logic: at each bar where plFound=true (pivot confirmed),
    //  compare current pivot against the immediately preceding pivot.
    //  _inRange checks barssince(prev pivot) is in [rangeLo, rangeHi].
    //  We scan all consecutive pairs, most recent first, no cutoff.
    // ═══════════════════════════════════════════════════
    const rPlows  = pivotLows( rsiArr, DIV_LBL, DIV_LBR);
    const rPhighs = pivotHighs(rsiArr, DIV_LBL, DIV_LBR);

    // RSI Bullish: price LL + RSI HL at pivot lows
    for (let ci = rPlows.length - 1; ci >= 1; ci--) {
        const cur  = rPlows[ci];
        const prev = rPlows[ci - 1];                         // Pine: valuewhen(..., 1) = prev pivot
        const barsBetween = cur.idx - prev.idx;              // Pine: barssince(plFound[1])
        if (barsBetween < DIV_RANGE_LO || barsBetween > DIV_RANGE_HI) continue;
        if (lows[cur.idx] < lows[prev.idx] && cur.val > prev.val) {
            const age = (rN - 1) - cur.idx;
            if (age < flags.rdivAge) {
                flags.rdivBull = true;
                flags.rdivAge  = age;
                flags.rdivLine = { type: 'bull', oscPrev: prev, oscCur: cur };
            }
        }
    }

    // RSI Bearish: price HH + RSI LH at pivot highs
    for (let ci = rPhighs.length - 1; ci >= 1; ci--) {
        const cur  = rPhighs[ci];
        const prev = rPhighs[ci - 1];
        const barsBetween = cur.idx - prev.idx;
        if (barsBetween < DIV_RANGE_LO || barsBetween > DIV_RANGE_HI) continue;
        if (highs[cur.idx] > highs[prev.idx] && cur.val < prev.val) {
            const age = (rN - 1) - cur.idx;
            if (!flags.rdivBull && age < flags.rdivAge) {
                flags.rdivBear = true;
                flags.rdivAge  = age;
                flags.rdivLine = { type: 'bear', oscPrev: prev, oscCur: cur };
            }
        }
    }

    // ═══════════════════════════════════════════════════
    //  MACD DIVERGENCE
    //  Pine logic: same as RSI div but oscillator = macd line.
    //  Extra condition "don't touch zero":
    //    Bull: highest(osc, lbL+lbR+5) < 0  — entire window around cur pivot is negative
    //    Bear: lowest(osc,  lbL+lbR+5) > 0  — entire window around cur pivot is positive
    //  This mirrors: blowzero = donttouchzero ? priceHHZero < 0 : true  (Pine MACD div)
    //  where priceHHZero = highest(osc, lbL+lbR+5) at the cur-pivot bar
    // ═══════════════════════════════════════════════════
    const mPlows  = pivotLows( macdLine, DIV_LBL, DIV_LBR);
    const mPhighs = pivotHighs(macdLine, DIV_LBL, DIV_LBR);
    const WIN = DIV_LBL + DIV_LBR + 5;  // Pine: lbL+lbR+5

    // MACD Bullish: price LL + MACD HL, cur pivot < 0, window highest < 0
    for (let ci = mPlows.length - 1; ci >= 1; ci--) {
        const cur  = mPlows[ci];
        const prev = mPlows[ci - 1];
        if (cur.val >= 0) continue;                          // Pine: osc[lbR] < 0
        const barsBetween = cur.idx - prev.idx;
        if (barsBetween < DIV_RANGE_LO || barsBetween > DIV_RANGE_HI) continue;
        // Pine "don't touch zero": highest(osc, WIN) at cur-pivot bar must be < 0
        const winStart = Math.max(0, cur.idx - WIN + 1);
        const winSlice = macdLine.slice(winStart, cur.idx + 1);
        if (Math.max(...winSlice) >= 0) continue;            // touched/crossed zero in window
        if (lows[cur.idx] < lows[prev.idx] && cur.val > prev.val) {
            const age = (mN - 1) - cur.idx;
            if (age < flags.mdivAge) {
                flags.mdivBull = true;
                flags.mdivAge  = age;
                flags.mdivLine = { type: 'bull', oscPrev: prev, oscCur: cur };
            }
        }
    }

    // MACD Bearish: price HH + MACD LH, cur pivot > 0, window lowest > 0
    for (let ci = mPhighs.length - 1; ci >= 1; ci--) {
        const cur  = mPhighs[ci];
        const prev = mPhighs[ci - 1];
        if (cur.val <= 0) continue;                          // Pine: osc[lbR] > 0
        const barsBetween = cur.idx - prev.idx;
        if (barsBetween < DIV_RANGE_LO || barsBetween > DIV_RANGE_HI) continue;
        const winStart = Math.max(0, cur.idx - WIN + 1);
        const winSlice = macdLine.slice(winStart, cur.idx + 1);
        if (Math.min(...winSlice) <= 0) continue;
        if (highs[cur.idx] > highs[prev.idx] && cur.val < prev.val) {
            const age = (mN - 1) - cur.idx;
            if (!flags.mdivBull && age < flags.mdivAge) {
                flags.mdivBear = true;
                flags.mdivAge  = age;
                flags.mdivLine = { type: 'bear', oscPrev: prev, oscCur: cur };
            }
        }
    }

    return flags;
}


// ═══════════════════════════════════════
//  WATCHLIST
// ═══════════════════════════════════════
function toggleWatchlist(sym, starEl, cellEl) {
    if (watchlist.includes(sym)) {
        watchlist = watchlist.filter(s => s !== sym);
        if (starEl) { starEl.classList.remove('starred'); starEl.title = 'Add to Watchlist'; }
        if (cellEl) cellEl.classList.remove('in-watchlist');
    } else {
        watchlist.push(sym);
        if (starEl) { starEl.classList.add('starred'); starEl.title = 'Remove from Watchlist'; }
        if (cellEl) cellEl.classList.add('in-watchlist');
    }
    saveWatchlist();
    applyFilter(); // refresh counts
}

function initWatchlistFilter() {
    const btn = el('watchlistFilterBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        activeFilter = activeFilter === 'watchlist' ? 'all' : 'watchlist';
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        const target = activeFilter === 'watchlist' ? btn : document.querySelector('.filter-btn[data-filter="all"]');
        if (target) target.classList.add('active');
        applyFilter();
    });
}

// ═══════════════════════════════════════
//  SORT
// ═══════════════════════════════════════
function initSort() {
    const btn = el('sortBtn');
    const drop = el('sortDropdown');
    if (!btn || !drop) return;

    btn.addEventListener('click', e => {
        e.stopPropagation();
        drop.classList.toggle('open');
        btn.classList.toggle('active', drop.classList.contains('open'));
    });
    document.addEventListener('click', () => {
        drop.classList.remove('open');
        btn.classList.remove('active');
    });

    drop.querySelectorAll('.sort-item').forEach(item => {
        if (item.dataset.sort === activeSort) item.classList.add('active');
        item.addEventListener('click', e => {
            e.stopPropagation();
            activeSort = item.dataset.sort;
            drop.querySelectorAll('.sort-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            // Update label
            const lbl = el('sortLabel');
            if (lbl) {
                const labels = {
                    'default':'Default','az':'A→Z','za':'Z→A',
                    'price-hi':'Price↓','price-lo':'Price↑',
                    'rsi-hi':'RSI↓','rsi-lo':'RSI↑',
                    'macd-hi':'MACD↓','macd-lo':'MACD↑',
                    'div-age':'Div Fresh'
                };
                lbl.textContent = labels[activeSort] || 'Default';
            }
            drop.classList.remove('open');
            btn.classList.remove('active');
            lsSave();
            applyFilter();
        });
    });

    // Restore sort label
    const lbl = el('sortLabel');
    if (lbl && activeSort !== 'default') {
        const labels = {
            'az':'A→Z','za':'Z→A',
            'price-hi':'Price↓','price-lo':'Price↑',
            'rsi-hi':'RSI↓','rsi-lo':'RSI↑',
            'macd-hi':'MACD↓','macd-lo':'MACD↑',
            'div-age':'Div Fresh'
        };
        if (labels[activeSort]) lbl.textContent = labels[activeSort];
    }
}

function sortedSymbols(list) {
    if (activeSort === 'default') return list;
    return [...list].sort((a, b) => {
        const da = indicatorData[a], db = indicatorData[b];
        switch (activeSort) {
            case 'az': return a.localeCompare(b);
            case 'za': return b.localeCompare(a);
            case 'price-hi': return (db?.price||0) - (da?.price||0);
            case 'price-lo': return (da?.price||0) - (db?.price||0);
            case 'rsi-hi': {
                const ra = da?.rsi?.slice(-1)[0] ?? -1;
                const rb = db?.rsi?.slice(-1)[0] ?? -1;
                return rb - ra;
            }
            case 'rsi-lo': {
                const ra = da?.rsi?.slice(-1)[0] ?? 999;
                const rb = db?.rsi?.slice(-1)[0] ?? 999;
                return ra - rb;
            }
            case 'macd-hi': {
                const ma = da?.macd?.slice(-1)[0] ?? -Infinity;
                const mb = db?.macd?.slice(-1)[0] ?? -Infinity;
                return mb - ma;
            }
            case 'macd-lo': {
                const ma = da?.macd?.slice(-1)[0] ?? Infinity;
                const mb = db?.macd?.slice(-1)[0] ?? Infinity;
                return ma - mb;
            }
            case 'div-age': {
                const ageA = Math.min(da?.flags?.rdivAge??Infinity, da?.flags?.mdivAge??Infinity);
                const ageB = Math.min(db?.flags?.rdivAge??Infinity, db?.flags?.mdivAge??Infinity);
                return ageA - ageB;
            }
        }
        return 0;
    });
}

// ═══════════════════════════════════════
//  FILTER VISIBILITY TOGGLES
// ═══════════════════════════════════════
function initFilterToggles() {
    const saved = window._filterVis || {};
    document.querySelectorAll('#filterToggles input[type="checkbox"]').forEach(cb => {
        const fid = cb.dataset.fid;
        // restore saved state (default: all visible)
        if (saved[fid] === false) cb.checked = false;
        applyFilterToggle(fid, cb.checked);
        cb.addEventListener('change', () => {
            applyFilterToggle(fid, cb.checked);
            saveFilterToggles();
        });
    });
}

function applyFilterToggle(fid, visible) {
    // Hide/show the matching filter button in the filter bar
    document.querySelectorAll(`.filter-btn[data-fid="${fid}"]`).forEach(btn => {
        btn.classList.toggle('hidden-filter', !visible);
        // If we're hiding the active filter, switch back to All
        if (!visible && btn.classList.contains('active')) {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
            if (allBtn) { allBtn.classList.add('active'); activeFilter = 'all'; applyFilter(); }
        }
    });
}

function saveFilterToggles() {
    const state = {};
    document.querySelectorAll('#filterToggles input[type="checkbox"]').forEach(cb => {
        state[cb.dataset.fid] = cb.checked;
    });
    apiPost('/api/filter-vis', state);
}

// ═══════════════════════════════════════
//  FILTER
// ═══════════════════════════════════════
function initFilter() {
    // All filter-btn clicks (except watchlist which has its own handler)
    document.querySelectorAll('.filter-btn:not(#watchlistFilterBtn)').forEach(btn => {
        btn.addEventListener('click', () => {
            activeFilter = btn.dataset.filter;
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilter();
        });
    });
}

function matchesFilter(sym) {
    if (activeFilter==='all') return true;
    if (activeFilter==='watchlist') return watchlist.includes(sym);
    const d=indicatorData[sym]; if(!d||!d.flags) return false;
    const f=d.flags;
    switch(activeFilter) {
        case 'ob':        return f.ob;
        case 'os':        return f.os;
        case 'rdiv':      return f.rdivBull||f.rdivBear;
        case 'mxbull':    return f.mxBull;
        case 'mxbear':    return f.mxBear;
        case 'mdiv':      return f.mdivBull||f.mdivBear;
        case 'rsigolden': return f.rsiGolden;
        case 'rsideath':  return f.rsiDeath;
    }
    return true;
}

function applyFilter() {
    const counts = {all:0,ob:0,os:0,rdiv:0,mxbull:0,mxbear:0,mdiv:0,rsigolden:0,rsideath:0,watchlist:0};
    symbols.forEach(sym => {
        if (watchlist.includes(sym)) counts.watchlist++;
        const d=indicatorData[sym]; if(!d||!d.flags) { counts.all++; return; }
        const f=d.flags;
        counts.all++;
        if (f.ob) counts.ob++;
        if (f.os) counts.os++;
        if (f.rdivBull||f.rdivBear) counts.rdiv++;
        if (f.mxBull) counts.mxbull++;
        if (f.mxBear) counts.mxbear++;
        if (f.mdivBull||f.mdivBear) counts.mdiv++;
        if (f.rsiGolden) counts.rsigolden++;
        if (f.rsiDeath)  counts.rsideath++;
    });
    const idMap={all:'fcAll',ob:'fcOB',os:'fcOS',rdiv:'fcRDiv',mxbull:'fcMXBull',mxbear:'fcMXBear',mdiv:'fcMDiv',rsigolden:'fcRsiGolden',rsideath:'fcRsiDeath',watchlist:'fcWatchlist'};
    Object.entries(idMap).forEach(([k,id])=>{ const e=document.getElementById(id); if(e) e.textContent=counts[k]; });

    const grid = document.getElementById('gridContainer');

    // Get filtered list
    const matching = symbols.filter(s => matchesFilter(s));
    const hidden   = symbols.filter(s => !matchesFilter(s));

    // Apply sort — div filters always sort by age first, then user sort on top
    let sorted;
    const isDivFilter = activeFilter==='rdiv' || activeFilter==='mdiv';
    if (activeSort !== 'default') {
        sorted = sortedSymbols(matching);
    } else if (isDivFilter) {
        // default sort for div filters = by age
        const getAge = sym => {
            const d = indicatorData[sym]; if(!d||!d.flags) return Infinity;
            return activeFilter==='rdiv' ? (d.flags.rdivAge ?? Infinity) : (d.flags.mdivAge ?? Infinity);
        };
        sorted = [...matching].sort((a,b) => getAge(a) - getAge(b));
    } else {
        sorted = matching;
    }

    // Re-order DOM
    const needsReorder = activeSort !== 'default' || isDivFilter;
    if (needsReorder) {
        sorted.forEach(sym => {
            const cell = document.querySelector(`.cell[data-symbol="${sym}"], .list-row[data-symbol="${sym}"]`);
            if (cell) { cell.style.display = ''; grid.appendChild(cell); }
        });
        hidden.forEach(sym => {
            const cell = document.querySelector(`.cell[data-symbol="${sym}"], .list-row[data-symbol="${sym}"]`);
            if (cell) cell.style.display = 'none';
        });
    } else {
        symbols.forEach(sym => {
            const cell = document.querySelector(`.cell[data-symbol="${sym}"], .list-row[data-symbol="${sym}"]`);
            if (cell) cell.style.display = matching.includes(sym) ? '' : 'none';
        });
    }
}

// ═══════════════════════════════════════
//  COIN LIST IN SETTINGS
// ═══════════════════════════════════════
function initCoinList() {
    if (!el('coinListSearch')) return;
    renderCoinList('');
    el('coinListSearch').addEventListener('input', e => renderCoinList(e.target.value.trim()));
    el('selectAllCoins').addEventListener('click', () => {
        symbols=[...UNIVERSE]; lsSave(); renderCoinList(''); buildGrid(); refresh();
    });
    el('selectNoneCoins').addEventListener('click', () => {
        if (!confirm('Deselect all coins?')) return;
        symbols=[]; lsSave(); renderCoinList(''); buildGrid();
    });
    el('selectDefaultCoins').addEventListener('click', () => {
        symbols=[...DEFAULT_SYMBOLS]; lsSave(); renderCoinList(''); buildGrid(); refresh();
    });
}

function renderCoinList(query) {
    const list=el('coinList');
    const q=query.toUpperCase().replace('USDT','');
    const filtered=q?UNIVERSE.filter(s=>s.replace('USDT','').includes(q)):UNIVERSE;
    const cl=el('coinCountLabel'); if(cl) cl.textContent=`(${symbols.length}/${UNIVERSE.length})`;
    list.innerHTML=filtered.map(sym=>{
        const checked=symbols.includes(sym);
        const base=sym.replace('USDT','');
        return `<label class="coin-row">
            <input type="checkbox" data-sym="${sym}"${checked?' checked':''}>
            <span class="coin-row-sym">${base}</span><span class="coin-row-base">/USDT</span>
        </label>`;
    }).join('');
    list.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
        cb.addEventListener('change',()=>onCoinToggle(cb.dataset.sym, cb.checked));
    });
}

function onCoinToggle(sym, checked) {
    if (checked) {
        if (!symbols.includes(sym)) {
            symbols.push(sym);
            indicatorData[sym]=null;
            const grid=document.getElementById('gridContainer');
            if (grid) {
                const cell=makeCell(sym);
                grid.appendChild(cell);
                requestAnimationFrame(()=>drawPlaceholder(cell.querySelector('canvas'),sym));
                updateGrid();
                fetchAndDraw(sym);
            }
        }
    } else {
        symbols=symbols.filter(s=>s!==sym);
        delete indicatorData[sym];
        const cell=document.querySelector(`.cell[data-symbol="${sym}"]`);
        if (cell) cell.remove();
        updateGrid();
    }
    const cl=el('coinCountLabel'); if(cl) cl.textContent=`(${symbols.length}/${UNIVERSE.length})`;
    lsSave(); applyFilter();
}

// ═══════════════════════════════════════
//  POSITION CALCULATOR
// ═══════════════════════════════════════
function posGetSettings() {
    return window._posSettings || {};
}
async function posSaveSettings(s) {
    console.log('[pos-settings] saving:', JSON.stringify(s));
    window._posSettings = s;
    const r = await apiPost('/api/pos-settings', s);
    console.log('[pos-settings] response:', JSON.stringify(r));
    if (r && r.ok === true) return { ok: true };
    return { ok: false, error: r?.error || 'Save failed' };
}

function initPosCalculator() {
    // Settings page only
    if (!el('posCapital')) return;
    const s = posGetSettings();
    const riskVal = s.riskPerTrade ?? s.risk;
    if (s.capital    != null) el('posCapital').value      = s.capital;
    if (riskVal      != null) { el('posRiskSlider').value = riskVal; el('posRiskVal').textContent = parseFloat(riskVal).toFixed(1) + '%'; }
    if (s.feeRate    != null) el('posFeeRate').value      = s.feeRate;
    if (s.accountType)        el('posAccountType').value  = s.accountType;

    // Live slider labels
    el('posRiskSlider').addEventListener('input', e => {
        el('posRiskVal').textContent = parseFloat(e.target.value).toFixed(1) + '%';
    });

    // Save
    el('savePosSettings').addEventListener('click', async () => {
        const result = await posSaveSettings({
            capital:      parseFloat(el('posCapital').value) || 1000,
            riskPerTrade: parseFloat(el('posRiskSlider').value) || 1,
            accountType:  el('posAccountType').value,
            feeRate:      parseFloat(el('posFeeRate').value) || 0.00
        });
        const msg = el('posSavedMsg');
        if (result.ok) {
            msg.textContent = '✓ Saved!';
            msg.style.color = '#48bb78';
        } else {
            msg.textContent = '✗ ' + (result.error || 'Save failed');
            msg.style.color = '#f87171';
        }
        msg.style.display = 'block';
        setTimeout(() => msg.style.display = 'none', 2500);
    });
}

function calcPositionSize(entry, sl, tp, leverageOverride) {
    const s = posGetSettings();
    const capital     = parseFloat(s.capital)                          || 1000;
    const riskPct     = parseFloat(s.riskPerTrade ?? s.risk)           || 1;
    const accountType = s.accountType                                  || 'futures_cross';
    const feeRate     = s.feeRate != null ? parseFloat(s.feeRate) : 0.00;

    entry = parseFloat(entry); sl = parseFloat(sl); tp = parseFloat(tp);
    if (!entry || !sl || entry === sl) return null;

    const isSpot    = accountType === 'spot';
    // Use provided override (Bybit max lev for that coin), else fall back to a default
    const lev       = isSpot ? 1 : (leverageOverride || 10);
    const riskAmt   = capital * (riskPct / 100);
    const slDist    = Math.abs(entry - sl);
    const slPct     = (slDist / entry) * 100;
    const qty       = riskAmt / slDist;
    const posValue  = qty * entry;
    const margin    = posValue / lev;
    const feesTotal = feeRate > 0 ? posValue * (feeRate / 100) * 2 : 0;
    const netRisk   = riskAmt + feesTotal;
    const tpDist    = (tp && tp !== entry) ? Math.abs(tp - entry) : null;
    const profitRaw = tpDist ? qty * tpDist - feesTotal : null;
    const rrActual  = (profitRaw != null && riskAmt > 0) ? (profitRaw / riskAmt).toFixed(2) : null;
    const marginPct = (margin / capital) * 100;

    const dp    = entry >= 1000 ? 2 : entry >= 1 ? 4 : 6;
    const fmtP  = v => v != null ? '$' + Math.abs(v).toFixed(2) : '—';
    const fmtPr = v => v != null ? (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2) : '—';
    const fmtQ  = v => v >= 1000 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(6);
    const fmtN  = v => v != null ? v.toFixed(dp) : '—';

    return { capital, riskPct, riskAmt, leverage: lev, accountType, feeRate,
             qty, posValue, margin, marginPct, feesTotal, netRisk,
             slDist, slPct, tpDist, profitRaw, rrActual,
             isSpot, dp, fmtP, fmtPr, fmtQ, fmtN,
             entry, sl, tp };
}

function renderPositionCard(entryRaw, slRaw, tpRaw, direction, leverageOverride) {
    const c = calcPositionSize(entryRaw, slRaw, tpRaw, leverageOverride);
    if (!c) return '';

    const dir = (direction || 'LONG').toUpperCase();
    const isLong = dir === 'LONG';
    const lev = c.isSpot ? 'Spot' : c.leverage + 'x';
    const dirArrow = isLong ? '▲' : '▼';
    const dirColor = isLong ? '#48bb78' : '#f56565';

    const marginWarn = c.marginPct > 50
        ? `<div class="pos-calc-warn" style="color:#f56565;margin-top:0.4rem">⚠ Margin is ${c.marginPct.toFixed(1)}% of capital — reduce leverage</div>`
        : c.marginPct > 25
        ? `<div class="pos-calc-warn" style="color:#f6ad55;margin-top:0.4rem">⚠ Margin is ${c.marginPct.toFixed(1)}% of capital</div>` : '';

    const feeNote = c.feeRate === 0 ? '' : ` · ${c.feeRate}% fee/side`;

    return `
    <div class="pos-calc-card">
        <div class="pos-calc-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Position Sizing · ${lev} Leverage
        </div>

        <!-- Key position numbers -->
        <div class="pos-calc-grid">
            <div class="pos-calc-item highlight full">
                <div class="pos-calc-label">Position Size (enter this much)</div>
                <div class="pos-calc-val gold">${c.fmtP(c.posValue)} <span style="font-size:0.75rem;color:${dirColor};font-weight:700">${dirArrow} ${dir}</span></div>
            </div>
            <div class="pos-calc-item highlight">
                <div class="pos-calc-label">Required Margin</div>
                <div class="pos-calc-val blue">${c.fmtP(c.margin)}</div>
            </div>
            <div class="pos-calc-item highlight">
                <div class="pos-calc-label">Max Loss</div>
                <div class="pos-calc-val red">-${c.fmtP(c.netRisk)}</div>
            </div>
            ${c.profitRaw != null ? `
            <div class="pos-calc-item">
                <div class="pos-calc-label">Est. Profit (at TP)</div>
                <div class="pos-calc-val green">+${c.fmtP(c.profitRaw)}</div>
            </div>
            <div class="pos-calc-item">
                <div class="pos-calc-label">Real R:R${c.feeRate > 0 ? ' (after fees)' : ''}</div>
                <div class="pos-calc-val blue">1 : ${c.rrActual}</div>
            </div>` : ''}
        </div>

        <div class="pos-calc-warn">$${c.capital.toLocaleString()} capital · ${c.riskPct}% risk per trade${feeNote}</div>
        ${marginWarn}
    </div>`;
}


// ═══════════════════════════════════════
//  DRAWING PERSISTENCE  (DB-backed)
// ═══════════════════════════════════════
// In-memory mirror of the drawings so reads stay synchronous
let _drawingsCache = {};

function drawingsStore() { return _drawingsCache; }
function drawingsSave(sym, tf, objs) {
    if (!_drawingsCache[sym]) _drawingsCache[sym] = {};
    if (objs && objs.length > 0) {
        _drawingsCache[sym][tf] = objs;
    } else {
        delete _drawingsCache[sym][tf];
        if (Object.keys(_drawingsCache[sym]).length === 0) delete _drawingsCache[sym];
    }
    apiPost(`/api/drawings/${sym}/${tf}`, { objs: objs || [] });
}
function drawingsLoad(sym, tf) {
    return (_drawingsCache[sym] && _drawingsCache[sym][tf]) ? _drawingsCache[sym][tf] : [];
}
function drawingsClearSym(sym) {
    delete _drawingsCache[sym];
    apiDelete(`/api/drawings/${sym}`);
}
function drawingsClearSymTf(sym, tf) {
    if (_drawingsCache[sym]) {
        delete _drawingsCache[sym][tf];
        if (Object.keys(_drawingsCache[sym]).length === 0) delete _drawingsCache[sym];
    }
    apiDelete(`/api/drawings/${sym}/${tf}`);
}
function drawingsClearAll() {
    _drawingsCache = {};
    apiDelete('/api/drawings');
}

// Render the drawings manager list in settings
function renderDrawingsManager() {
    const list = document.getElementById('drawingsManagerList');
    const empty = document.getElementById('drawingsEmptyMsg');
    const clearAllBtn = document.getElementById('clearAllDrawingsBtn');
    if (!list) return;

    const store = drawingsStore();
    const coins = Object.keys(store);

    if (coins.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'block';
        clearAllBtn.style.display = 'none';
        return;
    }
    empty.style.display = 'none';
    clearAllBtn.style.display = '';

    list.innerHTML = coins.map(sym => {
        const tfs = Object.keys(store[sym]);
        const tfBadges = tfs.map(tf => {
            const count = (store[sym][tf] || []).length;
            return `<span class="draw-tf-badge">
                ${tf} <span class="draw-tf-count">${count}</span>
                <button class="draw-tf-del" data-sym="${sym}" data-tf="${tf}" title="Delete ${tf} drawings">×</button>
            </span>`;
        }).join('');
        return `<div class="draw-coin-row">
            <div class="draw-coin-sym">${sym}</div>
            <div class="draw-coin-tfs">${tfBadges}</div>
            <button class="draw-coin-clear" data-sym="${sym}">Clear All</button>
        </div>`;
    }).join('');

    // Clear all for a coin
    list.querySelectorAll('.draw-coin-clear').forEach(btn => {
        btn.addEventListener('click', () => {
            const sym = btn.dataset.sym;
            if (confirm(`Clear all drawings for ${sym}?`)) {
                drawingsClearSym(sym);
                // if this coin is currently open, reset drawObjs
                if (currentSym === sym) { drawObjs = []; drawHistory = []; histIdx = -1; redrawModal(); updateUndoBtns(); }
                renderDrawingsManager();
            }
        });
    });

    // Delete single TF
    list.querySelectorAll('.draw-tf-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const { sym, tf } = btn.dataset;
            drawingsClearSymTf(sym, tf);
            // if currently viewing this coin+tf, reset
            if (currentSym === sym && el('timeframe').value === tf) {
                drawObjs = []; drawHistory = []; histIdx = -1; redrawModal(); updateUndoBtns();
            }
            renderDrawingsManager();
        });
    });
}

function kimiGetSettings() {
    return window._kimiSettings || {};
}
function kimiSaveSettings(s) {
    window._kimiSettings = s;
    apiPost('/api/kimi-settings', s);
}

// Cache helpers — keyed by "SYM:TF"
let _kimiCache = {};
function kimiCacheGet(sym, tf) {
    return _kimiCache[`${sym}:${tf}`] || null;
}
function kimiCacheSet(sym, tf, result) {
    _kimiCache[`${sym}:${tf}`] = result;
    apiPost('/api/kimi-cache', { key: `${sym}:${tf}`, value: result });
}
function kimiCacheClear(sym, tf) {
    delete _kimiCache[`${sym}:${tf}`];
    apiDelete('/api/kimi-cache', { key: `${sym}:${tf}` });
}

let _aiUsage = null;
function getClientTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch (_) { return 'UTC'; }
}

async function fetchAiUsage() {
    try {
        const res = await fetch('/api/analysis/usage', { cache: 'no-store' });
        if (!res.ok) return null;
        _aiUsage = await res.json();
        renderAiUsageCounter();
        return _aiUsage;
    } catch (_) {
        return null;
    }
}

function renderAiUsageCounter() {
    const elCounter = el('aiUsageCounter');
    const btn = el('aiAnalyzeBtn');
    if (!elCounter || !btn || !_aiUsage) return;
    if (_aiUsage.isPremium) {
        elCounter.style.display = 'block';
        elCounter.style.color = '#0ecb81';
        elCounter.textContent = 'AI ∞';
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.title = 'Analyze with AI (Unlimited)';
        return;
    }
    const used = Number(_aiUsage.used || 0);
    const limit = Number(_aiUsage.limit || 3);
    const reached = used >= limit;
    let color = '#0ecb81';
    if (used >= limit) color = '#f6465d';
    else if (used >= limit - 1) color = '#f0b90b';
    elCounter.style.display = 'block';
    elCounter.style.color = color;
    elCounter.textContent = reached ? `${limit}/${limit}` : `${used}/${limit}`;
    btn.disabled = false;
    btn.style.opacity = reached ? '0.6' : '1';
    btn.style.cursor = reached ? 'not-allowed' : 'pointer';
    btn.title = reached ? 'Daily limit reached (3/3) Resets at midnight your time' : 'Analyze with AI';
}

function showAiLimitModal() {
    const md = document.getElementById('aiLimitModal');
    if (md) md.style.display = 'flex';
}

function initKimiAI() {
    // Restore saved AI settings into fields (settings page only)
    if (!el('kimiApiKey')) return;
    if (!el('aiAnalyzeBtn')) return;
    const s = kimiGetSettings();
    if (s.apiKey)  el('kimiApiKey').value  = s.apiKey;
    if (s.model)   el('kimiModel').value   = s.model;
    if (s.baseUrl) el('kimiBaseUrl').value = s.baseUrl;

    // Save button
    el('saveKimiSettings').addEventListener('click', async () => {
        const btn = el('saveKimiSettings');
        const savedMsg = el('kimiSavedMsg');
        const testMsg  = el('kimiTestMsg');
        const newSettings = {
            apiKey:  el('kimiApiKey').value.trim(),
            model:   el('kimiModel').value,
            baseUrl: el('kimiBaseUrl').value.trim()
        };
        btn.disabled = true;
        btn.textContent = 'Saving…';
        testMsg.style.display = 'none';
        try {
            const resp = await fetch('/api/kimi-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newSettings),
            });
            const r = await resp.json();
            if (!resp.ok || !r.ok) throw new Error(r.error || `HTTP ${resp.status}`);
            window._kimiSettings = newSettings;
            savedMsg.style.display = 'block';
            setTimeout(() => savedMsg.style.display = 'none', 2000);
        } catch (e) {
            testMsg.style.display = 'block';
            testMsg.style.background = '#2a0d0d';
            testMsg.style.color = '#f87171';
            testMsg.textContent = `✗ Save failed: ${e.message}`;
        } finally {
            btn.disabled = false;
            btn.textContent = '💾 Save AI Settings';
        }
    });

    el('testKimiKey').addEventListener('click', async () => {
        const btn = el('testKimiKey');
        const msg = el('kimiTestMsg');
        btn.disabled = true;
        btn.textContent = 'Testing…';
        msg.style.display = 'none';
        try {
            const resp = await fetch('/api/kimi-settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const r = await resp.json();
            msg.style.display = 'block';
            if (r.ok) {
                msg.style.background = '#0d2a1a';
                msg.style.color = '#48bb78';
                msg.textContent = `✓ Server key valid  (${r.maskedKey})`;
            } else {
                msg.style.background = '#2a0d0d';
                msg.style.color = '#f87171';
                msg.textContent = `✗ ${r.error}${r.maskedKey ? '  key: ' + r.maskedKey : ''}`;
            }
        } catch (e) {
            msg.style.display = 'block';
            msg.style.background = '#2a0d0d';
            msg.style.color = '#f87171';
            msg.textContent = `✗ Request failed: ${e.message}`;
        } finally {
            btn.disabled = false;
            btn.textContent = '🔑 Test Server-Side Key';
        }
    });

    fetchAiUsage();

    // Analyze button
    el('aiAnalyzeBtn').addEventListener('click', () => {
        if (_aiUsage && !_aiUsage.isPremium && Number(_aiUsage.used || 0) >= Number(_aiUsage.limit || 3)) {
            showAiLimitModal();
            return;
        }
        runKimiAnalysis();
    });

    // Close AI panel — also clears cache for this coin
    el('aiClosePanel').addEventListener('click', () => {
        const tf = el('timeframe').value;
        kimiCacheClear(currentSym, tf);
        el('aiPanel').classList.remove('open');
        el('aiContent').innerHTML = '';
    });
}

// Called every time modal opens — restore cached result if exists
function restoreAIPanel() {
    const tf = el('timeframe').value;
    const cached = kimiCacheGet(currentSym, tf);
    const panel = el('aiPanel');
    const content = el('aiContent');

    if (cached) {
        panel.classList.add('open');
        renderAIResult(cached.result, currentSym, tf, cached.price, cached.analyzedAt);
    } else {
        panel.classList.remove('open');
        content.innerHTML = '';
    }
}

async function runKimiAnalysis() {
    const sym = currentSym;
    const d = indicatorData[sym];
    if (!d) { alert('No data loaded for this coin yet. Wait for it to load.'); return; }

    // Pre-fetch Bybit max leverage for this coin so position card uses correct value
    const fullSym = sym.endsWith('USDT') ? sym : sym + 'USDT';
    bytFetchMaxLev(fullSym).catch(() => {});

    const panel = el('aiPanel');
    const content = el('aiContent');
    const btn = el('aiAnalyzeBtn');

    if (_aiUsage && !_aiUsage.isPremium && Number(_aiUsage.used || 0) >= Number(_aiUsage.limit || 3)) {
        showAiLimitModal();
        return;
    }

    panel.classList.add('open');
    btn.disabled = true;
    content.innerHTML = `<div class="ai-loading"><div class="ai-spinner"></div>AI is analyzing ${sym} with full candle data…</div>`;

    const tf = el('timeframe').value;
    const price = d.price;
    const f = d.flags || {};

    // ── Use FULL arrays if available, fallback to sliced ──
    const ohlcAll  = d.ohlcFull  || d.ohlc;
    const rsiAll   = d.rsiArr    || d.rsi;
    const macdAll  = d.macdArr   || d.macd;
    const signalAll= d.signalArr || d.signal;
    const histAll  = d.histArr   || d.hist;

    const n = ohlcAll.length;
    const rsiLen   = rsiAll.length;
    const macdLen  = macdAll.length;

    // Align all arrays to the same length (macd is shortest due to warm-up)
    const alignLen = Math.min(n, rsiLen, macdLen);
    const ohlcAligned   = ohlcAll.slice(-alignLen);
    const rsiAligned    = rsiAll.slice(-alignLen);
    const macdAligned   = macdAll.slice(-alignLen);
    const signalAligned = signalAll.slice(-alignLen);
    const histAligned   = histAll.slice(-alignLen);

    // Build full candle table (all available bars)
    const candleTable = ohlcAligned.map((c, i) => {
        const r  = rsiAligned[i]    != null ? rsiAligned[i].toFixed(2)    : '-';
        const m  = macdAligned[i]   != null ? macdAligned[i].toFixed(6)   : '-';
        const sg = signalAligned[i] != null ? signalAligned[i].toFixed(6) : '-';
        const h  = histAligned[i]   != null ? histAligned[i].toFixed(6)   : '-';
        const dp = price >= 1000 ? 2 : price >= 1 ? 4 : 6;
        return `${i+1}\t${c[0].toFixed(dp)}\t${c[1].toFixed(dp)}\t${c[2].toFixed(dp)}\t${c[3].toFixed(dp)}\t${r}\t${m}\t${sg}\t${h}`;
    }).join('\n');

    // Latest values
    const lastRSI    = rsiAll[rsiAll.length - 1];
    const lastMACD   = macdAll[macdAll.length - 1];
    const lastSignal = signalAll[signalAll.length - 1];
    const lastHist   = histAll[histAll.length - 1];

    // Price stats
    const allCloses = ohlcAll.map(c => c[3]);
    const allHighs  = ohlcAll.map(c => c[1]);
    const allLows   = ohlcAll.map(c => c[2]);
    const highestPrice = Math.max(...allHighs);
    const lowestPrice  = Math.min(...allLows);
    const avgClose     = (allCloses.reduce((a,b) => a+b, 0) / allCloses.length);

    // RSI stats
    const avgRSI = (rsiAll.reduce((a,b) => a+b, 0) / rsiAll.length);
    const rsiTrend = rsiAll.slice(-5);
    const rsiTrendDir = rsiTrend[rsiTrend.length-1] > rsiTrend[0] ? 'Rising' : 'Falling';

    // MACD trend
    const histLast5 = histAll.slice(-5);
    const histTrend = histLast5[histLast5.length-1] > histLast5[0] ? 'Expanding Bullish' :
                      histLast5[histLast5.length-1] < histLast5[0] ? 'Expanding Bearish' : 'Flat';

    // Active signals
    const signals = [];
    if (f.ob)       signals.push('RSI Overbought (≥70)');
    if (f.os)       signals.push('RSI Oversold (≤30)');
    if (f.mxBull)   signals.push('MACD Bullish Histogram Cross');
    if (f.mxBear)   signals.push('MACD Bearish Histogram Cross');
    if (f.rdivBull) signals.push('RSI Bullish Divergence (price made lower low, RSI made higher low)');
    if (f.rdivBear) signals.push('RSI Bearish Divergence (price made higher high, RSI made lower high)');
    if (f.mdivBull) signals.push('MACD Bullish Divergence');
    if (f.mdivBear) signals.push('MACD Bearish Divergence');
    if (f.rsiGolden) signals.push('RSI Golden Cross (RSI crossed above EMA-9)');
    if (f.rsiDeath)  signals.push('RSI Death Cross (RSI crossed below EMA-9)');

    const rsiLen14 = +el('rsiLen').value || 14;
    const fastLen  = +el('fastLen').value || 12;
    const slowLen  = +el('slowLen').value || 26;
    const sigLen   = +el('signalLen').value || 9;

    const prompt = `You are an expert crypto futures technical analyst. Analyze the complete dataset below for ${sym} on the ${tf} timeframe and provide a precise, high-confidence trade recommendation.

═══════════════════════════════════════
MARKET OVERVIEW
═══════════════════════════════════════
Symbol    : ${sym}
Timeframe : ${tf}
Current Price : ${price}
Total Candles : ${alignLen}

Indicator Settings Used:
  RSI Length   : ${rsiLen14}
  MACD Fast    : ${fastLen}
  MACD Slow    : ${slowLen}
  MACD Signal  : ${sigLen}

═══════════════════════════════════════
PRICE STATISTICS (all ${alignLen} bars)
═══════════════════════════════════════
Highest High : ${highestPrice.toFixed(price >= 1000 ? 2 : price >= 1 ? 4 : 6)}
Lowest Low   : ${lowestPrice.toFixed(price >= 1000 ? 2 : price >= 1 ? 4 : 6)}
Average Close: ${avgClose.toFixed(price >= 1000 ? 2 : price >= 1 ? 4 : 6)}

═══════════════════════════════════════
CURRENT INDICATOR VALUES (latest bar)
═══════════════════════════════════════
RSI (${rsiLen14})    : ${lastRSI.toFixed(2)} — trend last 5 bars: ${rsiTrendDir} | avg: ${avgRSI.toFixed(2)}
MACD Line  : ${lastMACD.toFixed(6)}
Signal Line: ${lastSignal.toFixed(6)}
Histogram  : ${lastHist.toFixed(6)} — momentum: ${histTrend}
MACD vs Signal: ${lastMACD > lastSignal ? 'MACD ABOVE Signal (Bullish)' : 'MACD BELOW Signal (Bearish)'}

═══════════════════════════════════════
ACTIVE SCANNER SIGNALS
═══════════════════════════════════════
${signals.length ? signals.map(s => '• ' + s).join('\n') : '• No special signals detected'}

═══════════════════════════════════════
FULL CANDLE DATA — ALL ${alignLen} BARS
Format: #  Open  High  Low  Close  RSI  MACD  Signal  Histogram
═══════════════════════════════════════
${candleTable}

═══════════════════════════════════════
YOUR TASK
═══════════════════════════════════════
Using ALL the data above (price action, RSI momentum, MACD crossovers, divergences, support/resistance levels visible in the candles), provide a trade recommendation.

Identify key support/resistance levels from the candle data.
Consider trend direction, momentum strength, and risk management.

Respond ONLY in this exact JSON format, no markdown, no extra text:
{
  "direction": "LONG" or "SHORT" or "NEUTRAL",
  "entry": <number — current price or slightly better level>,
  "tp": <number — take profit based on nearest resistance/support>,
  "sl": <number — stop loss below/above key level>,
  "rr": "<string — e.g. 1:2.3>",
  "confidence": "<LOW / MEDIUM / HIGH>",
  "reasoning": "<4-6 sentences covering: trend context, key levels identified, indicator confluence, why this direction, where TP/SL are placed>"
}`;

    try {
        const res = await fetch('/api/ai/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, timezone: getClientTimezone() }),
        });
        const data = await res.json();
        if (res.status === 429 || data?.error === 'limit_reached') {
            await fetchAiUsage();
            showAiLimitModal();
            throw new Error(data.message || 'Daily AI analysis limit reached');
        }
        if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

        let parsed;
        try {
            const cleaned = (data.result || '').replace(/```json|```/gi, '').trim();
            parsed = JSON.parse(cleaned);
        } catch(e) {
            throw new Error('Could not parse AI response. Raw: ' + (data.result || '').slice(0, 300));
        }

        const analyzedAt = new Date().toLocaleString();
        kimiCacheSet(sym, tf, { result: parsed, price, analyzedAt });
        renderAIResult(parsed, sym, tf, price, analyzedAt);
        if (_aiUsage && !_aiUsage.isPremium) {
            _aiUsage.used = Number(_aiUsage.used || 0) + 1;
            renderAiUsageCounter();
        } else {
            fetchAiUsage();
        }

    } catch(err) {
        content.innerHTML = `<div class="ai-error">⚠ ${err.message}</div>`;
    } finally {
        btn.disabled = false;
    }
}

function renderAIResult(r, sym, tf, price, analyzedAt) {
    const dir = (r.direction || 'NEUTRAL').toUpperCase();
    const dirClass = dir === 'LONG' ? 'long' : dir === 'SHORT' ? 'short' : 'neutral';
    const dirEmoji = dir === 'LONG' ? '▲' : dir === 'SHORT' ? '▼' : '◆';

    const conf = (r.confidence || '').toUpperCase();
    const confColor = conf === 'HIGH' ? 'var(--accent-green)' : conf === 'MEDIUM' ? 'var(--accent-amber)' : 'var(--accent-red)';

    const timeLabel = analyzedAt ? `<span style="font-size:10px;color:var(--text-dim)">Analyzed: ${analyzedAt}</span>` : '';

    // Get Bybit max leverage for this coin (global bytMaxLevCache, falls back to bytMaxLev)
    const coinMaxLev = (window.bytMaxLevCache && window.bytMaxLevCache[sym + 'USDT']) || bytMaxLev || 100;

    // Position calculator card — uses Bybit max leverage
    const posSettings = posGetSettings();
    const hasCapital = posSettings.capital && parseFloat(posSettings.capital) > 0;
    const posCard = (hasCapital && dir !== 'NEUTRAL' && r.entry && r.sl)
        ? renderPositionCard(r.entry, r.sl, r.tp, dir, coinMaxLev)
        : (dir !== 'NEUTRAL' && r.entry && r.sl)
            ? `<div style="background:var(--bg-raised);border:1px dashed var(--border-mid);border-radius:8px;padding:0.65rem 0.85rem;font-size:11px;color:var(--text-muted);text-align:center">
                💰 Set your <strong style="color:var(--accent-amber);cursor:pointer" onclick="sessionStorage.setItem('settings_tab','bybit');window.location.href='/settings'">capital &amp; risk in Settings → Bybit</strong> to see position sizing
               </div>`
            : '';

    el('aiContent').innerHTML = `
        <div class="ai-result">
            <!-- Direction + Confidence row -->
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.4rem">
                <div class="ai-direction-badge ${dirClass}">
                    ${dirEmoji} ${dir}
                    <span style="font-size:0.72rem;font-weight:500;opacity:0.75">${sym} · ${tf}</span>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem">
                    ${conf ? `<div style="background:rgba(0,0,0,0.3);border:1px solid ${confColor}44;border-radius:6px;padding:0.25rem 0.65rem;font-size:11px;font-weight:700;color:${confColor}">Confidence: ${conf}</div>` : ''}
                    <div style="text-align:right">
                        ${timeLabel}
                        <div style="font-size:10px;color:var(--text-dim)">Kimi AI</div>
                    </div>
                </div>
            </div>

            <!-- THE one and only Entry / SL / TP / R:R display -->
            <div class="ai-metrics" style="grid-template-columns:repeat(4,1fr)">
                <div class="ai-metric-card">
                    <div class="ai-metric-label">Entry</div>
                    <div class="ai-metric-val" style="color:var(--text-primary)">${r.entry ? parseFloat(r.entry).toPrecision(6).replace(/\.?0+$/,'') : '—'}</div>
                </div>
                <div class="ai-metric-card">
                    <div class="ai-metric-label">Stop Loss</div>
                    <div class="ai-metric-val sl">${r.sl ? parseFloat(r.sl).toPrecision(6).replace(/\.?0+$/,'') : '—'}</div>
                </div>
                <div class="ai-metric-card">
                    <div class="ai-metric-label">Take Profit</div>
                    <div class="ai-metric-val tp">${r.tp ? parseFloat(r.tp).toPrecision(6).replace(/\.?0+$/,'') : '—'}</div>
                </div>
                <div class="ai-metric-card">
                    <div class="ai-metric-label">R : R</div>
                    <div class="ai-metric-val rr">${r.rr || '—'}</div>
                </div>
            </div>

            <!-- Position sizing card (no entry/sl/tp inside, just sizing numbers) -->
            ${posCard}

            <!-- Reasoning -->
            <div class="ai-reasoning">${(r.reasoning || '').replace(/\n/g, '<br>')}</div>

            <!-- Trade button -->
            ${(dir !== 'NEUTRAL' && r.entry && r.sl) ? `
            <button onclick="bybitOpenFromAI('${sym}','${dir}',${parseFloat(r.entry)||0},${parseFloat(r.sl)||0},${parseFloat(r.tp)||0},${coinMaxLev})"
              style="width:100%;padding:0.65rem;background:linear-gradient(135deg,#92400e,var(--accent-amber));color:#0f0700;border:none;border-radius:9px;font-weight:800;font-size:13px;cursor:pointer;font-family:var(--font-ui);letter-spacing:0.2px;display:flex;align-items:center;justify-content:center;gap:0.5rem">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              ⚡ Trade on Bybit · ${coinMaxLev}x Max Lev
            </button>` : ''}
        </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  BYBIT TRADING TERMINAL
// ═══════════════════════════════════════════════════════════════
let bytDirection = 'Buy';
let bytRefreshTimer = null;
let bytSlMode = 'price'; // 'price' | 'pnl'
let bytTpMode = 'price'; // 'price' | 'pnl'

// ── Credentials — dual account ───────────────────────────────
// In-memory cache; loaded on boot via loadAppState()
function bybitGetStore() {
    return window._bybitStore || {};
}
async function bybitSaveStore(s) {
    window._bybitStore = s;
    const r = await apiPost('/api/bybit-store', s);
    return r && r.ok !== false;
}
function bybitGetCreds() {
    const s = bybitGetStore();
    const env = s.activeEnv || 'mainnet';
    const creds = s[env] || {};
    return { ...creds, env };
}

async function bybitSaveAccount(env) {
    const s = bybitGetStore();
    if (!s[env]) s[env] = {};
    if (env === 'mainnet') {
        s.mainnet = { apiKey: el('bybitLiveKey').value.trim(), apiSecret: el('bybitLiveSecret').value.trim() };
    } else {
        s.testnet = { apiKey: el('bybitDemoKey').value.trim(), apiSecret: el('bybitDemoSecret').value.trim() };
    }
    const ok = await bybitSaveStore(s);
    if (ok) {
        showMsg('bybitCredMsg', `✓ ${env === 'mainnet' ? 'Live' : 'Demo'} credentials saved!`, '#48bb78');
    } else {
        showMsg('bybitCredMsg', `✗ Save failed — please try again`, '#f87171');
    }
}

async function bybitSwitchAccount(env, save = true) {
    const s = bybitGetStore();
    s.activeEnv = env;
    if (save) {
        const ok = await bybitSaveStore(s);
        if (!ok) { /* silent — UI still updates */ }
    } else {
        window._bybitStore = s;
    }
    // Update UI
    const isLive = env === 'mainnet';
    el('bybitAccLiveBtn').style.background = isLive ? '#166534' : '#0f1319';
    el('bybitAccLiveBtn').style.color      = isLive ? '#4ade80' : '#6b7897';
    el('bybitAccDemoBtn').style.background = !isLive ? '#1e3a8a' : '#0f1319';
    el('bybitAccDemoBtn').style.color      = !isLive ? '#93c5fd' : '#6b7897';
    el('bybitLiveCreds').style.display = isLive  ? '' : 'none';
    el('bybitDemoCreds').style.display = !isLive ? '' : 'none';
    // Show active account banner
    const msg = el('bybitCredMsg2');
    msg.textContent = isLive ? '🟢 Active: Live Account (Real Money)' : '🧪 Active: Demo Account (Paper Trading)';
    msg.style.background = isLive ? '#052e16' : '#1e3a8a33';
    msg.style.color = isLive ? '#4ade80' : '#93c5fd';
    msg.style.display = 'block';
    // Update terminal header
    updateTerminalEnvBadge(env);
    // Restart background poller with new creds
    clearInterval(bytRefreshTimer);
    const creds = bybitGetCreds();
    if (creds.apiKey) setTimeout(bytPollPositionsBackground, 500);
}

function updateTerminalEnvBadge(env) {
    const badge = el('bytLiveBadge');
    if (!badge) return;
    if (env === 'testnet') {
        badge.textContent = '🧪 DEMO';
        badge.style.background = '#1e3a8a33';
        badge.style.color = '#93c5fd';
        badge.style.borderColor = '#1d4ed8';
    } else {
        badge.textContent = '● LIVE';
        badge.style.background = '#052e16';
        badge.style.color = '#4ade80';
        badge.style.borderColor = '#166534';
    }
}

// Background poll — keeps header badge updated without opening terminal
async function bytPollPositionsBackground() {
    const creds = bybitGetCreds();
    if (!creds.apiKey || !creds.apiSecret) return;
    try {
        const res = await bybitRequest('GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
        if (res.retCode !== 0) return;
        const pos = (res.result?.list || []).filter(p => parseFloat(p.size) > 0);
        const hdr = el('bytHeaderPosCount');
        const btn = el('bybitTerminalBtn');
        if (!hdr || !btn) return;
        if (pos.length > 0) {
            hdr.textContent = pos.length; hdr.style.display = 'inline';
            btn.classList.add('has-positions');
            btn.title = `Bybit Terminal — ${pos.length} open position${pos.length>1?'s':''}`;
        } else {
            hdr.style.display = 'none';
            btn.classList.remove('has-positions');
            btn.title = 'Bybit Trading Terminal';
        }
    } catch(_) {}
}

function initBybit() {
    bybitSyncClock();
    bytSetQtyMode('cost');

    // Load saved credentials into forms + switch account UI (settings page only)
    if (el('bybitLiveKey')) {
        const store = bybitGetStore();
        const activeEnv = store.activeEnv || 'mainnet';
        if (store.mainnet?.apiKey)    el('bybitLiveKey').value    = store.mainnet.apiKey;
        if (store.mainnet?.apiSecret) el('bybitLiveSecret').value = store.mainnet.apiSecret;
        if (store.testnet?.apiKey)    el('bybitDemoKey').value    = store.testnet.apiKey;
        if (store.testnet?.apiSecret) el('bybitDemoSecret').value = store.testnet.apiSecret;
        bybitSwitchAccount(activeEnv, false);
        if (el('testBybitConn')) {
            el('testBybitConn').addEventListener('click', async () => {
                const btn = el('testBybitConn');
                btn.textContent = 'Testing…'; btn.disabled = true;
                try {
                    const res = await fetch('/api/bybit/test').then(r => r.json());
                    if (res.ok) {
                        const bal = res.equity;
                        showMsg('bybitCredMsg', `✓ Connected! Equity: ${bal ? '$'+parseFloat(bal).toFixed(2) : 'fetched'}`, '#48bb78');
                    } else {
                        const hint = (bybitGetStore().activeEnv || 'mainnet') === 'testnet' ? ' (Demo needs key from bybit.com → Demo mode)' : '';
                        showMsg('bybitCredMsg', '✗ ' + res.error + hint, '#f56565');
                    }
                } catch(e) { showMsg('bybitCredMsg', '✗ ' + e.message, '#f56565'); }
                btn.textContent = '🔌 Test Active Account'; btn.disabled = false;
            });
        }
    }

    // Background poller (all pages)
    const creds = bybitGetCreds();
    if (creds.apiKey && creds.apiSecret) {
        setTimeout(() => bytPollPositionsBackground(), 3000);
        setInterval(() => bytPollPositionsBackground(), 10000);
    }

    // Live preview watcher
    ['bytQty','bytTP'].forEach(id => el(id)?.addEventListener('input', bytUpdateSummary));
    ['bytEntry','bytSL'].forEach(id => el(id)?.addEventListener('input', () => {
        if (bytQtyMode === 'cost')        bytCalcFromCost();
        else if (bytQtyMode === 'margin') bytCalcFromMargin();
        else if (bytQtyMode === 'risk')   bytCalcFromRisk();
        else bytUpdateSummary();
    }));
    el('bytLevSlider')?.addEventListener('input', e => bytLevSliderChange(e.target.value));
    el('bytLevInput')?.addEventListener('input',  e => bytLevInputChange(e.target.value));
    el('bytOrderType')?.addEventListener('change', bytUpdateSummary);

    // PnL-based SL/TP inputs
    el('bytSLPnl')?.addEventListener('input', bytCalcSlFromPnl);
    el('bytTPPnl')?.addEventListener('input', bytCalcTpFromPnl);
    // Recalc PnL hints when entry or qty changes
    ['bytEntry','bytQty'].forEach(id => el(id)?.addEventListener('input', () => {
        if (bytSlMode === 'pnl') bytCalcSlFromPnl();
        if (bytTpMode === 'pnl') bytCalcTpFromPnl();
    }));
}

// ── HMAC Signature (pure JS — works on HTTP and in Node.js) ──
function hmacSHA256(secret, message) {
    function sha256bytes(data) {
        const K = [
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
        ];
        let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const len = bytes.length;
        const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
        padded.set(bytes); padded[len] = 0x80;
        const dv = new DataView(padded.buffer);
        dv.setUint32(padded.length - 4, (len * 8) >>> 0, false);
        dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000), false);
        const rotr = (x, n) => (x >>> n) | (x << (32 - n));
        for (let off = 0; off < padded.length; off += 64) {
            const w = new Uint32Array(64);
            for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
            for (let i = 16; i < 64; i++) {
                const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
                const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
                w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
            }
            let [a,b,c,d,e,f,g,hh] = h;
            for (let i = 0; i < 64; i++) {
                const t1 = (hh + (rotr(e,6)^rotr(e,11)^rotr(e,25)) + ((e&f)^(~e&g)) + K[i] + w[i]) >>> 0;
                const t2 = ((rotr(a,2)^rotr(a,13)^rotr(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0;
                hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
            }
            h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
            h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
        }
        const out = new Uint8Array(32);
        h.forEach((v,i) => new DataView(out.buffer).setUint32(i*4, v, false));
        return out;
    }
    function toBytes(s) { return typeof s === 'string' ? new TextEncoder().encode(s) : s; }
    function hexToBytes(hex) {
        const b = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) b[i>>1] = parseInt(hex.slice(i,i+2), 16);
        return b;
    }
    let key = toBytes(secret);
    if (key.length > 64) key = sha256bytes(key);
    const padded = new Uint8Array(64); padded.set(key);
    const ipad = padded.map(b => b ^ 0x36);
    const opad = padded.map(b => b ^ 0x5c);
    const inner = new Uint8Array(64 + toBytes(message).length);
    inner.set(ipad); inner.set(toBytes(message), 64);
    const outer = new Uint8Array(64 + 32);
    outer.set(opad); outer.set(sha256bytes(inner), 64);
    return Array.from(sha256bytes(outer)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Clock sync (fixes timestamp mismatch errors) ─────────────
let bybitClockOffset = 0;
async function bybitSyncClock() {
    try {
        // Always use mainnet for time sync — both envs share same server time
        const res = await fetch('/api/proxy/binance?path=/fapi/v1/time');
        const data = await res.json();
        const serverTs = parseInt(data.serverTime);
        if (serverTs) bybitClockOffset = serverTs - Date.now();
    } catch(_) { bybitClockOffset = 0; }
}

async function bybitRequest(method, path, params = {}, body = null) {
    const creds = bybitGetCreds();
    if (!creds.apiKey || !creds.apiSecret) throw new Error('No API credentials. Set them in Settings → Bybit.');
    const base = creds.env === 'testnet' ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
    const ts = (Date.now() + (bybitClockOffset || 0)).toString();
    const recv = '20000';
    let signStr, url;

    if (method === 'GET') {
        const qs = new URLSearchParams(params).toString();
        signStr = ts + creds.apiKey + recv + qs;
        url = base + path + (qs ? '?' + qs : '');
    } else {
        const bodyStr = JSON.stringify(body || params);
        signStr = ts + creds.apiKey + recv + bodyStr;
        url = base + path;
    }

    const sign = hmacSHA256(creds.apiSecret, signStr);
    const headers = {
        'X-BAPI-API-KEY': creds.apiKey,
        'X-BAPI-SIGN': sign,
        'X-BAPI-TIMESTAMP': ts,
        'X-BAPI-RECV-WINDOW': recv,
        'Content-Type': 'application/json'
    };

    const fetchOpts = { method, headers };
    if (method !== 'GET') fetchOpts.body = JSON.stringify(body || params);
    const resp = await fetch(url, fetchOpts);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}

// ── Terminal open/close ──────────────────────────────────────
function bybitTerminalOpen(sym) {
    el('bybitTerminal').classList.add('open');
    const env = bybitGetStore().activeEnv || 'mainnet';
    el('bytLiveBadge').style.display = 'inline';
    updateTerminalEnvBadge(env);
    if (sym) {
        const fullSym = sym.toUpperCase().replace('/','').replace('USDT','') + 'USDT'; // normalize to SOLUSDT
        const base = fullSym.replace('USDT',''); // display as SOL
        bytSymSelected = fullSym;
        bytLivePrice = 0; // reset until fetch completes
        el('bytSymbol').value = base;
        el('bytSymLabel').textContent = base + '/USDT';
        bytFetchMaxLev(fullSym);
        bytFetchLivePriceForSym(fullSym);
    } else {
        el('bytSymLabel').textContent = '';
    }
    bytUpdateSummary();
    bytSwitchTab('order');
    bytStartRefresh();
    bytFetchBalance();
}

function bybitTerminalClose() {
    clearInterval(bytRefreshTimer);
    if (typeof apRunning !== 'undefined' && apRunning) apStop();
    window.location.href = '/';
}

// Open pre-filled from AI result — navigates to /terminal page
function bybitOpenFromAI(sym, dir, entry, sl, tp, maxLev) {
    const creds = bybitGetCreds();
    if (!creds.apiKey) {
        // Navigate to settings, auto-open Bybit tab
        sessionStorage.setItem('settings_tab', 'bybit');
        window.location.href = '/settings';
        return;
    }
    sessionStorage.setItem('bybit_prefill', JSON.stringify({ sym, dir, entry, sl, tp, maxLev }));
    window.location.href = '/terminal';
}

function toggleVisibility(id, btn) {
    const inp = el(id);
    if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide'; }
    else { inp.type = 'password'; btn.textContent = 'Show'; }
}

// ── Tab switching ────────────────────────────────────────────
function bytSwitchTab(tab) {
    document.querySelectorAll('.byt-tab').forEach(t => t.classList.toggle('active', t.dataset.byttab === tab));
    document.querySelectorAll('.byt-page').forEach(p => p.classList.toggle('active', p.id === 'byt-' + tab));
    if (tab === 'positions') bytLoadPositions();
    if (tab === 'orders')    bytLoadOrders();
    if (tab === 'assets')    bytLoadAssets();
    if (tab === 'autopilot' && typeof apRunning !== 'undefined' && !apRunning) apLoadPositionOptions();
}

function bytStartRefresh() {
    clearInterval(bytRefreshTimer);
    bytRefreshTimer = setInterval(() => {
        const activeTab = document.querySelector('.byt-tab.active')?.dataset?.byttab;
        if (activeTab === 'positions') bytLoadPositions();
        if (activeTab === 'orders')    bytLoadOrders();
        if (activeTab === 'assets')    bytLoadAssets();
    }, 5000);

    // Listen for orders placed from coin-detail page (other tab)
    try {
        if (!window._bytOrderChannel) {
            window._bytOrderChannel = new BroadcastChannel('orders');
            window._bytOrderChannel.onmessage = (e) => {
                if (e.data?.type === 'position:new') {
                    bytSwitchTab('positions');
                    showMsg('bytMsg', `✓ Position opened: ${e.data.symbol || ''}`, '#22c55e');
                    setTimeout(() => bytLoadPositions(), 2000);
                }
            };
        }
    } catch(_) {}
}

// ── Direction ────────────────────────────────────────────────
// ── Symbol search dropdown ────────────────────────────────────
let bytSymSelected = '';
let bytMaxLev = 125;
let bytQtyStep = 0;   // e.g. 0.001 for SOLUSDT
let bytMinQty  = 0;   // minimum order qty
let bytTickSize = 0;  // e.g. 0.01 for SOLUSDT — used to round order/SL/TP prices
let bytSymSearchTimer = null;
let bytLivePrice = 0; // live mark price for the selected symbol (used on terminal page where scanner isn't running)
let bytCategory = 'linear'; // 'linear' (futures) | 'spot'

// ── Switch between Futures and Spot ──────────────────────────
function bytSetCategory(cat) {
    bytCategory = cat;
    const futBtn  = el('bytCatFutures');
    const spotBtn = el('bytCatSpot');
    if (futBtn)  { futBtn.style.background  = cat === 'linear' ? '#f59e0b' : 'none'; futBtn.style.color  = cat === 'linear' ? '#000' : '#6b7897'; }
    if (spotBtn) { spotBtn.style.background = cat === 'spot'   ? '#22c55e' : 'none'; spotBtn.style.color = cat === 'spot'   ? '#000' : '#6b7897'; }
    // Show/hide futures-only fields
    const levField    = el('bytLevField');
    const marginField = el('bytMarginModeField');
    const apModeWrap  = el('bytApModeWrap');
    if (levField)    levField.style.display    = cat === 'spot' ? 'none' : '';
    if (marginField) marginField.style.display = cat === 'spot' ? 'none' : '';
    if (apModeWrap)  apModeWrap.style.display  = cat === 'spot' ? 'none' : '';
    const slTpGrid = el('bytSlTpGrid');
    if (slTpGrid) slTpGrid.style.display = cat === 'spot' ? 'none' : '';
    // Hide autopilot tab in spot mode
    const apTab = el('apTab');
    if (apTab) apTab.style.display = cat === 'spot' ? 'none' : '';
    // If switching to spot and on autopilot tab, go to orders tab
    if (cat === 'spot') {
        const activeTab = document.querySelector('.byt-tab.active');
        if (activeTab && activeTab.dataset.byttab === 'autopilot') bytSwitchTab('order');
        // Also reset autopilot mode to manual since spot doesn't support autopilot
        if (typeof apSetMode === 'function') apSetMode('manual');
    }
    // Keep amount handling in USDT cost mode.
    bytSetQtyMode('cost');
    // Label swap
    const buyBtn = el('bytBuyBtn');
    const selBtn = el('bytSellBtn');
    if (buyBtn) buyBtn.innerHTML = cat === 'spot' ? '▲ BUY' : '▲ LONG';
    if (selBtn) selBtn.innerHTML = cat === 'spot' ? '▼ SELL' : '▼ SHORT';
    // Update place button label
    const btnLabel = el('bytPlaceBtnLabel');
    if (btnLabel) btnLabel.textContent = cat === 'spot'
        ? (bytDirection === 'Buy' ? '▲ Place BUY Order' : '▼ Place SELL Order')
        : (apMode === 'autopilot'
            ? (bytDirection === 'Buy' ? '🤖 Place LONG + Start Auto Mode' : '🤖 Place SHORT + Start Auto Mode')
            : (bytDirection === 'Buy' ? '▲ Place LONG Order' : '▼ Place SHORT Order'));
    // Re-fetch symbol info for the new category
    if (bytSymSelected) bytFetchMaxLev(bytSymSelected);
    bytUpdateSummary();
}

// Fetch the live mark price and store it in bytLivePrice; also updates placeholder/summary
async function bytFetchLivePriceForSym(sym) {
    if (!sym) return;
    try {
        const res     = await fetch(`/api/proxy/binance?path=/fapi/v1/ticker/24hr&symbol=${sym}`);
        const data    = await res.json();
        const px      = parseFloat(data?.lastPrice);
        if (px > 0) {
            bytLivePrice = px;
            // Show as placeholder in entry input so user sees live price for market orders
            const entryEl = el('bytEntry');
            if (entryEl && el('bytOrderType').value === 'Market') {
                entryEl.placeholder = `Market ≈ ${px}`;
            }
            bytUpdateSummary();
        }
    } catch(_) {}
}

function bytSymSearch(val) {
    clearTimeout(bytSymSearchTimer);
    const q = val.toUpperCase().replace('USDT','').trim();
    bytSymSelected = ''; // reset until user picks from dropdown
    const drop = el('bytSymDropdown');
    if (!q) { drop.style.display = 'none'; return; }

    // Filter from scanner's UNIVERSE list
    const matches = UNIVERSE.filter(s => s.replace('USDT','').startsWith(q))
        .concat(UNIVERSE.filter(s => !s.replace('USDT','').startsWith(q) && s.replace('USDT','').includes(q)))
        .slice(0, 25);

    if (!matches.length) { drop.style.display = 'none'; return; }

    drop.innerHTML = matches.map((sym, i) => {
        const base = sym.replace('USDT','');
        const d = indicatorData[sym];
        const priceStr = d ? (d.price >= 1000 ? d.price.toFixed(1) : d.price >= 1 ? d.price.toFixed(3) : d.price.toFixed(5)) : '';
        const rsiStr = d?.rsi ? d.rsi[d.rsi.length-1].toFixed(1) : '';
        return `<div class="byt-sym-item" data-sym="${sym}" data-idx="${i}"
            style="padding:0.45rem 0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-size:12px;border-bottom:1px solid #0f1319"
            onmousedown="bytSelectSym('${sym}')" onmouseover="bytSymHover(${i})">
            <div style="font-weight:700;color:#e5e9f2">${base}<span style="color:#3a4560;font-weight:400">/USDT</span></div>
            <div style="display:flex;gap:0.75rem;font-size:11px">
                ${priceStr ? `<span style="color:#6b7897;font-family:monospace">${priceStr}</span>` : ''}
                ${rsiStr ? `<span style="color:${parseFloat(rsiStr)>=70?'#f56565':parseFloat(rsiStr)<=30?'#48bb78':'#4a5568'}">RSI ${rsiStr}</span>` : ''}
            </div>
        </div>`;
    }).join('');
    drop.style.display = 'block';

    // Fetch max leverage after short delay
    clearTimeout(bytSymSearchTimer);
    bytSymSearchTimer = setTimeout(() => {
        const fullSym = q + 'USDT';
        if (UNIVERSE.includes(fullSym)) bytFetchMaxLev(fullSym);
    }, 600);
}

function bytSymHover(idx) {
    document.querySelectorAll('.byt-sym-item').forEach((el2, i) => {
        el2.style.background = i === idx ? '#1a1f2e' : '';
    });
}

function bytSelectSym(sym) {
    const base = sym.replace('USDT','');
    el('bytSymbol').value = base; // show "SOL" not "SOLUSDT"
    bytSymSelected = sym;
    bytLivePrice = 0; // reset until fetch completes
    el('bytSymDropdown').style.display = 'none';
    bytFetchMaxLev(sym);
    bytFetchLivePriceForSym(sym);
    bytUpdateSummary();
}

function bytSymKeydown(e) {
    const drop = el('bytSymDropdown');
    const items = drop.querySelectorAll('.byt-sym-item');
    if (!items.length) return;
    const active = drop.querySelector('.byt-sym-item[style*="background: rgb(26"]') ||
                   drop.querySelector('.byt-sym-item[style*="background:#1a1f2e"]');
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const idx = active ? (parseInt(active.dataset.idx) + 1) % items.length : 0;
        items.forEach(it => it.style.background = '');
        items[idx].style.background = '#1a1f2e';
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = active ? (parseInt(active.dataset.idx) - 1 + items.length) % items.length : items.length-1;
        items.forEach(it => it.style.background = '');
        items[idx].style.background = '#1a1f2e';
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const highlighted = drop.querySelector('.byt-sym-item[style*="#1a1f2e"]');
        if (highlighted) bytSelectSym(highlighted.dataset.sym);
        else if (items.length) bytSelectSym(items[0].dataset.sym);
    } else if (e.key === 'Escape') {
        drop.style.display = 'none';
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
    if (!e.target.closest('#bytSymbol') && !e.target.closest('#bytSymDropdown')) {
        const d = el('bytSymDropdown');
        if (d) d.style.display = 'none';
    }
});

// Fetch max leverage for a symbol from Bybit — uses PUBLIC endpoint, no auth needed
async function bytFetchMaxLev(sym) {
    el('bytSymInfo').textContent = 'Fetching info…';
    el('bytSymInfo').style.color = '#4a5568';
    try {
        const res = await fetch(`/api/proxy/binance?path=/fapi/v1/exchangeInfo&symbol=${sym}`);
        const data = await res.json();
        const info = data?.symbols?.[0];
        if (!info) { el('bytSymInfo').textContent = ''; return; }

        // Spot doesn't have leverage; clamp to 1
        const lot = (info.filters || []).find(f => f.filterType === 'LOT_SIZE') || {};
        const pf  = (info.filters || []).find(f => f.filterType === 'PRICE_FILTER') || {};
        const maxLev = bytCategory === 'spot' ? 1 : 125;
        const minLev = 1;
        const tickSize = pf.tickSize || '';
        const minQty  = lot.minQty || '0';
        const qtyStep = lot.stepSize || '0.001';
        bytMaxLev  = maxLev;
        bytQtyStep = parseFloat(qtyStep) || 0.001;
        bytMinQty  = parseFloat(minQty)  || 0;
        bytTickSize = parseFloat(tickSize) || 0;
        // Cache per symbol so AI result can use it
        if (!window.bytMaxLevCache) window.bytMaxLevCache = {};
        window.bytMaxLevCache[sym] = maxLev;

        // Update both slider and number input bounds
        const slider = el('bytLevSlider');
        const input  = el('bytLevInput');
        slider.max = maxLev; slider.min = minLev;
        input.max  = maxLev; input.min  = minLev;

        // Clamp current value to new max
        const curLev = Math.max(minLev, Math.min(parseInt(input.value) || 10, maxLev));
        slider.value = curLev;
        input.value  = curLev;

        el('bytMaxLevLabel').textContent = bytCategory === 'spot' ? 'Spot Trading' : `Max: ${maxLev}x`;
        el('bytSymInfo').innerHTML = `<span style="color:#4a5568">Min qty: <strong style="color:#6b7897">${minQty}</strong> · Step: <strong style="color:#6b7897">${qtyStep}</strong> · Tick: <strong style="color:#6b7897">${tickSize}</strong></span>`;
        bytUpdateSummary();
    } catch(e) {
        el('bytSymInfo').textContent = 'Could not fetch info';
    }
}

// Leverage slider → update number input
function bytLevSliderChange(val) {
    el('bytLevInput').value = val;
    if (bytQtyMode === 'margin') bytCalcFromMargin();
    else bytUpdateSummary();
}

// Number input → update slider (clamp to max)
function bytLevInputChange(val) {
    let v = parseInt(val) || 1;
    v = Math.max(1, Math.min(v, bytMaxLev));
    el('bytLevSlider').value = v;
    if (parseInt(val) !== v) el('bytLevInput').value = v;
    if (bytQtyMode === 'margin') bytCalcFromMargin();
    else bytUpdateSummary();
}

// ── SL / TP mode toggle (Price ↔ PnL$) ──────────────────────
function bytSetSlMode(mode) {
    bytSlMode = mode;
    const isPrice = mode === 'price';
    el('bytSLModePrice').style.background = isPrice ? '#7f1d1d' : 'transparent';
    el('bytSLModePrice').style.color      = isPrice ? '#fca5a5' : '#6b7897';
    el('bytSLModePnl').style.background   = !isPrice ? '#7f1d1d' : 'transparent';
    el('bytSLModePnl').style.color        = !isPrice ? '#fca5a5' : '#6b7897';
    el('bytSL').style.display             = isPrice ? '' : 'none';
    el('bytSLPnl').style.display          = !isPrice ? '' : 'none';
    el('bytSLPnlHint').textContent        = '';
    if (!isPrice) { el('bytSLPnl').focus(); bytCalcSlFromPnl(); }
    else bytUpdateSummary();
}

function bytSetTpMode(mode) {
    bytTpMode = mode;
    const isPrice = mode === 'price';
    el('bytTPModePrice').style.background = isPrice ? '#14532d' : 'transparent';
    el('bytTPModePrice').style.color      = isPrice ? '#86efac' : '#6b7897';
    el('bytTPModePnl').style.background   = !isPrice ? '#14532d' : 'transparent';
    el('bytTPModePnl').style.color        = !isPrice ? '#86efac' : '#6b7897';
    el('bytTP').style.display             = isPrice ? '' : 'none';
    el('bytTPPnl').style.display          = !isPrice ? '' : 'none';
    el('bytTPPnlHint').textContent        = '';
    if (!isPrice) { el('bytTPPnl').focus(); bytCalcTpFromPnl(); }
    else bytUpdateSummary();
}

// Convert PnL$ → price then write into the hidden price field
function bytCalcSlFromPnl() {
    const pnlInput = parseFloat(el('bytSLPnl').value);
    const hint     = el('bytSLPnlHint');
    if (isNaN(pnlInput)) { hint.textContent = ''; el('bytSL').value = ''; bytUpdateSummary(); return; }

    const qty   = parseFloat(el('bytQty').value) || 0;
    const entry = bytGetEffectiveEntry();
    if (!qty || !entry) { hint.textContent = 'Enter entry & qty first'; return; }

    const isLong = bytDirection === 'Buy';
    // SL is always a loss — force negative PnL amount
    // LONG SL: price goes DOWN by loss/qty from entry  →  below entry ✓
    // SHORT SL: price goes UP by loss/qty from entry   →  above entry ✓
    const slPriceFinal = isLong
        ? entry - Math.abs(pnlInput) / qty   // below entry ✓
        : entry + Math.abs(pnlInput) / qty;  // above entry ✓

    if (slPriceFinal <= 0) { hint.textContent = 'Loss too large for this qty'; return; }

    const dp = entry >= 1000 ? 2 : entry >= 1 ? 4 : 6;
    el('bytSL').value = slPriceFinal.toFixed(dp);
    hint.textContent  = `→ SL price: ${slPriceFinal.toFixed(dp)} (${isLong ? 'below' : 'above'} entry)`;
    bytUpdateSummary();
}

function bytCalcTpFromPnl() {
    const pnlInput = parseFloat(el('bytTPPnl').value);
    const hint     = el('bytTPPnlHint');
    if (isNaN(pnlInput)) { hint.textContent = ''; el('bytTP').value = ''; bytUpdateSummary(); return; }

    const qty   = parseFloat(el('bytQty').value) || 0;
    const entry = bytGetEffectiveEntry();
    if (!qty || !entry) { hint.textContent = 'Enter entry & qty first'; return; }

    const isLong = bytDirection === 'Buy';
    // TP is always profit — force positive PnL amount
    // LONG TP:  price goes UP   →  tpPrice = entry + profit/qty  (above entry ✓)
    // SHORT TP: price goes DOWN →  tpPrice = entry - profit/qty  (below entry ✓)
    const tpPrice = isLong
        ? entry + Math.abs(pnlInput) / qty   // above entry ✓
        : entry - Math.abs(pnlInput) / qty;  // below entry ✓

    if (tpPrice <= 0) { hint.textContent = 'Value too large for this qty'; return; }

    const dp = entry >= 1000 ? 2 : entry >= 1 ? 4 : 6;
    el('bytTP').value = tpPrice.toFixed(dp);
    hint.textContent  = `→ TP price: ${tpPrice.toFixed(dp)} (${isLong ? 'above' : 'below'} entry)`;
    bytUpdateSummary();
}


function bytSetDir(dir) {
    bytDirection = dir;
    el('bytBuyBtn').classList.toggle('active', dir === 'Buy');
    el('bytSellBtn').classList.toggle('active', dir === 'Sell');
    const btn = el('bytPlaceBtn');
    const isAuto = (typeof apMode !== 'undefined' && apMode === 'autopilot');
    const isSpot = bytCategory === 'spot';
    if (dir === 'Buy') {
        btn.classList.remove('short-mode');
        el('bytPlaceBtnLabel').textContent = isSpot ? '▲ Place BUY Order' : (isAuto ? '🤖 Place LONG + Start Auto Mode' : '▲ Place LONG Order');
    } else {
        btn.classList.add('short-mode');
        el('bytPlaceBtnLabel').textContent = isSpot ? '▼ Place SELL Order' : (isAuto ? '🤖 Place SHORT + Start Auto Mode' : '▼ Place SHORT Order');
    }
    if (bytSlMode === 'pnl') bytCalcSlFromPnl();
    if (bytTpMode === 'pnl') bytCalcTpFromPnl();
    bytUpdateSummary();
}

function bytOrderTypeChange() {
    const isMarket = el('bytOrderType').value === 'Market';
    el('bytEntryField').style.display = isMarket ? 'none' : '';
    if (isMarket && bytSymSelected) bytFetchLivePriceForSym(bytSymSelected);
    else bytUpdateSummary();
}

// ── Qty Mode ─────────────────────────────────────────────────
let bytQtyMode = 'cost';

function bytSetQtyMode(mode) {
    // Terminal amount input is USDT cost only.
    bytQtyMode = 'cost';
    const costRow = el('bytQtyRow_cost');
    if (costRow) costRow.style.display = '';
    bytUpdateSummary();
}

// Get entry price — uses typed entry, or live market price for Market orders
function bytGetEffectiveEntry() {
    const typed = parseFloat(el('bytEntry').value);
    if (typed > 0) return typed;
    // Market order — try live price cache first (for terminal page), then scanner data
    if (bytLivePrice > 0) return bytLivePrice;
    const sym = bytSymSelected || '';
    const d = indicatorData[sym];
    if (d?.price) return d.price;
    return 0;
}

// Cost → Qty:  qty = cost / entry
function bytCalcFromCost() {
    const cost  = parseFloat(el('bytQtyCost').value);
    const entry = bytGetEffectiveEntry();
    if (cost > 0 && entry > 0) {
        const rawQty = cost / entry;
        const step = bytQtyStep > 0 ? bytQtyStep : 0.001;
        const dec  = (step.toString().split('.')[1] || '').length;
        const rounded = parseFloat((Math.floor(rawQty / step) * step).toFixed(dec));
        el('bytQty').value = rounded;
        const lev_ = parseInt(el('bytLevInput').value) || 10;
        el('bytQtyHint').textContent = bytCategory === 'spot'
            ? `${rounded} coins · costs $${cost.toFixed(2)}`
            : `${rounded} contracts · ≈ ${(cost / lev_).toFixed(2)} USDT margin`;
    } else {
        el('bytQty').value = '';
        el('bytQtyHint').textContent = cost > 0 ? '⚠ Select a coin first to get live price' : '';
    }
    bytUpdateSummary();
}

// Margin → Qty:  qty = (margin × leverage) / entry
function bytCalcFromMargin() {
    const margin = parseFloat(el('bytQtyMargin').value);
    const entry  = bytGetEffectiveEntry();
    const lev    = Math.max(1, parseInt(el('bytLevInput').value) || 10);
    if (margin > 0 && entry > 0) {
        const cost   = margin * lev;
        const rawQty = cost / entry;
        const step = bytQtyStep > 0 ? bytQtyStep : 0.001;
        const dec  = (step.toString().split('.')[1] || '').length;
        const rounded = parseFloat((Math.floor(rawQty / step) * step).toFixed(dec));
        el('bytQty').value = rounded;
        el('bytQtyHint').textContent = `${rounded} contracts · ≈ ${cost.toFixed(2)} USDT position`;
    } else {
        el('bytQty').value = '';
        el('bytQtyHint').textContent = margin > 0 ? '⚠ Select a coin first to get live price' : '';
    }
    bytUpdateSummary();
}

// Risk % → Qty:  qty = (capital × risk%) / |entry - sl|
function bytCalcFromRisk() {
    const riskPct = parseFloat(el('bytQtyRiskSlider').value) || 1;
    const entry   = bytGetEffectiveEntry();
    const sl      = parseFloat(el('bytSL').value);
    const posS    = posGetSettings();
    const capital = parseFloat(posS.capital) || 0;

    if (!capital) {
        el('bytQtyRiskNote').textContent = '⚠ Set capital in Settings → Position first';
        el('bytQty').value = '';
        bytUpdateSummary(); return;
    }
    if (!entry) {
        el('bytQtyRiskNote').textContent = '⚠ Select a coin first to get live price';
        el('bytQty').value = '';
        bytUpdateSummary(); return;
    }
    if (!sl) {
        el('bytQtyRiskNote').textContent = 'Enter SL price first';
        el('bytQty').value = '';
        bytUpdateSummary(); return;
    }
    const slDist = Math.abs(entry - sl);
    if (slDist <= 0) {
        el('bytQtyRiskNote').textContent = 'SL must differ from entry';
        el('bytQty').value = '';
        bytUpdateSummary(); return;
    }
    const riskAmt = capital * (riskPct / 100);
    const rawQty  = riskAmt / slDist;
    const step = bytQtyStep > 0 ? bytQtyStep : 0.001;
    const dec  = (step.toString().split('.')[1] || '').length;
    const rounded = parseFloat((Math.floor(rawQty / step) * step).toFixed(dec));
    el('bytQty').value = rounded;
    el('bytQtyRiskNote').textContent = `${rounded} contracts · Risk $${riskAmt.toFixed(2)} of $${capital.toLocaleString()}`;
    bytUpdateSummary();
}

// ── Live summary ─────────────────────────────────────────────
function bytUpdateSummary() {
    const rawInput = el('bytSymbol').value.trim().toUpperCase();
    const sym = bytSymSelected || (rawInput.endsWith('USDT') ? rawInput : rawInput ? rawInput + 'USDT' : '—');
    const entry  = bytGetEffectiveEntry();
    const qty    = parseFloat(el('bytQty').value);
    const sl     = parseFloat(el('bytSL').value);
    const tp     = parseFloat(el('bytTP').value);
    const lev    = Math.max(1, parseInt(el('bytLevInput').value) || 10);
    const isMarket = el('bytOrderType').value === 'Market';
    const dir    = bytDirection;

    const posVal = (qty && entry) ? qty * entry : null;
    const margin = posVal ? posVal / lev : null;
    const slDist = (entry && sl) ? Math.abs(entry - sl) : null;
    const maxLoss = (slDist && qty) ? slDist * qty : null;
    const tpDist = (entry && tp) ? Math.abs(tp - entry) : null;
    const profit = (tpDist && qty) ? tpDist * qty : null;
    const rr = (maxLoss && profit) ? '1 : ' + (profit / maxLoss).toFixed(2) : '—';

    const f2 = v => v != null ? '$' + v.toFixed(2) : '—';
    const fp = v => v != null ? (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2) : '—';

    // Summary panel may be absent on standalone terminal page — guard all writes
    const _bs = id => el(id);
    function _bst(id, val) { const e = _bs(id); if (e) e.textContent = val; }
    function _bss(id, prop, val) { const e = _bs(id); if (e) e.style[prop] = val; }

    _bst('bsSymbol', sym);
    _bst('bsDir', bytCategory === 'spot'
        ? (dir === 'Buy' ? '▲ BUY'  : '▼ SELL')
        : (dir === 'Buy' ? '▲ LONG' : '▼ SHORT'));
    _bss('bsDir', 'color', dir === 'Buy' ? '#4ade80' : '#f87171');
    _bst('bsEntry',   isMarket ? (entry ? `Market ≈ ${entry}` : 'Market') : (entry ? entry : '—'));
    _bst('bsQty',     qty || '—');
    _bst('bsLev',     bytCategory === 'spot' ? '—' : lev + 'x');
    _bst('bsPosVal',  f2(posVal));
    _bst('bsMargin',  bytCategory === 'spot' ? f2(posVal) : f2(margin));
    _bst('bsSL',      sl || '—');
    _bst('bsTP',      tp || '—');
    _bst('bsMaxLoss', maxLoss ? '-$' + maxLoss.toFixed(2) : '—');
    _bst('bsProfit',  profit ? '+$' + profit.toFixed(2) : '—');
    _bst('bsRR',      rr);

    el('bytQtyHint').textContent = posVal
        ? bytCategory === 'spot'
            ? `≈ $${posVal.toFixed(2)} total cost`
            : `≈ $${posVal.toFixed(2)} position · $${margin ? margin.toFixed(2) : '—'} margin`
        : '';
}

// ── Place Order ──────────────────────────────────────────────
async function bytPlaceOrder() {
    // Use selected sym from dropdown, or append USDT to whatever was typed
    const rawInput = el('bytSymbol').value.trim().toUpperCase();
    const sym = bytSymSelected || (rawInput.endsWith('USDT') ? rawInput : rawInput + 'USDT');

    // Recalculate qty from active mode before reading it
    if (bytQtyMode === 'cost')   bytCalcFromCost();
    else if (bytQtyMode === 'margin') bytCalcFromMargin();
    else if (bytQtyMode === 'risk')   bytCalcFromRisk();

    const entry  = parseFloat(el('bytEntry').value);
    const qty    = parseFloat(el('bytQty').value);
    const lev    = Math.max(1, Math.min(parseInt(el('bytLevInput').value) || 10, bytMaxLev));
    const side   = bytDirection;
    const type   = el('bytOrderType').value;
    const marginMode = el('bytMarginMode').value;

    if (!sym) return showMsg('bytOrderMsg', '✗ Enter a symbol', '#f56565');
    if (!qty || qty <= 0) {
        const modeHints = { cost: 'Enter amount in USDT cost', margin: 'Enter amount in USDT cost', risk: 'Enter amount in USDT cost', qty: 'Enter amount in USDT cost' };
        return showMsg('bytOrderMsg', '✗ ' + (modeHints[bytQtyMode] || 'Enter quantity'), '#f56565');
    }
    if (type === 'Limit' && (!entry || entry <= 0)) return showMsg('bytOrderMsg', '✗ Enter entry price', '#f56565');

    // For Market orders with PnL-mode TP/SL: fetch live price and recalculate
    // so the actual SL/TP prices reflect the real fill price, not the stale estimate
    if (type === 'Market' && (bytSlMode === 'pnl' || bytTpMode === 'pnl')) {
        const livePx = await apFetchMarkPrice(sym);
        if (livePx && livePx > 0) {
            const qty_ = parseFloat(el('bytQty').value) || 0;
            const isLong = bytDirection === 'Buy';
            const dp = livePx >= 1000 ? 2 : livePx >= 1 ? 4 : 6;
            if (bytSlMode === 'pnl') {
                const pnlInput = parseFloat(el('bytSLPnl').value);
                if (!isNaN(pnlInput) && qty_ > 0) {
                    const slPrice = isLong
                        ? livePx - Math.abs(pnlInput) / qty_
                        : livePx + Math.abs(pnlInput) / qty_;
                    if (slPrice > 0) {
                        el('bytSL').value = slPrice.toFixed(dp);
                        el('bytSLPnlHint').textContent = `→ SL recalculated at live price: ${slPrice.toFixed(dp)}`;
                    }
                }
            }
            if (bytTpMode === 'pnl') {
                const pnlInput = parseFloat(el('bytTPPnl').value);
                if (!isNaN(pnlInput) && qty_ > 0) {
                    const tpPrice = isLong
                        ? livePx + Math.abs(pnlInput) / qty_
                        : livePx - Math.abs(pnlInput) / qty_;
                    if (tpPrice > 0) {
                        el('bytTP').value = tpPrice.toFixed(dp);
                        el('bytTPPnlHint').textContent = `→ TP recalculated at live price: ${tpPrice.toFixed(dp)}`;
                    }
                }
            }
            showMsg('bytOrderMsg', `↻ TP/SL updated to live price ${livePx.toFixed(livePx >= 1000 ? 2 : 4)}`, '#63b3ed');
        }
    }

    // Read SL/TP after any recalculation above
    const sl     = parseFloat(el('bytSL').value);
    const tp     = parseFloat(el('bytTP').value);

    const btn = el('bytPlaceBtn');
    btn.disabled = true; el('bytPlaceBtnLabel').textContent = 'Placing…';

    try {
        await bybitSyncClock();
        // 1. Set leverage (futures only)
        if (bytCategory === 'linear') {
            await bybitRequest('POST', '/v5/position/set-leverage', null, {
                category: 'linear', symbol: sym,
                buyLeverage: lev.toString(), sellLeverage: lev.toString()
            });
            // 2. Set margin mode (futures only)
            try {
                await bybitRequest('POST', '/v5/position/switch-isolated', null, {
                    category: 'linear', symbol: sym,
                    tradeMode: marginMode === 'ISOLATED' ? 1 : 0,
                    buyLeverage: lev.toString(), sellLeverage: lev.toString()
                });
            } catch(_) {} // may fail if already set, that's fine
        }

        // 3. Place order — round qty and price to instrument filters
        function bytRoundQtyStr(raw) {
            const step = bytQtyStep > 0 ? bytQtyStep : 0.001;
            const dec  = (step.toString().split('.')[1] || '').length;
            const steps = Math.floor(parseFloat((raw / step).toFixed(8)));
            return (steps * step).toFixed(dec);
        }
        function bytRoundPriceStr(p) {
            if (!p || bytTickSize <= 0) return p.toString();
            const dec = (bytTickSize.toString().split('.')[1] || '').length;
            return (Math.round(p / bytTickSize) * bytTickSize).toFixed(dec);
        }
        const qtyStr   = bytRoundQtyStr(qty);
        const finalQty = parseFloat(qtyStr);
        if (!finalQty || finalQty < bytMinQty) {
            const hint = bytMinQty > 0 ? ` (min: ${bytMinQty})` : '';
            return showMsg('bytOrderMsg', `✗ Qty too small after rounding${hint}`, '#f56565');
        }

        const orderBody = {
            category: bytCategory,
            symbol: sym,
            side,
            orderType: type,
            qty: qtyStr,
            timeInForce: type === 'Market' ? 'IOC' : 'GTC',
        };
        if (bytCategory === 'spot' && type === 'Market' && side === 'Buy') {
            orderBody.marketUnit = 'baseCoin';
        }
        if (type === 'Limit') orderBody.price = bytRoundPriceStr(entry);
        // SL/TP not supported for spot orders
        if (bytCategory !== 'spot') {
            if (sl && parseFloat(sl) > 0) { orderBody.stopLoss = bytRoundPriceStr(sl); orderBody.slTriggerBy = 'MarkPrice'; }
            if (tp && parseFloat(tp) > 0) { orderBody.takeProfit = bytRoundPriceStr(tp); orderBody.tpTriggerBy = 'MarkPrice'; }
        }

        console.log('[bytPlaceOrder] payload:', JSON.stringify(orderBody));
        const res = await bybitRequest('POST', '/v5/order/create', null, orderBody);
        if (res.retCode === 0) {
            const ordId = res.result?.orderId?.slice(0,8) || '?';
            const spotNote = (bytCategory === 'spot' && type === 'Market') ? ' (check Order History on Bybit)' : '';
            showMsg('bytOrderMsg', `✓ Order placed! ID: ${ordId}…${spotNote}`, '#48bb78');
            // Fire Discord order notification (fire-and-forget via server)
            fetch('/api/discord/notify/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym, side, orderType: type, price: type === 'Limit' ? entry : null, qty: finalQty, sl, tp }) }).catch(() => {});

            // ── Auto-start autopilot if that mode was selected ──
            if (apMode === 'autopilot' && sl && tp) {
                let effectiveEntry = (type === 'Limit' && entry > 0) ? entry : 0;
                if (!effectiveEntry) effectiveEntry = await apFetchMarkPrice(sym) || 0;
                if (effectiveEntry > 0) {
                    try {
                        const apr = await fetch('/api/autopilot/start', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sym, entry: effectiveEntry, sl, tp, side, size: finalQty })
                        });
                        const apData = await apr.json();
                        if (!apData.error) {
                            apRunning   = true;
                            apPosition  = { sym, entry: effectiveEntry, sl, initSl: sl, tp, side, size: finalQty, isLong: side === 'Buy', lev };
                            apTriggered = { tp40: false, tp50: false, sl60: false };
                            el('apTab').style.display = '';
                            apShowMonitor(null);
                            apStartPolling();
                            apLog(`Autopilot started for ${sym} ${side === 'Buy' ? 'LONG' : 'SHORT'}`, 'ok');
                            showMsg('bytOrderMsg', `✓ Order placed + Autopilot running for ${sym}`, '#a855f7');
                            setTimeout(() => bytSwitchTab('autopilot'), 1800);
                        } else {
                            apLog(`Autopilot failed to start: ${apData.error}`, 'warn');
                            setTimeout(() => bytSwitchTab('orders'), 1500);
                        }
                    } catch(_) { setTimeout(() => bytSwitchTab('orders'), 1500); }
                } else {
                    apLog('Could not determine entry price for autopilot', 'warn');
                    setTimeout(() => bytSwitchTab('orders'), 1500);
                }
            } else {
                setTimeout(() => bytSwitchTab('orders'), 1500);
            }
        } else {
            showMsg('bytOrderMsg', `✗ ${res.retMsg}`, '#f56565');
        }
    } catch(e) {
        showMsg('bytOrderMsg', `✗ ${e.message}`, '#f56565');
    }
    btn.disabled = false;
    bytSetDir(side); // restore button label
}

// ── Load Positions / Spot Holdings ───────────────────────────
async function bytLoadPositions() {
    const list = el('bytPositionsList');
    try {
        // Positions tab always shows futures positions only
        const res = await bybitRequest('GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
        if (res.retCode !== 0) { list.innerHTML = `<div class="byt-empty" style="color:#f56565">Error: ${res.retMsg}</div>`; return; }
        const pos = (res.result?.list || []).filter(p => parseFloat(p.size) > 0);
        el('bytPosCount').textContent = pos.length;
        el('bytLiveBadge').style.display = 'inline';
        // Update header button badge
        const hdr = el('bytHeaderPosCount');
        const btn = el('bybitTerminalBtn');
        if (pos.length > 0) {
            if (hdr) { hdr.textContent = pos.length; hdr.style.display = 'inline'; }
            if (btn) { btn.classList.add('has-positions'); btn.title = `Bybit Terminal — ${pos.length} open position${pos.length>1?'s':''}`; }
        } else {
            if (hdr) hdr.style.display = 'none';
            if (btn) { btn.classList.remove('has-positions'); btn.title = 'Bybit Trading Terminal'; }
        }
        if (pos.length === 0) { list.innerHTML = '<div class="byt-empty">No open positions</div>'; return; }
        list.innerHTML = pos.map(p => {
            const pnl = parseFloat(p.unrealisedPnl);
            const size = parseFloat(p.size);
            const avgPrice = parseFloat(p.avgPrice);
            const posVal = (parseFloat(p.positionValue) > 0 ? parseFloat(p.positionValue) : size * avgPrice);
            const margin = (parseFloat(p.positionIM) > 0 ? parseFloat(p.positionIM) : posVal / parseFloat(p.leverage));
            const pnlPct = margin > 0 ? (pnl / margin * 100) : 0;
            const isLong = p.side === 'Buy';
            const pnlClass = pnl >= 0 ? 'profit' : 'loss';
            return `
            <div class="byt-pos-card ${isLong ? 'long-pos' : 'short-pos'}">
                <div class="byt-pos-header">
                    <div style="display:flex;align-items:center;gap:0.5rem">
                        <span class="byt-pos-sym">${p.symbol}</span>
                        <span class="byt-pos-side ${isLong ? 'long' : 'short'}">${isLong ? '▲ LONG' : '▼ SHORT'}</span>
                        <span style="font-size:11px;color:#6b7897">${p.leverage}x</span>
                    </div>
                    <div class="byt-pos-val ${pnlClass}" style="font-size:14px">
                        ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}
                        <span style="font-size:10px;opacity:0.75">(${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)</span>
                    </div>
                </div>
                <div class="byt-pos-grid">
                    <div class="byt-pos-item">
                        <div class="byt-pos-label">Cost (USDT)</div>
                        <div class="byt-pos-val">$${posVal.toFixed(2)}</div>
                        <div style="font-size:10px;color:#4a5568;margin-top:1px">${size} contracts</div>
                    </div>
                    <div class="byt-pos-item">
                        <div class="byt-pos-label">Margin Used</div>
                        <div class="byt-pos-val">$${margin.toFixed(2)}</div>
                        <div style="font-size:10px;color:#4a5568;margin-top:1px">${p.leverage}x leverage</div>
                    </div>
                    <div class="byt-pos-item"><div class="byt-pos-label">Avg Entry</div><div class="byt-pos-val">${parseFloat(p.avgPrice).toFixed(4)}</div></div>
                    <div class="byt-pos-item"><div class="byt-pos-label">Mark Price</div><div class="byt-pos-val">${parseFloat(p.markPrice).toFixed(4)}</div></div>
                    <div class="byt-pos-item"><div class="byt-pos-label">Stop Loss</div><div class="byt-pos-val" style="color:#f87171">${parseFloat(p.stopLoss) > 0 ? parseFloat(p.stopLoss).toFixed(4) : '—'}</div></div>
                    <div class="byt-pos-item"><div class="byt-pos-label">Take Profit</div><div class="byt-pos-val" style="color:#4ade80">${parseFloat(p.takeProfit) > 0 ? parseFloat(p.takeProfit).toFixed(4) : '—'}</div></div>
                    <div class="byt-pos-item"><div class="byt-pos-label">Liq. Price</div><div class="byt-pos-val" style="color:#f59e0b">${parseFloat(p.liqPrice) > 0 ? parseFloat(p.liqPrice).toFixed(4) : '—'}</div></div>
                </div>
                <div class="byt-pos-actions">
                    <button class="byt-act-btn modify" onclick="bytOpenModify('${p.symbol}','${p.side}','${p.stopLoss}','${p.takeProfit}')">✏️ Modify SL/TP</button>
                    <button class="byt-act-btn autopilot-btn" onclick="bytSwitchToAutopilot('${p.symbol}','${p.side}',${parseFloat(p.avgPrice)},${parseFloat(p.stopLoss)},${parseFloat(p.takeProfit)},${parseFloat(p.size)},this)">🤖 Autopilot</button>
                    <button class="byt-act-btn close-half" onclick="bytClosePosition('${p.symbol}','${p.side}',${parseFloat(p.size)/2},'half')">Close 50%</button>
                    <button class="byt-act-btn close-all" onclick="bytClosePosition('${p.symbol}','${p.side}',${parseFloat(p.size)},'all')">Close All</button>
                </div>
            </div>`;
        }).join('');
    } catch(e) { list.innerHTML = `<div class="byt-empty" style="color:#f56565">✗ ${e.message}</div>`; }
}

// ── Load Spot Assets (Assets tab) ─────────────────────────────
async function bytLoadAssets() {
    const list = el('bytAssetsList');
    if (!list) return;
    list.innerHTML = '<div class="byt-empty">Loading…</div>';
    try {
        // Try UNIFIED first, fallback to SPOT
        let res = await bybitRequest('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
        if (res.retCode !== 0 || !(res.result?.list?.[0]?.coin?.length)) {
            res = await bybitRequest('GET', '/v5/account/wallet-balance', { accountType: 'SPOT' });
        }
        if (res.retCode !== 0) {
            list.innerHTML = `<div class="byt-empty" style="color:#f56565">Error: ${res.retMsg}</div>`;
            return;
        }
        const coins = (res.result?.list?.[0]?.coin || []).filter(c =>
            parseFloat(c.walletBalance) > 0 && parseFloat(c.usdValue) > 0
        );
        if (!coins.length) { list.innerHTML = '<div class="byt-empty">No assets found</div>'; return; }
        const totalUSD = coins.reduce((s, c) => s + parseFloat(c.usdValue || 0), 0);
        list.innerHTML = `
        <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="color:#6b7897;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #1c2435">
                        <th style="text-align:left;padding:0.4rem 0.5rem">Asset</th>
                        <th style="text-align:right;padding:0.4rem 0.5rem">Wallet Balance</th>
                        <th style="text-align:right;padding:0.4rem 0.5rem">Available</th>
                        <th style="text-align:right;padding:0.4rem 0.5rem">USD Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${coins.map(c => {
                        const total = parseFloat(c.walletBalance || 0);
                        const avail = parseFloat(c.availableToWithdraw || c.availableToBorrow || c.free || 0);
                        const usd   = parseFloat(c.usdValue || 0);
                        return `<tr style="border-bottom:1px solid #111827">
                            <td style="padding:0.5rem;font-weight:700;color:#e5e9f2">${c.coin}</td>
                            <td style="padding:0.5rem;text-align:right;font-family:'JetBrains Mono',monospace">${total.toFixed(6)}</td>
                            <td style="padding:0.5rem;text-align:right;font-family:'JetBrains Mono',monospace;color:#4ade80">${avail.toFixed(6)}</td>
                            <td style="padding:0.5rem;text-align:right;font-family:'JetBrains Mono',monospace;color:#63b3ed">$${usd.toFixed(2)}</td>
                        </tr>`;
                    }).join('')}
                    <tr style="border-top:1px solid #1c2435;font-weight:700">
                        <td style="padding:0.5rem;color:#6b7897" colspan="3">Total</td>
                        <td style="padding:0.5rem;text-align:right;font-family:'JetBrains Mono',monospace;color:#00e5a0">$${totalUSD.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>
        </div>`;
    } catch(e) { list.innerHTML = `<div class="byt-empty" style="color:#f56565">✗ ${e.message}</div>`; }
}
async function bytLoadOrders() {
    const list = el('bytOrdersList');
    try {
        const params = bytCategory === 'spot'
            ? { category: 'spot' }
            : { category: 'linear', settleCoin: 'USDT' };
        const res = await bybitRequest('GET', '/v5/order/realtime', params);
        if (res.retCode !== 0) { list.innerHTML = `<div class="byt-empty" style="color:#f56565">Error: ${res.retMsg}</div>`; return; }
        const orders = res.result?.list || [];
        el('bytOrdCount').textContent = orders.length;
        if (orders.length === 0) { list.innerHTML = '<div class="byt-empty">No open orders</div>'; return; }
        list.innerHTML = orders.map(o => {
            const isLong = o.side === 'Buy';
            const sideColor = isLong ? '#4ade80' : '#f87171';
            return `
            <div class="byt-ord-card">
                <div class="byt-ord-info">
                    <div style="display:flex;align-items:center;gap:0.5rem">
                        <span class="byt-ord-sym">${o.symbol}</span>
                        <span style="font-size:11px;font-weight:700;color:${sideColor}">${isLong ? '▲ LONG' : '▼ SHORT'}</span>
                        <span style="font-size:10px;color:#6b7897">${o.orderType}</span>
                    </div>
                    <div class="byt-ord-detail">
                        Price: ${parseFloat(o.price) > 0 ? o.price : 'Market'}  ·  Qty: ${o.qty}
                        ${parseFloat(o.stopLoss) > 0 ? `  ·  SL: <span style="color:#f87171">${o.stopLoss}</span>` : ''}
                        ${parseFloat(o.takeProfit) > 0 ? `  ·  TP: <span style="color:#4ade80">${o.takeProfit}</span>` : ''}
                    </div>
                    <div style="font-size:10px;color:#374151">${o.orderStatus} · ${new Date(parseInt(o.createdTime)).toLocaleTimeString()}</div>
                </div>
                <div class="byt-ord-actions">
                    <button class="byt-act-btn modify" onclick="bytOpenModifyOrder('${o.orderId}','${o.symbol}','${o.price}','${o.qty}','${o.stopLoss}','${o.takeProfit}')">✏️ Edit</button>
                    <button class="byt-act-btn close-all" onclick="bytCancelOrder('${o.orderId}','${o.symbol}')">✗ Cancel</button>
                </div>
            </div>`;
        }).join('');
    } catch(e) { list.innerHTML = `<div class="byt-empty" style="color:#f56565">✗ ${e.message}</div>`; }
}

// ── Fetch Balance ─────────────────────────────────────────────
async function bytFetchBalance() {
    try {
        const res = await bybitRequest('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
        if (res.retCode !== 0) return;
        const acct = res.result?.list?.[0];
        if (!acct) return;
        const equity  = parseFloat(acct.totalEquity      || 0);
        const avail   = parseFloat(acct.totalAvailableBalance || acct.availableBalance || 0);
        const margin  = parseFloat(acct.totalInitialMargin || 0);
        const upnl    = parseFloat(acct.totalPerpUPL      || acct.totalUnrealisedPnl || 0);
        const fmt = v => '$' + Math.abs(v).toFixed(2);
        el('bytBalEquity').textContent  = fmt(equity);
        el('bytBalAvail').textContent   = fmt(avail);
        el('bytBalMargin').textContent  = fmt(margin);
        const upnlEl = el('bytBalUPnl');
        upnlEl.textContent  = (upnl >= 0 ? '+' : '-') + fmt(upnl);
        upnlEl.style.color  = upnl >= 0 ? '#22c55e' : '#ef4444';
    } catch(e) { console.warn('Balance fetch failed:', e.message); }
}

// ── History sub-tab switch ────────────────────────────────────
// ── Close Position ───────────────────────────────────────────
async function bytClosePosition(sym, side, qty, label) {
    if (!confirm(`Close ${label === 'all' ? 'entire' : '50% of'} ${sym} position?`)) return;
    try {
        const closeSide = side === 'Buy' ? 'Sell' : 'Buy';
        const res = await bybitRequest('POST', '/v5/order/create', null, {
            category: bytCategory, symbol: sym, side: closeSide,
            orderType: 'Market', qty: qty.toString(),
            timeInForce: 'GTC', reduceOnly: true
        });
        if (res.retCode === 0) {
            showToast('✓ Close order placed');
            setTimeout(bytLoadPositions, 1500);
            setTimeout(bytFetchBalance,  2500);
        }
        else showToast('✗ ' + res.retMsg, true);
    } catch(e) { showToast('✗ ' + e.message, true); }
}

function bytOpenModify(sym, side, curSL, curTP) {
    el('bytModSym').value   = sym;
    el('bytModSide').value  = side;
    el('bytModSL').value    = parseFloat(curSL) > 0 ? parseFloat(curSL) : '';
    el('bytModTP').value    = parseFloat(curTP) > 0 ? parseFloat(curTP) : '';
    el('bytModifyTitle').textContent = `Modify ${sym} ${side === 'Buy' ? 'LONG' : 'SHORT'}`;
    el('bytModifyMsg').style.display = 'none';
    el('bytModifyModal').style.display = 'flex';
}

async function bytSubmitModify() {
    const sym  = el('bytModSym').value;
    const side = el('bytModSide').value;
    const sl   = el('bytModSL').value;
    const tp   = el('bytModTP').value;
    if (!sl && !tp) return showMsg('bytModifyMsg', 'Enter SL or TP to update', '#f59e0b');
    try {
        const body = { category: bytCategory, symbol: sym, positionIdx: 0 };
        if (sl) { body.stopLoss = sl; body.slTriggerBy = 'MarkPrice'; }
        if (tp) { body.takeProfit = tp; body.tpTriggerBy = 'MarkPrice'; }
        const res = await bybitRequest('POST', '/v5/position/trading-stop', null, body);
        if (res.retCode === 0) {
            showMsg('bytModifyMsg', '✓ Updated!', '#48bb78');
            setTimeout(() => { el('bytModifyModal').style.display = 'none'; bytLoadPositions(); }, 1200);
        } else showMsg('bytModifyMsg', '✗ ' + res.retMsg, '#f56565');
    } catch(e) { showMsg('bytModifyMsg', '✗ ' + e.message, '#f56565'); }
}

// ── Modify Open Order ────────────────────────────────────────
function bytOpenModifyOrder(orderId, sym, price, qty, sl, tp) {
    el('bytModOrdId').value    = orderId;
    el('bytModOrdSym').value   = sym;
    el('bytModOrdPrice').value = parseFloat(price) > 0 ? price : '';
    el('bytModOrdQty').value   = qty;
    el('bytModOrdSL').value    = parseFloat(sl) > 0 ? sl : '';
    el('bytModOrdTP').value    = parseFloat(tp) > 0 ? tp : '';
    el('bytModOrdMsg').style.display = 'none';
    el('bytModOrdModal').style.display = 'flex';
}

async function bytSubmitModifyOrder() {
    const orderId = el('bytModOrdId').value;
    const sym     = el('bytModOrdSym').value;
    const price   = el('bytModOrdPrice').value;
    const qty     = el('bytModOrdQty').value;
    const sl      = el('bytModOrdSL').value;
    const tp      = el('bytModOrdTP').value;
    try {
        const body = { category: bytCategory, symbol: sym, orderId };
        if (price) body.price = price;
        if (qty)   body.qty   = qty;
        if (sl)    body.stopLoss    = sl;
        if (tp)    body.takeProfit  = tp;
        const res = await bybitRequest('POST', '/v5/order/amend', null, body);
        if (res.retCode === 0) {
            showMsg('bytModOrdMsg', '✓ Order updated!', '#48bb78');
            setTimeout(() => { el('bytModOrdModal').style.display = 'none'; bytLoadOrders(); }, 1200);
        } else showMsg('bytModOrdMsg', '✗ ' + res.retMsg, '#f56565');
    } catch(e) { showMsg('bytModOrdMsg', '✗ ' + e.message, '#f56565'); }
}

// ── Cancel Order ─────────────────────────────────────────────
async function bytCancelOrder(orderId, sym) {
    if (!confirm(`Cancel order ${orderId.slice(0,8)}…?`)) return;
    try {
        const res = await bybitRequest('POST', '/v5/order/cancel', null, { category: bytCategory, symbol: sym, orderId });
        if (res.retCode === 0) { showToast('✓ Order cancelled'); setTimeout(bytLoadOrders, 1000); }
        else showToast('✗ ' + res.retMsg, true);
    } catch(e) { showToast('✗ ' + e.message, true); }
}

// ── Helpers ──────────────────────────────────────────────────
function showMsg(id, text, color) {
    const el2 = el(id);
    if (!el2) return;
    el2.textContent = text; el2.style.color = color; el2.style.display = 'block';
    setTimeout(() => { if (el2.textContent === text) el2.style.display = 'none'; }, 4000);
}

function showToast(msg, isErr = false) {
    let t = document.getElementById('bybitToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'bybitToast';
        t.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);padding:0.55rem 1.2rem;border-radius:8px;font-size:13px;font-weight:700;z-index:9999;font-family:inherit;pointer-events:none;transition:opacity .3s';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isErr ? '#7f1d1d' : '#052e16';
    t.style.color = isErr ? '#f87171' : '#4ade80';
    t.style.border = `1px solid ${isErr ? '#991b1b' : '#166534'}`;
    t.style.opacity = '1';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.style.opacity = '0', 2500);
}
// ═══════════════════════════════════════════════════════════════
//  AUTOPILOT SYSTEM — SL Mode with Bybit WebSocket
// ═══════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────
let apMode      = 'manual';   // 'manual' | 'autopilot'
let apRunning   = false;
let apPosition  = null;       // snapshot of the tracked position
let apTriggered = { tp40: false, tp50: false, sl60: false }; // milestone flags

// ── Mode toggle ──────────────────────────────────────────────
function apSetMode(mode) {
    apMode = mode;
    el('apModeManualBtn').classList.toggle('active', mode === 'manual');
    el('apModeAutoBtn').classList.toggle('active', mode === 'autopilot');
    const hint = el('apModeHint');
    if (hint) hint.style.display = mode === 'autopilot' ? '' : 'none';
    // Update place button label to reflect mode
    const lbl = el('bytPlaceBtnLabel');
    if (lbl) {
        const isSpot = typeof bytCategory !== 'undefined' && bytCategory === 'spot';
        const dir = bytDirection === 'Buy' ? (isSpot ? 'BUY' : 'LONG') : (isSpot ? 'SELL' : 'SHORT');
        lbl.textContent = mode === 'autopilot'
            ? `🤖 Place ${dir} + Start Auto Mode`
            : `${bytDirection === 'Buy' ? '▲' : '▼'} Place ${dir} Order`;
    }
}

// ── Load open positions into symbol selector ─────────────────
async function apLoadPositionOptions() {
    const sel = el('apSymbolSelect');
    sel.innerHTML = '<option value="">Loading…</option>';
    try {
        const res = await bybitRequest('GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
        const pos = (res.result?.list || []).filter(p => parseFloat(p.size) > 0);
        if (pos.length === 0) {
            sel.innerHTML = '<option value="">— No open positions —</option>';
            return;
        }
        sel.innerHTML = '<option value="">— Select position —</option>' +
            pos.map(p => {
                const side = p.side === 'Buy' ? '▲ LONG' : '▼ SHORT';
                const pnl  = parseFloat(p.unrealisedPnl);
                return `<option value="${p.symbol}" data-side="${p.side}" data-entry="${p.avgPrice}" data-sl="${p.stopLoss}" data-tp="${p.takeProfit}" data-size="${p.size}" data-lev="${p.leverage}">
                    ${p.symbol} ${side} · entry ${parseFloat(p.avgPrice).toPrecision(5)} · PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}$
                </option>`;
            }).join('');
        sel.onchange = apPreviewPosition;
    } catch(e) {
        sel.innerHTML = '<option value="">— Error loading positions —</option>';
    }
}

function apPreviewPosition() {
    const sel = el('apSymbolSelect');
    const opt = sel.selectedOptions[0];
    if (!opt || !opt.value) { el('apPositionPreview').style.display = 'none'; return; }

    const entry = parseFloat(opt.dataset.entry);
    const sl    = parseFloat(opt.dataset.sl) || 0;
    const tp    = parseFloat(opt.dataset.tp) || 0;
    const side  = opt.dataset.side;
    const size  = parseFloat(opt.dataset.size);
    const lev   = opt.dataset.lev;
    const isLong = side === 'Buy';

    // SL distance and TP distance
    const slDist  = sl ? Math.abs(entry - sl)  : 0;
    const tpDist  = tp ? Math.abs(tp - entry)   : 0;
    const rr      = (slDist && tpDist) ? (tpDist / slDist).toFixed(2) : '—';

    const halfSlPrice = sl ? (isLong ? entry - slDist * 0.5 : entry + slDist * 0.5).toFixed(4) : '—';
    const bePrice     = entry.toFixed(4);

    el('apPreviewGrid').innerHTML = `
        <div class="ap-stat"><div class="ap-stat-label">Entry</div><div class="ap-stat-val">${entry.toPrecision(5)}</div></div>
        <div class="ap-stat" style="border-color:rgba(255,77,106,0.3)"><div class="ap-stat-label">Current SL</div><div class="ap-stat-val" style="color:#ef4444">${sl || '—'}</div></div>
        <div class="ap-stat" style="border-color:rgba(0,229,160,0.3)"><div class="ap-stat-label">Current TP</div><div class="ap-stat-val" style="color:#22c55e">${tp || '—'}</div></div>
        <div class="ap-stat"><div class="ap-stat-label">Size</div><div class="ap-stat-val">${size}</div></div>
        <div class="ap-stat"><div class="ap-stat-label">Leverage</div><div class="ap-stat-val">${lev}x</div></div>
        <div class="ap-stat"><div class="ap-stat-label">R:R</div><div class="ap-stat-val" style="color:var(--accent-blue)">${rr}</div></div>
        <div class="ap-stat" style="border-color:rgba(251,191,36,0.3)"><div class="ap-stat-label">@ 40% TP → SL to</div><div class="ap-stat-val" style="color:#fbbf24">${halfSlPrice}</div></div>
        <div class="ap-stat" style="border-color:rgba(251,191,36,0.3)"><div class="ap-stat-label">@ 50% TP → SL to</div><div class="ap-stat-val" style="color:#fbbf24">${bePrice} (BE)</div></div>
    `;
    el('apPositionPreview').style.display = 'block';

    if (!sl || !tp) {
        el('apStartBtn').disabled = true;
        el('apStartBtn').title = 'Position must have both SL and TP set';
    } else {
        el('apStartBtn').disabled = false;
        el('apStartBtn').title = '';
    }
}

// ── Switch to Autopilot from position card ────────────────────
async function bytSwitchToAutopilot(sym, side, entry, sl, tp, size, btnEl) {
    if (!sl || !tp) return showMsg('bytMsg', '⚠ Set SL and TP before starting autopilot', '#f5a623');

    // Optimistic UI — update button immediately
    const card = btnEl && btnEl.closest('.byt-pos-card');
    if (btnEl) {
        btnEl.textContent = '⏳ Starting…';
        btnEl.disabled = true;
    }

    try {
        const r = await fetch('/api/autopilot/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sym, entry, sl, tp, side, size })
        });
        const data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error || 'Server error');
        apPosition  = { sym, entry, sl, initSl: sl, tp, side, size, isLong: side === 'Buy', lastPrice: entry };
        apTriggered = { tp40: false, tp50: false, sl60: false };
        apRunning   = true;
        apStartPolling();
        showMsg('bytMsg', `🤖 Autopilot started for ${sym}`, '#a855f7');

        // Update button to "Stop Autopilot" state
        if (btnEl) {
            btnEl.textContent = '🛑 Stop Autopilot';
            btnEl.style.background = '#7f1d1d';
            btnEl.style.color = '#fca5a5';
            btnEl.disabled = false;
            btnEl.onclick = () => bytStopAutopilotFromCard(btnEl);
        }
        // Add "🤖 Autopilot Active" badge to card
        if (card && !card.querySelector('.ap-active-badge')) {
            const badge = document.createElement('span');
            badge.className = 'ap-active-badge';
            badge.textContent = '🤖 Autopilot Active';
            badge.style.cssText = 'display:inline-block;background:#3b0764;color:#a855f7;border:1px solid #7e22ce;border-radius:10px;padding:0.15rem 0.55rem;font-size:11px;font-weight:700;margin-bottom:0.5rem';
            card.insertBefore(badge, card.firstChild);
        }
        setTimeout(() => bytSwitchTab('autopilot'), 1200);
    } catch(e) {
        showMsg('bytMsg', `✗ ${e.message}`, '#f56565');
        // Revert button on failure
        if (btnEl) {
            btnEl.textContent = '🤖 Autopilot';
            btnEl.style.background = '';
            btnEl.style.color = '';
            btnEl.disabled = false;
        }
    }
}

async function bytStopAutopilotFromCard(btnEl) {
    if (!apRunning) return;
    await apStop();
    if (btnEl) {
        btnEl.textContent = '🤖 Autopilot';
        btnEl.style.background = '';
        btnEl.style.color = '';
        btnEl.disabled = false;
        btnEl.onclick = null; // will be re-rendered on next load
    }
    const card = btnEl && btnEl.closest('.byt-pos-card');
    const badge = card && card.querySelector('.ap-active-badge');
    if (badge) badge.remove();
}

// ── Start autopilot — delegates to server-side engine ────────
async function apStart() {
    const sel = el('apSymbolSelect');
    const opt = sel.selectedOptions[0];
    if (!opt?.value) return apLog('No position selected', 'warn');

    const entry = parseFloat(opt.dataset.entry);
    const sl    = parseFloat(opt.dataset.sl);
    const tp    = parseFloat(opt.dataset.tp);
    const side  = opt.dataset.side;
    const size  = parseFloat(opt.dataset.size);
    const sym   = opt.value;

    if (!sl || !tp) return apLog('Position must have SL and TP to use autopilot', 'warn');

    el('apStartBtn').disabled = true;
    el('apStartBtn').textContent = 'Starting…';

    try {
        const r = await fetch('/api/autopilot/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sym, entry, sl, tp, side, size })
        });
        const data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error || 'Server error');

        // Bootstrap local UI state from what we just sent
        apPosition  = { sym, entry, sl, initSl: sl, tp, side, size, isLong: side === 'Buy', lastPrice: entry };
        apTriggered = { tp40: false, tp50: false, sl60: false };
        apRunning   = true;

        apShowMonitor(opt);
        apStartPolling();
        apLog(`Autopilot started (server-side) — running even when this page is closed`, 'ok');
    } catch(e) {
        apLog(`Failed to start autopilot: ${e.message}`, 'warn');
        el('apStartBtn').disabled = false;
        el('apStartBtn').textContent = '▶ Start Autopilot';
    }
}

function apShowMonitor(opt) {
    const p      = apPosition;
    const isLong = p.isLong;
    el('apMonitor').style.display      = 'block';
    el('apSymbolSelect').disabled      = true;
    el('apStartBtn').disabled          = true;
    el('apStartBtn').textContent       = '▶ Start Autopilot';
    el('apStatusBadge').textContent    = '●';
    el('apStatusBadge').style.color    = '#22c55e';
    el('apStatusBadge').style.background = '#052e16';

    el('apTradeCard').className  = `ap-trade-card ${isLong ? 'long-track' : 'short-track'}`;
    el('apCardSym').textContent  = p.sym;
    el('apCardSide').textContent = isLong ? '▲ LONG' : '▼ SHORT';
    el('apCardSide').className   = `byt-pos-side ${isLong ? 'long' : 'short'}`;
    const lev = opt?.dataset?.lev || p.lev;
    el('apCardLev').textContent = lev ? lev + 'x' : '—';
    el('apCardEntry').textContent = p.entry.toPrecision(5);
    apUpdateCardPrices();

    ['apMs1Val','apMs2Val','apMs3Val'].forEach(id => {
        el(id).textContent = 'Waiting…';
        el(id).style.color = 'var(--text-muted)';
    });
}

function apUpdateCardPrices() {
    if (!apPosition) return;
    el('apCardSL').textContent = apPosition.sl || '—';
    el('apCardTP').textContent = apPosition.tp || '—';
}

// ── Server status polling — keeps UI in sync ─────────────────
let apPollTimer = null;
let apLastLogCount = 0;

function apStartPolling() {
    clearInterval(apPollTimer);
    apLastLogCount = 0;
    apPollTimer = setInterval(apPollStatus, 2000);
}

function apStopPolling() {
    clearInterval(apPollTimer);
    apPollTimer = null;
}

async function apPollStatus() {
    try {
        const doc = await apiGet('/api/autopilot/status');

        if (!doc.running) {
            // Server says stopped — reflect in UI
            if (apRunning) {
                apRunning   = false;
                apPosition  = null;
                apStopPolling();
                apResetMonitorUI();
                apLog('Autopilot finished (server stopped).', 'warn');
            }
            return;
        }

        apRunning  = true;
        apPosition = { ...doc.position, isLong: doc.position?.side === 'Buy' };
        apTriggered = doc.triggered || apTriggered;

        // Live price display
        if (doc.livePrice > 0) {
            const px = doc.livePrice;
            el('apLivePrice').textContent  = px.toPrecision(7);
            el('apStatusText').textContent = `Monitoring ${apPosition.sym} (server)`;
            el('apPulseDot').className     = 'ap-pulse monitoring';
            el('apWsStatus').textContent   = `Server WS ● ${px.toPrecision(6)}`;
            el('apWsStatus').style.color   = '#22c55e';

            // Progress bars
            const p          = apPosition;
            const initSl     = p.initSl || p.sl;   // guard: fallback if initSl missing
            const maxProfit  = Math.abs(p.tp   - p.entry) * p.size;
            const maxLoss    = Math.abs(initSl - p.entry) * p.size;
            const wsPnl      = p.isLong ? (px - p.entry) * p.size : (p.entry - px) * p.size;
            const wsTpPct    = (wsPnl > 0 && maxProfit && isFinite(wsPnl)) ? Math.min(99, (wsPnl / maxProfit) * 100) : 0;
            const wsSlPct    = (wsPnl < 0 && maxLoss   && isFinite(wsPnl)) ? Math.min(99, (Math.abs(wsPnl) / maxLoss) * 100) : 0;
            el('apTpBar').style.width = wsTpPct.toFixed(1) + '%';
            el('apSlBar').style.width = wsSlPct.toFixed(1) + '%';
            el('apTpPct').textContent = wsTpPct.toFixed(1) + '%';
            el('apSlPct').textContent = wsSlPct.toFixed(1) + '%';
            el('apCardPnl').textContent = (wsPnl >= 0 ? '+' : '') + '$' + Math.abs(wsPnl).toFixed(2);
            el('apCardPnl').style.color = wsPnl >= 0 ? '#22c55e' : '#ef4444';
        }

        apUpdateCardPrices();

        // Mirror milestones that were triggered server-side
        if (apTriggered.tp40) apMilestoneHit('apMs1', `✓ SL → ${apPosition.sl}`);
        if (apTriggered.tp50) apMilestoneHit('apMs2', `✓ SL → BE ${apPosition.entry.toFixed(4)}`);
        if (apTriggered.sl60) apMilestoneHit('apMs3', `✓ TP → BE ${apPosition.entry.toFixed(4)}`);

        // Append any new server log entries
        const logs = doc.logs || [];
        if (logs.length > apLastLogCount) {
            const newEntries = logs.slice(apLastLogCount);
            newEntries.forEach(e => {
                if (e.type === 'action' || e.type === 'ok' || e.type === 'warn') {
                    apLog(`[server] ${e.msg}`, e.type);
                }
            });
            apLastLogCount = logs.length;
        }
    } catch(_) {}
}

// ── Resume display if server is already running on page load ──
async function apCheckResume() {
    try {
        const doc = await apiGet('/api/autopilot/status');
        if (!doc.running || !doc.position) return;

        apRunning   = true;
        apPosition  = { ...doc.position, isLong: doc.position.side === 'Buy' };
        apTriggered = doc.triggered || { tp40: false, tp50: false, sl60: false };
        apLastLogCount = (doc.logs || []).length;

        // Restore autopilot mode in form toggle
        apMode = 'autopilot';
        el('apModeManualBtn').classList.remove('active');
        el('apModeAutoBtn').classList.add('active');
        const hint = el('apModeHint');
        if (hint) hint.style.display = '';
        el('apTab').style.display = '';
        bytSwitchTab('autopilot');

        apShowMonitor(null);
        apStartPolling();
        apLog(`Resumed: server is monitoring ${apPosition.sym} ${apPosition.isLong ? 'LONG' : 'SHORT'}`, 'ok');
    } catch(_) {}
}

// ── Stop autopilot ───────────────────────────────────────────
async function apStop() {
    apStopPolling();
    try { await fetch('/api/autopilot/stop', { method: 'POST' }); } catch(_) {}
    apRunning  = false;
    apPosition = null;
    apResetMonitorUI();
    apLog('Autopilot stopped.', 'warn');
}

function apResetMonitorUI() {
    el('apMonitor').style.display    = 'none';
    el('apSymbolSelect').disabled    = false;
    el('apStartBtn').disabled        = false;
    el('apStartBtn').textContent     = '▶ Start Autopilot';
    el('apPositionPreview').style.display = 'none';
    el('apSymbolSelect').value       = '';
    el('apStatusBadge').textContent  = 'OFF';
    el('apStatusBadge').style.color  = '#a855f7';
    el('apStatusBadge').style.background = '#3b0764';
    el('apPulseDot').className       = 'ap-pulse active';
    el('apWsStatus').textContent     = '';
}

// ── Milestone UI helper ───────────────────────────────────────
function apMilestoneHit(id, text) {
    const valEl = el(id);
    if (!valEl || valEl.textContent === text) return; // avoid flicker
    valEl.textContent = text;
    valEl.style.color = '#fbbf24';
    valEl.parentElement.style.borderColor = 'rgba(251,191,36,0.4)';
    valEl.parentElement.style.background  = 'rgba(251,191,36,0.05)';
}

// ── Fetch mark price (still used for live price placeholder) ──
async function apFetchMarkPrice(sym) {
    try {
        const res  = await fetch(`/api/proxy/binance?path=/fapi/v1/ticker/24hr&symbol=${sym}`);
        const data = await res.json();
        const mark = parseFloat(data?.lastPrice);
        return mark > 0 ? mark : null;
    } catch { return null; }
}

// ── Logging helper ────────────────────────────────────────────
function apLog(msg, type = '') {
    const log = el('apLog');
    if (!log) return;
    const now = new Date().toTimeString().slice(0, 8);
    const row = document.createElement('div');
    row.className = 'ap-log-row';
    row.innerHTML = `<span class="ap-log-time">${now}</span><span class="ap-log-msg ${type}">${msg}</span>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    if (type === 'action' || type === 'warn') showToast(msg, type === 'warn');
}


