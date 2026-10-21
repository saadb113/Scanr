import { useEffect, useRef } from 'react';
import { useExternalScript } from '../utils/useExternalScript';

// Mounts a TradingView "Advanced Chart" widget into `containerRef` and tears
// it down (via widget.remove()) whenever the symbol/options change or the
// component unmounts. React Router doesn't force a full page reload between
// routes like the old multi-page app did, so without an explicit remove()
// here, navigating Terminal -> another route -> Terminal would stack up
// zombie TradingView iframes/containers.
//
// `options` should be a stable object (build it with useMemo in the caller)
// since it's used as an effect dependency via JSON.stringify.
export function useTradingViewWidget(containerRef, symbol, options) {
  const scriptReady = useExternalScript('https://s3.tradingview.com/tv.js');
  const widgetRef = useRef(null);
  const optionsKey = JSON.stringify(options || {});

  useEffect(() => {
    if (!scriptReady || !window.TradingView || !containerRef.current || !symbol) return undefined;

    // Clear any previous widget before creating a new one.
    if (widgetRef.current) {
      try { widgetRef.current.remove(); } catch { /* ignore */ }
      widgetRef.current = null;
    }
    containerRef.current.innerHTML = '';

    widgetRef.current = new window.TradingView.widget({
      container_id: containerRef.current.id,
      symbol: `BYBIT:${symbol}`,
      interval: '5',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      hide_side_toolbar: false,
      toolbar_bg: '#131722',
      withdateranges: true,
      ...options,
    });

    return () => {
      if (widgetRef.current) {
        try { widgetRef.current.remove(); } catch { /* ignore */ }
        widgetRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptReady, symbol, optionsKey]);

  // Final safety net: remove the widget on unmount even if the effect above
  // didn't re-run (e.g. symbol never changed again before navigating away).
  useEffect(() => () => {
    if (widgetRef.current) {
      try { widgetRef.current.remove(); } catch { /* ignore */ }
      widgetRef.current = null;
    }
  }, []);
}
