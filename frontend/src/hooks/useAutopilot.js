import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

function nowStr() {
  return new Date().toTimeString().slice(0, 8);
}

const EMPTY_TRIGGERED = { tp40: false, tp50: false, sl60: false };

// Terminal-only. Ported from the "AUTOPILOT SYSTEM" section of
// public/js/app.js: the heavy lifting (SL/TP milestone monitoring via Bybit
// WS) happens server-side (autopilot.js, via /api/autopilot/*); this hook
// just starts/stops it and polls /api/autopilot/status every 2s to mirror
// state into the UI, same cadence as the original apStartPolling().
export function useAutopilot() {
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState(null);
  const [triggered, setTriggered] = useState(EMPTY_TRIGGERED);
  const [livePrice, setLivePrice] = useState(0);
  const [logs, setLogs] = useState(() => [{ time: nowStr(), msg: 'Autopilot ready.', type: '' }]);

  const pollRef = useRef(null);
  const lastLogCountRef = useRef(0);

  const log = useCallback((msg, type = '') => {
    setLogs((l) => [...l, { time: nowStr(), msg, type }]);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const poll = useCallback(async () => {
    try {
      const doc = await api.get('/api/autopilot/status');
      if (!doc.running) {
        setRunning((prevRunning) => {
          if (prevRunning) {
            setPosition(null);
            stopPolling();
            log('Autopilot finished (server stopped).', 'warn');
          }
          return false;
        });
        return;
      }
      setRunning(true);
      setPosition({ ...doc.position, isLong: doc.position?.side === 'Buy' });
      setTriggered(doc.triggered || EMPTY_TRIGGERED);
      if (doc.livePrice > 0) setLivePrice(doc.livePrice);
      const logsArr = doc.logs || [];
      if (logsArr.length > lastLogCountRef.current) {
        logsArr.slice(lastLogCountRef.current).forEach((e) => {
          if (e.type === 'action' || e.type === 'ok' || e.type === 'warn') log(`[server] ${e.msg}`, e.type);
        });
        lastLogCountRef.current = logsArr.length;
      }
    } catch { /* transient — try again next tick */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    lastLogCountRef.current = 0;
    pollRef.current = setInterval(poll, 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async (snapshot) => {
    // snapshot: { sym, entry, sl, tp, side, size, lev? }
    await api.post('/api/autopilot/start', {
      sym: snapshot.sym, entry: snapshot.entry, sl: snapshot.sl, tp: snapshot.tp, side: snapshot.side, size: snapshot.size,
    });
    setPosition({ ...snapshot, initSl: snapshot.initSl ?? snapshot.sl, isLong: snapshot.side === 'Buy' });
    setTriggered(EMPTY_TRIGGERED);
    setRunning(true);
    startPolling();
    log(`Autopilot started for ${snapshot.sym} ${snapshot.side === 'Buy' ? 'LONG' : 'SHORT'}`, 'ok');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(async () => {
    stopPolling();
    try { await api.post('/api/autopilot/stop'); } catch { /* ignore */ }
    setRunning(false);
    setPosition(null);
    log('Autopilot stopped.', 'warn');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume display if the server was already running autopilot when this
  // page loads (e.g. page was refreshed / reopened). Ported from apCheckResume().
  const checkResume = useCallback(async () => {
    try {
      const doc = await api.get('/api/autopilot/status');
      if (!doc.running || !doc.position) return false;
      setRunning(true);
      setPosition({ ...doc.position, isLong: doc.position.side === 'Buy' });
      setTriggered(doc.triggered || EMPTY_TRIGGERED);
      lastLogCountRef.current = (doc.logs || []).length;
      startPolling();
      log(`Resumed: server is monitoring ${doc.position.symbol || doc.position.sym} ${doc.position.side === 'Buy' ? 'LONG' : 'SHORT'}`, 'ok');
      return true;
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  return { running, position, triggered, livePrice, logs, start, stop, checkResume };
}
