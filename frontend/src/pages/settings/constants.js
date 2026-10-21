// Full tradeable coin universe (ported from public/js/app.js's UNIVERSE array).
// 'ZILLUSDT' below was a typo in the original array (confirmed: Binance
// Futures returns {"code":-1121,"msg":"Invalid symbol."} for it, 400 on
// every scan cycle) — the real Zilliqa perpetual is ZILUSDT. Fixed here
// since it's a one-token, unambiguous correction; found while porting
// Scanner, which is the first page to actually fetch live klines for every
// symbol in this list and surfaced the bad ticker.
export const UNIVERSE = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOTUSDT', 'DOGEUSDT',
  'AVAXUSDT', 'LINKUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'NEARUSDT', 'FILUSDT', 'BCHUSDT',
  'XLMUSDT', 'VETUSDT', 'THETAUSDT', 'AXSUSDT', 'ETCUSDT', 'ALGOUSDT', 'SANDUSDT', 'MANAUSDT',
  'GALAUSDT', 'APEUSDT', 'GRTUSDT', 'AAVEUSDT', 'CHZUSDT', 'ENJUSDT', 'KAVAUSDT', 'RUNEUSDT',
  'STXUSDT', 'SUSHIUSDT', 'ZECUSDT', 'ZILUSDT', 'ICPUSDT', 'ARUSDT', 'COMPUSDT', 'CRVUSDT',
  'DYDXUSDT', 'EGLDUSDT', 'ENSUSDT', 'IMXUSDT', 'INJUSDT', 'LDOUSDT', 'MKRUSDT', 'OPUSDT',
  'RENDERUSDT', 'ROSEUSDT', 'RVNUSDT', 'SKLUSDT', 'TRXUSDT', 'YFIUSDT', '1INCHUSDT', 'CFXUSDT',
  'BANDUSDT', 'BATUSDT', 'CELRUSDT', 'DENTUSDT', 'PYTHUSDT', 'HOTUSDT', 'KNCUSDT', 'MASKUSDT',
  'NKNUSDT', 'ONTUSDT', 'QNTUSDT', 'TONUSDT', 'TIAUSDT', 'WIFUSDT', 'SUPERUSDT', 'HBARUSDT',
  'WOOUSDT', 'TRBUSDT', 'ANKRUSDT', 'CHRUSDT', 'SOLVUSDT', 'JUPUSDT', 'ORDIUSDT', 'TNSRUSDT',
  'HIVEUSDT', 'JSTUSDT', 'LPTUSDT', 'MINAUSDT', 'NMRUSDT', 'RLCUSDT', 'ACHUSDT', 'STRKUSDT',
  'TAOUSDT', 'BERAUSDT', 'HYPERUSDT', 'SEIUSDT', 'POLUSDT', 'PAXGUSDT', 'JTOUSDT', 'RSRUSDT',
  'PERPUSDT', 'ONDOUSDT', 'PHBUSDT', 'SXPUSDT', 'UMAUSDT', 'REZUSDT', 'ARPAUSDT', 'XTZUSDT',
  'MBOXUSDT', 'QTUMUSDT', 'KSMUSDT', 'ONEUSDT', 'COTIUSDT', 'FORMUSDT', 'TLMUSDT', 'PENGUUSDT',
  'BIOUSDT', 'SAGAUSDT', 'TRUMPUSDT', 'OMNIUSDT', 'NEOUSDT', 'DASHUSDT', 'C98USDT', 'BELLUSDT',
  'CTKUSDT', 'IOSTUSDT', 'FLOWUSDT', 'FETUSDT', 'AGIXUSDT', 'WLDUSDT', 'ARBUSDT', 'GMXUSDT',
  'APTUSDT', 'SUIUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BLURUSDT', 'PENDLEUSDT', 'CYBERUSDT', 'ARKMUSDT',
  'CELOUSDT', 'OCEANUSDT', 'IDUSDT', 'SFPUSDT', 'OMUSDT', 'RNDRUSDT', 'XVSUSDT', 'YGGUSDT',
  'HIGHUSDT', 'KEYUSDT', 'LINAUSDT', 'GTCUSDT', 'CTSIUSDT', 'DUSKUSDT', 'TOKENUSDT', 'VANRYUSDT',
];

export const DEFAULT_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOTUSDT', 'DOGEUSDT',
  'AVAXUSDT', 'LINKUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'NEARUSDT', 'FILUSDT', 'BCHUSDT',
  'XLMUSDT', 'VETUSDT', 'THETAUSDT', 'AXSUSDT', 'ETCUSDT', 'ALGOUSDT', 'SANDUSDT', 'MANAUSDT',
  'GALAUSDT', 'APEUSDT', 'GRTUSDT', 'AAVEUSDT', 'CHZUSDT', 'ENJUSDT', 'KAVAUSDT', 'RUNEUSDT',
  'STXUSDT', 'SUSHIUSDT', 'ZECUSDT', 'ZILUSDT', 'ICPUSDT', 'ARUSDT', 'COMPUSDT', 'CRVUSDT',
  'DYDXUSDT', 'EGLDUSDT', 'INJUSDT', 'LDOUSDT', 'MKRUSDT', 'OPUSDT', 'RENDERUSDT', 'ROSEUSDT',
  'TRXUSDT', 'YFIUSDT', '1INCHUSDT', 'CFXUSDT', 'BATUSDT', 'PYTHUSDT', 'KNCUSDT', 'MASKUSDT',
  'TONUSDT', 'TIAUSDT', 'WIFUSDT', 'SUPERUSDT', 'HBARUSDT', 'TRBUSDT', 'ANKRUSDT', 'SOLVUSDT',
  'JUPUSDT', 'ORDIUSDT', 'TNSRUSDT', 'LPTUSDT', 'MINAUSDT', 'STRKUSDT', 'TAOUSDT', 'SEIUSDT',
  'POLUSDT', 'PAXGUSDT', 'JTOUSDT', 'PERPUSDT', 'ONDOUSDT', 'SXPUSDT', 'XTZUSDT', 'NEOUSDT',
  'PENGUUSDT', 'SAGAUSDT', 'TRUMPUSDT', 'FETUSDT', 'ARBUSDT', 'APTUSDT', 'SUIUSDT', 'PEPEUSDT',
  'WLDUSDT', 'GMXUSDT', 'FLOKIUSDT', 'OCEANUSDT', 'PENDLEUSDT', 'CYBERUSDT',
];

export const FILTER_TOGGLES = [
  { id: 'fAll', label: 'All', color: '#4a5568' },
  { id: 'fOB', label: 'RSI Overbought', color: '#f56565' },
  { id: 'fOS', label: 'RSI Oversold', color: '#48bb78' },
  { id: 'fRDiv', label: 'RSI Divergence', color: '#f6ad55' },
  { id: 'fMDiv', label: 'MACD Divergence', color: '#63b3ed' },
  { id: 'fMXBull', label: 'MACD Bull Cross', color: '#29ffb8' },
  { id: 'fMXBear', label: 'MACD Bear Cross', color: '#fc8181' },
  { id: 'fRsiGolden', label: 'RSI Golden Cross', color: '#ffd700' },
  { id: 'fRsiDeath', label: 'RSI Death Cross', color: '#c0392b' },
];
