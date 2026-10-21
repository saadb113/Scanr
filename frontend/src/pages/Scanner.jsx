import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useBybitCreds } from '../hooks/useBybitCreds';
import { fetchBinanceKlines } from '../utils/bybit';
import { calcRSI, calcMACD, detectSignals } from '../utils/scannerIndicators';
import { UNIVERSE, DEFAULT_SYMBOLS } from './settings/constants';
import CoinCell from '../components/scanner/CoinCell';
import CoinRow from '../components/scanner/CoinRow';
import CoinModal from '../components/scanner/CoinModal';

// Scanner — the core free+premium product page (not premium-gated, confirmed
// by the absence of data-premium-page/enforcePremiumAccess in the legacy
// public/index.html). Ported from public/index.html + the scanner-specific
// parts of public/js/app.js. Two large chunks of the legacy page are
// intentionally NOT ported here:
//   - A full duplicate "Settings" panel overlay — dead weight now that
//     Settings is its own React route (/settings).
//   - A full duplicate Bybit Trading Terminal overlay — Terminal is its own
//     React route (/terminal); this page links out to it instead (see
//     CoinModal's "Trade on Bybit" and "More Details" buttons).
//
// Backend-gap notes (see CoinModal.jsx / useAiAnalysis.js for the same gap
// documented elsewhere in this migration):
//   - GET /api/proxy/binance (klines/ticker/exchangeInfo proxy) does not
//     exist in server.js. The legacy page's entire grid silently showed
//     nothing but placeholders because every fetchAndDraw() call 404'd and
//     was swallowed by its try/catch. We fetch Binance's public futures API
//     directly from the browser instead (frontend/src/utils/bybit.js's
//     fetchBinanceKlines), the same fix already applied for Terminal/
//     Coin-Detail/Setups/Strategy — this actually RESTORES working data
//     instead of reproducing the (fully broken) production behavior.
//   - GET /api/analysis/usage (daily free-tier AI usage counter) does not
//     exist either. We reproduce that exact (inert) behavior: the usage
//     fetch 404s, aiUsage stays null, and the "N/3" counter / limit block
//     never activate — same as production today.
//
// Known pre-existing dead control, preserved rather than "fixed": the
// Appearance "Card Size" slider (Settings page) has no visible effect
// anywhere — .cell and .grid-container in scanrApp.css fix height/columns
// with `!important` at every breakpoint (confirmed identical in
// public/css/styles.css), which always wins over the slider's inline style.
// Grid column/size layout is therefore left entirely to CSS; the dynamic
// updateGrid()/ResizeObserver column-count math from app.js was not ported
// since it would have zero visible effect.

const SCANNER_TF_OPTIONS = [
  { value: '1m', label: '1m' }, { value: '3m', label: '3m' }, { value: '5m', label: '5m' },
  { value: '15m', label: '15m' }, { value: '30m', label: '30m' }, { value: '1h', label: '1h' },
  { value: '2h', label: '2h' }, { value: '4h', label: '4h' }, { value: '1d', label: '1D' }, { value: '1w', label: '1W' },
];
const FREE_TIMEFRAME_LIMIT = 3;
const DEFAULT_COLORS = { rsi: '#a600ff', rsiOB: '#f56565', rsiOS: '#48bb78', macd: '#63b3ed', signal: '#f6ad55', bull: '#48bb78', bear: '#f56565', lw: 2, price: '#e5e9f2' };

const FILTERS = [
  { filter: 'all', fid: 'fAll', label: 'All' },
  { filter: 'ob', fid: 'fOB', label: 'RSI OB' },
  { filter: 'os', fid: 'fOS', label: 'RSI OS' },
  { filter: 'rdiv', fid: 'fRDiv', label: 'RSI Div' },
  { filter: 'mdiv', fid: 'fMDiv', label: 'MACD Div' },
  { filter: 'mxbull', fid: 'fMXBull', label: 'MACD Bull✕' },
  { filter: 'mxbear', fid: 'fMXBear', label: 'MACD Bear✕' },
  { filter: 'rsigolden', fid: 'fRsiGolden', label: 'RSI Golden✦' },
  { filter: 'rsideath', fid: 'fRsiDeath', label: 'RSI Death✦' },
];

const SORTS = [
  { id: 'default', label: 'Default (manual)', short: 'Default' },
  { id: 'az', label: 'A → Z', short: 'A→Z' },
  { id: 'za', label: 'Z → A', short: 'Z→A' },
  { id: 'price-hi', label: 'Price High → Low', short: 'Price↓' },
  { id: 'price-lo', label: 'Price Low → High', short: 'Price↑' },
  { id: 'rsi-hi', label: 'RSI High → Low', short: 'RSI↓' },
  { id: 'rsi-lo', label: 'RSI Low → High', short: 'RSI↑' },
  { id: 'macd-hi', label: 'MACD High → Low', short: 'MACD↓' },
  { id: 'macd-lo', label: 'MACD Low → High', short: 'MACD↑' },
  { id: 'div-age', label: 'Div Age (freshest)', short: 'Div Fresh' },
];

function getTimeframeLabel(v) {
  return SCANNER_TF_OPTIONS.find((o) => o.value === v)?.label || v;
}

function matchesFilter(sym, activeFilter, dataMap, watchlist) {
  if (activeFilter === 'all') return true;
  if (activeFilter === 'watchlist') return watchlist.includes(sym);
  const d = dataMap[sym]; if (!d || !d.flags) return false;
  const f = d.flags;
  switch (activeFilter) {
    case 'ob': return f.ob;
    case 'os': return f.os;
    case 'rdiv': return f.rdivBull || f.rdivBear;
    case 'mxbull': return f.mxBull;
    case 'mxbear': return f.mxBear;
    case 'mdiv': return f.mdivBull || f.mdivBear;
    case 'rsigolden': return f.rsiGolden;
    case 'rsideath': return f.rsiDeath;
    default: return true;
  }
}

function sortedSymbols(list, activeSort, dataMap) {
  if (activeSort === 'default') return list;
  return [...list].sort((a, b) => {
    const da = dataMap[a], db = dataMap[b];
    switch (activeSort) {
      case 'az': return a.localeCompare(b);
      case 'za': return b.localeCompare(a);
      case 'price-hi': return (db?.price || 0) - (da?.price || 0);
      case 'price-lo': return (da?.price || 0) - (db?.price || 0);
      case 'rsi-hi': return (db?.rsi?.at(-1) ?? -1) - (da?.rsi?.at(-1) ?? -1);
      case 'rsi-lo': return (da?.rsi?.at(-1) ?? 999) - (db?.rsi?.at(-1) ?? 999);
      case 'macd-hi': return (db?.macd?.at(-1) ?? -Infinity) - (da?.macd?.at(-1) ?? -Infinity);
      case 'macd-lo': return (da?.macd?.at(-1) ?? Infinity) - (db?.macd?.at(-1) ?? Infinity);
      case 'div-age': {
        const ageA = Math.min(da?.flags?.rdivAge ?? Infinity, da?.flags?.mdivAge ?? Infinity);
        const ageB = Math.min(db?.flags?.rdivAge ?? Infinity, db?.flags?.mdivAge ?? Infinity);
        return ageA - ageB;
      }
      default: return 0;
    }
  });
}

export default function Scanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { hasCreds } = useBybitCreds();
  const isPremium = user?.accountTier === 'premium';
  const userKey = user?._id || user?.id || 'anon';

  const [symbols, setSymbols] = useState([]);
  const [dataMap, setDataMap] = useState({});
  const [layout, setLayoutMode] = useState(() => { try { return localStorage.getItem('SCANR_layout') || 'grid'; } catch { return 'grid'; } });
  const [cellSize, setCellSize] = useState(160);
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [visibility, setVisibility] = useState({ price: true, rsi: true, macd: true });
  const [priceType, setPriceType] = useState('candle');
  const [rsiLen, setRsiLen] = useState(14);
  const [fastLen, setFastLen] = useState(12);
  const [slowLen, setSlowLen] = useState(26);
  const [signalLen, setSignalLen] = useState(9);
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeSort, setActiveSort] = useState('default');
  const [watchlist, setWatchlist] = useState([]);
  const [filterVis, setFilterVis] = useState({});
  const [posSettings, setPosSettings] = useState({});
  const [drawings, setDrawings] = useState({});
  const [kimiCache, setKimiCache] = useState({});
  const [aiUsage, setAiUsage] = useState(null);
  const [openSym, setOpenSym] = useState(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeTimeframes, setActiveTimeframes] = useState([]);
  const [activeTf, setActiveTf] = useState('1m');
  const [tfDropdownOpen, setTfDropdownOpen] = useState(false);
  const [tfLimitMsg, setTfLimitMsg] = useState(false);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [dragState, setDragState] = useState({ src: null, over: null });
  const [resizeTick, setResizeTick] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const symbolsRef = useRef(symbols);
  const settingsLoadedRef = useRef(false);

  useEffect(() => { symbolsRef.current = symbols; }, [symbols]);

  // ── Boot: load every scanner-related settings doc once ─────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, wl, fv, ps, dr, kc] = await Promise.all([
        api.get('/api/settings').catch(() => ({})),
        api.get('/api/watchlist').catch(() => []),
        api.get('/api/filter-vis').catch(() => ({})),
        api.get('/api/pos-settings').catch(() => ({})),
        api.get('/api/drawings').catch(() => ({})),
        api.get('/api/kimi-cache').catch(() => ({})),
      ]);
      if (cancelled) return;
      if (s.cellSize) setCellSize(s.cellSize);
      if (s.colors) setColors((c) => ({ ...c, ...s.colors }));
      if (s.visibility) setVisibility((v) => ({ ...v, ...s.visibility }));
      if (s.priceType) setPriceType(s.priceType);
      if (s.rsiLen) setRsiLen(s.rsiLen);
      if (s.fastLen) setFastLen(s.fastLen);
      if (s.slowLen) setSlowLen(s.slowLen);
      if (s.signalLen) setSignalLen(s.signalLen);
      if (s.activeSort) setActiveSort(s.activeSort);
      setSymbols(s.symbols && s.symbols.length ? [...s.symbols] : [...DEFAULT_SYMBOLS]);
      if (Array.isArray(wl)) setWatchlist(wl);
      if (fv && typeof fv === 'object') setFilterVis(fv);
      if (ps && typeof ps === 'object') setPosSettings(ps);
      if (dr && typeof dr === 'object') setDrawings(dr);
      if (kc && typeof kc === 'object') setKimiCache(kc);

      // Timeframe pills — scoped to this user, clipped to the free limit.
      let tfs = null;
      try {
        const raw = localStorage.getItem(`scanner_timeframes:${userKey}`);
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) tfs = parsed.filter((v) => SCANNER_TF_OPTIONS.some((o) => o.value === v));
      } catch { /* ignore */ }
      if (!tfs || !tfs.length) tfs = isPremium ? ['1h', '4h'] : ['1m', '3m', '15m'];
      else if (!isPremium) tfs = tfs.slice(0, FREE_TIMEFRAME_LIMIT);
      setActiveTimeframes(tfs);
      setActiveTf(s.timeframe && tfs.includes(s.timeframe) ? s.timeframe : tfs[0]);

      settingsLoadedRef.current = true;
      setLoaded(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPremium]);

  useEffect(() => {
    if (!activeTimeframes.length) return;
    try { localStorage.setItem(`scanner_timeframes:${userKey}`, JSON.stringify(activeTimeframes)); } catch { /* ignore */ }
  }, [activeTimeframes, userKey]);

  // AI daily-usage counter — dead endpoint upstream (see file header note);
  // fetch once and swallow the 404 so the button just never shows a counter.
  useEffect(() => {
    api.get('/api/analysis/usage').then(setAiUsage).catch(() => setAiUsage(null));
  }, []);

  // ── Persist scanner settings whenever they change (post-boot) ──────
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    api.post('/api/settings', {
      rsiLen, fastLen, slowLen, signalLen, cellSize,
      symbols, activeSymbols: symbols,
      colors, visibility, priceType, activeSort, timeframe: activeTf,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, colors, visibility, priceType, cellSize, rsiLen, fastLen, slowLen, signalLen, activeSort, activeTf]);

  // ── Data fetch loop ──────────────────────────────────────────────
  const fetchAndDraw = useCallback(async (sym, tf, rl, fa, slw, sig) => {
    try {
      const limit = Math.max(slw + sig + rl + 150, 200);
      const klines = await fetchBinanceKlines(sym, tf, limit);
      if (!Array.isArray(klines) || klines.length < 10) return;
      const highs = klines.map((k) => parseFloat(k[2]));
      const lows = klines.map((k) => parseFloat(k[3]));
      const closes = klines.map((k) => parseFloat(k[4]));
      const price = closes[closes.length - 1];
      const rsiArr = calcRSI(closes, rl);
      const { ml, sl2, hl } = calcMACD(closes, fa, slw, sig);
      const N = 50;
      const ohlcFull = klines.map((k) => [parseFloat(k[1]), parseFloat(k[2]), parseFloat(k[3]), parseFloat(k[4])]);
      const flags = detectSignals(highs, lows, closes, rsiArr, ml, sl2, hl);
      const entry = {
        price, ohlc: ohlcFull.slice(-N),
        rsi: rsiArr.slice(-N), macd: ml.slice(-N), signal: sl2.slice(-N), hist: hl.slice(-N),
        rsiFullLen: rsiArr.length, macdFullLen: ml.length, flags,
        ohlcFull, rsiArr, macdArr: ml, signalArr: sl2, histArr: hl,
      };
      setDataMap((prev) => ({ ...prev, [sym]: entry }));
    } catch { /* silent — matches legacy fetchAndDraw's catch-all */ }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const run = () => symbolsRef.current.forEach((sym) => fetchAndDraw(sym, activeTf, rsiLen, fastLen, slowLen, signalLen));
    run();
    const id = setInterval(run, 20000);
    return () => clearInterval(id);
  }, [loaded, activeTf, rsiLen, fastLen, slowLen, signalLen, fetchAndDraw]);

  // Redraw cells on container resize (cell canvases read their own
  // offsetWidth/Height, which CSS — not this component — governs).
  useEffect(() => {
    const onResize = () => setResizeTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Symbol add/remove (search box) ──────────────────────────────
  function addOrRemoveSymbol(sym) {
    setSymbols((prev) => {
      if (prev.includes(sym)) return prev.filter((s) => s !== sym);
      fetchAndDraw(sym, activeTf, rsiLen, fastLen, slowLen, signalLen);
      return [sym, ...prev];
    });
  }

  function openModal(sym) {
    setOpenSym(sym);
    if (!dataMap[sym]) fetchAndDraw(sym, activeTf, rsiLen, fastLen, slowLen, signalLen);
  }

  function toggleWatchlist(sym) {
    setWatchlist((prev) => {
      const next = prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym];
      api.post('/api/watchlist', { symbols: next }).catch(() => {});
      return next;
    });
  }

  // ── Drag reorder (grid mode) ────────────────────────────────────
  function handleDrop(dstSym) {
    const src = dragState.src;
    setDragState({ src: null, over: null });
    if (!src || src === dstSym) return;
    setSymbols((prev) => {
      const arr = [...prev];
      const si = arr.indexOf(src), di = arr.indexOf(dstSym);
      if (si < 0 || di < 0) return prev;
      arr.splice(si, 1);
      arr.splice(di, 0, src);
      return arr;
    });
  }

  // ── Drawings persistence ─────────────────────────────────────────
  function saveDrawing(sym, tf, objs) {
    setDrawings((prev) => {
      const next = { ...prev };
      if (objs && objs.length) next[sym] = { ...(next[sym] || {}), [tf]: objs };
      else if (next[sym]) {
        const symDrawings = { ...next[sym] };
        delete symDrawings[tf];
        if (Object.keys(symDrawings).length) next[sym] = symDrawings; else delete next[sym];
      }
      return next;
    });
    api.post(`/api/drawings/${sym}/${tf}`, { objs: objs || [] }).catch(() => {});
  }

  // ── AI result cache ──────────────────────────────────────────────
  function aiCacheKey(sym, tf) { return `${sym}:${tf}`; }
  function aiCacheSet(sym, tf, value) {
    setKimiCache((prev) => ({ ...prev, [aiCacheKey(sym, tf)]: value }));
    api.post('/api/kimi-cache', { key: aiCacheKey(sym, tf), value }).catch(() => {});
  }
  function aiCacheClear(sym, tf) {
    setKimiCache((prev) => { const next = { ...prev }; delete next[aiCacheKey(sym, tf)]; return next; });
    api.del('/api/kimi-cache', { key: aiCacheKey(sym, tf) }).catch(() => {});
  }

  // ── Derived: filtered + sorted symbol list, counts ──────────────
  const counts = useMemo(() => {
    const c = { all: 0, ob: 0, os: 0, rdiv: 0, mxbull: 0, mxbear: 0, mdiv: 0, rsigolden: 0, rsideath: 0, watchlist: 0 };
    symbols.forEach((sym) => {
      if (watchlist.includes(sym)) c.watchlist++;
      const d = dataMap[sym];
      c.all++;
      if (!d || !d.flags) return;
      const f = d.flags;
      if (f.ob) c.ob++;
      if (f.os) c.os++;
      if (f.rdivBull || f.rdivBear) c.rdiv++;
      if (f.mxBull) c.mxbull++;
      if (f.mxBear) c.mxbear++;
      if (f.mdivBull || f.mdivBear) c.mdiv++;
      if (f.rsiGolden) c.rsigolden++;
      if (f.rsiDeath) c.rsideath++;
    });
    return c;
  }, [symbols, dataMap, watchlist]);

  const visibleSymbols = useMemo(() => {
    const matching = symbols.filter((s) => matchesFilter(s, activeFilter, dataMap, watchlist));
    const isDivFilter = activeFilter === 'rdiv' || activeFilter === 'mdiv';
    if (activeSort !== 'default') return sortedSymbols(matching, activeSort, dataMap);
    if (isDivFilter) {
      const getAge = (sym) => {
        const d = dataMap[sym]; if (!d || !d.flags) return Infinity;
        return activeFilter === 'rdiv' ? (d.flags.rdivAge ?? Infinity) : (d.flags.mdivAge ?? Infinity);
      };
      return [...matching].sort((a, b) => getAge(a) - getAge(b));
    }
    return matching;
  }, [symbols, activeFilter, activeSort, dataMap, watchlist]);

  // ── Search dropdown ─────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const q = search.toUpperCase().replace('USDT', '').trim();
    if (!q) return [];
    const starts = UNIVERSE.filter((s) => s.replace('USDT', '').startsWith(q));
    const contains = UNIVERSE.filter((s) => !s.replace('USDT', '').startsWith(q) && s.replace('USDT', '').includes(q));
    return [...starts, ...contains].slice(0, 40);
  }, [search]);

  function onSearchKeyDown(e) {
    if (e.key === 'Escape') { setSearchOpen(false); e.target.blur(); return; }
    if (e.key === 'Enter') {
      let q = search.trim().toUpperCase();
      if (!q) return;
      if (!q.endsWith('USDT')) q += 'USDT';
      addOrRemoveSymbol(q);
      setSearch(''); setSearchOpen(false);
    }
  }

  // ── Timeframe pills ──────────────────────────────────────────────
  function selectTf(tf) {
    if (tf === activeTf) return;
    setActiveTf(tf);
  }
  function removeTf(tf) {
    if (activeTimeframes.length <= 1) return;
    setActiveTimeframes((prev) => prev.filter((x) => x !== tf));
    if (activeTf === tf) setActiveTf((prevTf) => { const rest = activeTimeframes.filter((x) => x !== tf); return rest[0] || prevTf; });
  }
  function toggleTfInDropdown(tfVal) {
    const isActive = activeTimeframes.includes(tfVal);
    if (isActive) { removeTf(tfVal); return; }
    if (!isPremium && activeTimeframes.length >= FREE_TIMEFRAME_LIMIT) { setTfLimitMsg(true); return; }
    setActiveTimeframes((prev) => [...prev, tfVal]);
    setTfLimitMsg(false);
  }

  const layoutRows = layout === 'list';

  function setLayout(mode) {
    setLayoutMode(mode);
    try { localStorage.setItem('SCANR_layout', mode); } catch { /* ignore */ }
  }

  const modalData = openSym ? dataMap[openSym] : null;
  const modalInitialDrawObjs = openSym ? (drawings[openSym]?.[activeTf] || []) : [];
  const modalAiCached = openSym ? (kimiCache[aiCacheKey(openSym, activeTf)] || null) : null;

  return (
    <div className="wrap" onClick={() => { setSearchOpen(false); setTfDropdownOpen(false); setSortDropdownOpen(false); }}>
      <div className="header-row" style={{ padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="search-wrap" onClick={(e) => e.stopPropagation()}>
          <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            className="search-input" placeholder="Search coin…" autoComplete="off" spellCheck="false"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={onSearchKeyDown}
          />
          {searchOpen && search.trim() && (
            <div className="search-dropdown open">
              {searchResults.length === 0 && <div className="sd-empty">No results for &quot;{search}&quot;</div>}
              {searchResults.map((sym) => (
                <div key={sym} className="sd-item" onMouseDown={(e) => { e.preventDefault(); setSearch(''); setSearchOpen(false); openModal(sym); }}>
                  <span className="sd-sym">{sym.replace('USDT', '')}</span><span className="sd-sub">/USDT</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ctrl-box" onClick={(e) => e.stopPropagation()}>
          <label>TF</label>
          <div className="tf-picker">
            <div className="tf-pills">
              {activeTimeframes.map((tf) => (
                <button key={tf} type="button" className={`tf-pill${tf === activeTf ? ' active' : ''}`} onClick={() => selectTf(tf)}>
                  <span>{getTimeframeLabel(tf)}</span>
                  <span className="tf-pill-remove" role="button" title="Remove" onClick={(e) => { e.stopPropagation(); removeTf(tf); }}>×</span>
                </button>
              ))}
            </div>
            <button type="button" className="tf-plus-btn" onClick={() => { setTfDropdownOpen((v) => !v); setTfLimitMsg(false); }}>+▼</button>
            <div className={`tf-dropdown${tfDropdownOpen ? ' open' : ''}`}>
              {SCANNER_TF_OPTIONS.map((opt) => {
                const isActive = activeTimeframes.includes(opt.value);
                const canAddMore = isPremium || activeTimeframes.length < FREE_TIMEFRAME_LIMIT;
                const locked = !isPremium && !isActive && !canAddMore;
                return (
                  <div key={opt.value} className={`tf-option${isActive ? ' active' : ''}${locked ? ' locked' : ''}`} onClick={() => toggleTfInDropdown(opt.value)}>
                    <span>{opt.label}</span>
                    <span className="tf-opt-right">
                      <span className="tf-opt-check">{isActive ? '✓' : ''}</span>
                      <span>{locked ? '🔒' : ''}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            {tfLimitMsg && (
              <div className="tf-limit-tooltip" style={{ display: 'block' }}>
                Free users can add up to 3 timeframes.<br />Upgrade to Premium for unlimited timeframes.<br />
                <button type="button" className="tf-limit-upgrade" onClick={() => navigate('/pricing')}>Upgrade ⚡</button>
              </div>
            )}
          </div>
        </div>

        <div className="legend">
          <div className="legend-item"><div className="leg-line" style={{ background: '#29ffb8' }} />RSI</div>
          <div className="legend-item"><div className="leg-line" style={{ background: '#63b3ed' }} />MACD</div>
          <div className="legend-item"><div className="leg-line" style={{ background: '#f6ad55' }} />Signal</div>
          <div className="legend-item"><div className="leg-dot" style={{ background: '#48bb78' }} />Bull</div>
          <div className="legend-item"><div className="leg-dot" style={{ background: '#f56565' }} />Bear</div>
        </div>
      </div>

      <div className="filter-bar">
        <span style={{ fontSize: '0.82rem', color: '#3a4560', textTransform: 'uppercase', letterSpacing: '.5px', marginRight: '.2rem' }}>Filter</span>
        {FILTERS.filter((f) => filterVis[f.fid] !== false).map((f) => (
          <button
            key={f.filter} type="button"
            className={`filter-btn f-${f.filter}${activeFilter === f.filter ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setActiveFilter(f.filter); }}
          >{f.label} <span className="filter-count">{counts[f.filter]}</span></button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <button
            type="button" className="filter-btn f-watchlist" title="Show Watchlist only"
            onClick={(e) => { e.stopPropagation(); setActiveFilter((f) => (f === 'watchlist' ? 'all' : 'watchlist')); }}
          >★ Watchlist <span className="filter-count">{counts.watchlist}</span></button>
          <button type="button" className="sort-btn" title="Toggle grid/list layout" onClick={(e) => { e.stopPropagation(); setLayout(layout === 'grid' ? 'list' : 'grid'); }}>
            {layout === 'list' ? '☰ List' : '⊞ Grid'}
          </button>
          <div className="sort-wrap" onClick={(e) => e.stopPropagation()}>
            <button type="button" className={`sort-btn${sortDropdownOpen ? ' active' : ''}`} onClick={() => setSortDropdownOpen((v) => !v)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M7 12h10M11 18h2" /></svg>
              Sort <span>{SORTS.find((s) => s.id === activeSort)?.short}</span>
            </button>
            <div className={`sort-dropdown${sortDropdownOpen ? ' open' : ''}`}>
              {SORTS.map((s) => (
                <div key={s.id} className={`sort-item${activeSort === s.id ? ' active' : ''}`} onClick={() => { setActiveSort(s.id); setSortDropdownOpen(false); }}>{s.label}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={`grid-container${layoutRows ? ' list-mode' : ''}`}>
        {visibleSymbols.map((sym) => (layoutRows ? (
          <CoinRow key={sym} sym={sym} data={dataMap[sym]} starred={watchlist.includes(sym)} onOpen={openModal} onToggleWatchlist={toggleWatchlist} />
        ) : (
          <CoinCell
            key={sym} sym={sym} data={dataMap[sym]} cellSize={cellSize} colors={colors} visibility={visibility}
            priceType={priceType} tfLabel={getTimeframeLabel(activeTf)} starred={watchlist.includes(sym)} resizeTick={resizeTick}
            onOpen={openModal} onToggleWatchlist={toggleWatchlist}
            onDragStart={(s) => setDragState({ src: s, over: null })}
            onDragOver={(s) => setDragState((prev) => (prev.src && prev.src !== s ? { ...prev, over: s } : prev))}
            onDragLeave={(s) => setDragState((prev) => (prev.over === s ? { ...prev, over: null } : prev))}
            onDrop={handleDrop}
            onDragEnd={() => setDragState({ src: null, over: null })}
            dragState={dragState}
          />
        )))}
        {!symbols.length && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            No coins selected — add some from the search box above, or in Settings → Coins.
          </div>
        )}
      </div>

      {openSym && (
        <CoinModal
          key={openSym}
          sym={openSym}
          data={modalData}
          timeframe={activeTf}
          tfLabel={getTimeframeLabel(activeTf)}
          colors={colors}
          priceType={priceType}
          rsiLen={rsiLen} fastLen={fastLen} slowLen={slowLen} signalLen={signalLen}
          posSettings={posSettings}
          starred={watchlist.includes(openSym)}
          onToggleWatchlist={toggleWatchlist}
          initialDrawObjs={modalInitialDrawObjs}
          onSaveDrawing={(objs) => saveDrawing(openSym, activeTf, objs)}
          aiUsage={aiUsage}
          onAiUsageChange={setAiUsage}
          aiCached={modalAiCached}
          onAiCacheSet={(value) => aiCacheSet(openSym, activeTf, value)}
          onAiCacheClear={() => aiCacheClear(openSym, activeTf)}
          hasBybitCreds={hasCreds}
          navigate={navigate}
          onClose={() => setOpenSym(null)}
        />
      )}
    </div>
  );
}
