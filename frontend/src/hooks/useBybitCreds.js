import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { syncBybitClock } from '../utils/bybit';

// Loads the user's stored Bybit credentials (/api/bybit-store) and keeps a
// clock-offset in sync with Bybit, same as bybitGetCreds()/bybitSyncClock()
// in public/js/app.js. Shared by Terminal and Coin-Detail.
export function useBybitCreds() {
  const [store, setStore] = useState({});
  const [loaded, setLoaded] = useState(false);
  const clockOffsetRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, offset] = await Promise.all([
          api.get('/api/bybit-store').catch(() => ({})),
          syncBybitClock(),
        ]);
        if (cancelled) return;
        setStore(s && typeof s === 'object' ? s : {});
        clockOffsetRef.current = offset;
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const env = store.activeEnv || 'mainnet';
  const creds = { ...(store[env] || {}), env };
  const hasCreds = Boolean(creds.apiKey && creds.apiSecret);

  const switchEnv = useCallback(async (nextEnv) => {
    setStore((prev) => {
      const next = { ...prev, activeEnv: nextEnv };
      api.post('/api/bybit-store', next).catch(() => {});
      return next;
    });
  }, []);

  return { store, creds, hasCreds, loaded, clockOffset: clockOffsetRef.current, switchEnv };
}
