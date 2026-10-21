import MarketingLayout from '../components/MarketingLayout';
import FadeIn from '../components/FadeIn';
import './Features.css';

const GROUPS = [
  {
    icon: '🔍', title: 'Scanner', subtitle: 'Real-time multi-coin signal detection', alt: false,
    items: [
      { icon: '🔍', title: 'Real-time Coin Scanner', body: 'Scan 100+ coins simultaneously. See RSI, MACD, divergences, and signals on live canvas charts.' },
      { icon: '📊', title: 'Setup Finder', body: 'Hard filter scanner finds only the highest quality tradeable setups using volume, ATR, trend alignment, and RSI confluence filters.' },
      { icon: '🧭', title: 'Multi-timeframe Analysis', body: 'View 4H, 1H, and 5m charts in one click. Understand the full picture before entering.' },
    ],
  },
  {
    icon: '⚡', title: 'Trading', subtitle: 'Full Bybit terminal with autopilot execution', alt: true,
    items: [
      { icon: '⚡', title: 'Bybit Integration', body: 'Full Bybit Spot and Futures trading terminal. Place orders, manage positions, set SL/TP all from one place.' },
      { icon: '🎯', title: 'Multiple Order Types', body: 'Market, Limit orders with QTY, Cost, Margin and Risk% position sizing modes.' },
      { icon: '🤖', title: 'Autopilot Mode', body: 'Activate autopilot on any open position. Automatically moves SL to breakeven at 50% to TP, manages milestones hands-free.' },
    ],
  },
  {
    icon: '🤖', title: 'AI Analysis', subtitle: 'Three AI models for instant trade recommendations', alt: false,
    items: [
      { icon: '🎐', title: 'GLM-4.7-Flash — Free', body: 'Completely free AI analysis with no daily limits. Perfect for getting started. Fast, reliable, great for structured trade analysis.' },
      { icon: '⚡', title: 'Kimi K2 — Best for Trading', body: 'Kimi K2 is specifically strong at financial reasoning and chart analysis. Best accuracy for trade setups at very low cost.' },
      { icon: '👑', title: 'Claude Sonnet — Premium', body: "Anthropic's Claude Sonnet offers the highest reasoning quality for complex multi-timeframe analysis. Premium results for serious traders." },
    ],
  },
  {
    icon: '📅', title: 'Tracking', subtitle: 'Performance, discipline, and challenge monitoring', alt: true,
    items: [
      { icon: '📅', title: 'PnL Calendar', body: 'See every trading day visualized. Green days, red days, track your consistency over time.' },
      { icon: '🏆', title: 'Prop Firm Challenge', body: 'Track your funded account challenge progress. Daily drawdown meter, profit target progress, pass/fail status in real time.' },
    ],
  },
  {
    icon: '🔒', title: 'Security', subtitle: 'Enterprise-grade account and session protection', alt: false,
    items: [
      { icon: '🔒', title: 'License Key System', body: 'Each account requires a valid license key. Your account is protected and non-transferable.' },
      { icon: '👤', title: 'Single Session Security', body: 'Only one active session per account at a time. Automatic session kick if account is accessed from another device.' },
    ],
  },
  {
    icon: '🧑‍💻', title: 'No-Code Strategy Builder', subtitle: 'Build, backtest and automate trading strategies without coding', alt: true,
    items: [
      { icon: '🧑‍💻', title: 'Visual Drag & Drop Builder', body: 'Build complex trading strategies using blocks — just like Scratch. No coding required. Drag conditions, actions and risk management blocks onto the canvas.' },
      { icon: '🔀', title: 'IF / ELSE IF Logic', body: 'Build strategies that handle both longs and shorts in one place. IF RSI oversold AND 4H bullish → Enter Long. ELSE IF RSI overbought AND 4H bearish → Enter Short.' },
      { icon: '📜', title: 'Pine Script Export', body: 'Export any strategy as Pine Script with one click. Paste directly into TradingView Strategy Tester to backtest on historical data.' },
      { icon: '🤖', title: 'Live Strategy Bot', body: 'Save your strategy and activate it as a live bot. Monitors all your coins 24/7, places trades on Bybit automatically when conditions are met. One position at a time, fully controlled.' },
    ],
  },
  {
    icon: '🔔', title: 'Discord Alerts', subtitle: 'Real-time trade notifications delivered to your Discord', alt: false,
    items: [
      { icon: '💬', title: 'Discord Webhook Integration', body: 'Connect your Discord in 30 seconds using a webhook URL. No bot setup, no coding, no approval needed. Just paste your webhook and go.' },
      { icon: '💰', title: 'Price Alerts', body: 'Set price targets on any coin. Get a Discord notification the moment price hits your target. Each alert fires once — no spam.' },
      { icon: '📋', title: 'Order Notifications', body: 'Every order you place sends a detailed Discord embed with symbol, direction, entry, SL, TP and quantity.' },
      { icon: '🎯', title: 'TP / SL Hit Alerts', body: 'Never miss a trade result. Get notified instantly when your position closes by hitting TP or SL.' },
      { icon: '🤖', title: 'Autopilot Milestone Alerts', body: 'Get notified when autopilot moves your SL to breakeven or hits any milestone — stay informed even when away from screen.' },
    ],
  },
];

export default function Features() {
  return (
    <MarketingLayout>
      <div className="feat-hero">
        <div className="feat-hero-inner">
          <span className="lp-label">Platform Features</span>
          <h1>Everything You Need to<br />Trade Professionally</h1>
          <p>Built for serious crypto traders who want an edge in the market.</p>
        </div>
      </div>

      {GROUPS.map((g) => (
        <FadeIn key={g.title} className={`fg-wrap${g.alt ? ' alt' : ''}`}>
          <div className="fg-inner">
            <div className="fg-head">
              <div className="fg-icon">{g.icon}</div>
              <div>
                <div className="fg-title">{g.title}</div>
                <div className="fg-subtitle">{g.subtitle}</div>
              </div>
            </div>
            <div className="fg-grid">
              {g.items.map((it) => (
                <div className="fg-item" key={it.title}>
                  <div className="fg-item-icon">{it.icon}</div>
                  <div className="fg-item-body">
                    <h4>{it.title}</h4>
                    <p>{it.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      ))}

      <div className="cta-section">
        <FadeIn as="h2">Ready to Start Trading Smarter?</FadeIn>
        <FadeIn as="p">Get lifetime access to every feature above — one payment, no subscriptions, forever.</FadeIn>
        <FadeIn className="cta-btns">
          <a href="/pricing" className="btn-lg filled">Get Lifetime Access →</a>
          <a href="/setup-guide" className="btn-lg outline">Setup Guide</a>
        </FadeIn>
      </div>
    </MarketingLayout>
  );
}
