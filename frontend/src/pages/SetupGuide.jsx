import MarketingLayout from '../components/MarketingLayout';
import FadeIn from '../components/FadeIn';
import { useLifetimePrice } from '../hooks/useLifetimePrice';
import './SetupGuide.css';

const FAQS = [
  { q: 'What exchanges are supported?', a: 'Currently Bybit (Spot and Futures). More exchanges are coming in future updates.' },
  { q: 'Do I need coding knowledge?', a: "No. The app is fully web-based. Just enter your API keys in settings and you're ready to trade." },
  { q: 'Is this a monthly subscription?', priceAnswer: true },
  { q: 'What is a license key?', a: 'After purchase you receive a unique license key. Enter it on first login to activate your account. Each key is tied to a single account.' },
  { q: 'Is my API key safe?', a: 'Yes. Your Bybit API keys are stored encrypted in your account and never shared with anyone. All Bybit requests are signed server-side.' },
  { q: 'Can I use this on mobile?', a: 'Yes. The app is fully responsive and works on all devices including phones and tablets.' },
  { q: 'What if I need help setting up?', a: 'This setup guide covers everything you need. You can also contact us directly on Email for hands-on assistance — we respond fast.' },
  { q: 'Do I need to know coding to use the strategy builder?', a: 'No. The strategy builder is fully visual — drag and drop blocks to build your strategy. No coding knowledge required at all.' },
  { q: 'Which AI model should I use?', a: "Start with GLM-4.7-Flash — it's completely free and works great for trade analysis. Upgrade to Kimi K2 or Claude Sonnet if you want higher quality analysis." },
  { q: 'How do Discord alerts work?', a: "Create a webhook URL in your Discord channel (takes 30 seconds), paste it in Settings → Integrations → Discord. You'll receive formatted alerts for every trade event." },
  { q: 'Can the strategy bot trade automatically?', a: 'Yes. Build your strategy using blocks, save it, and activate the bot. It monitors your configured coins and places trades on Bybit automatically when your conditions are met.' },
  { q: 'Is the strategy bot safe to use?', a: 'The bot has built-in guardrails: max 3 trades per day, 5% daily drawdown limit, and only 1 position at a time. It cannot exceed these limits.' },
];

export default function SetupGuide() {
  const { lifetime } = useLifetimePrice();
  const price = Number(lifetime.displayPrice || lifetime.original || 49).toFixed(2);

  return (
    <MarketingLayout>
      <FadeIn as="section" className="guide-hero">
        <div className="lp-chip">✦ Quick Setup</div>
        <h1>Get Started in Minutes</h1>
        <p>Follow these 6 steps to set up your account, connect Bybit, and start trading with AI-powered analysis.</p>
      </FadeIn>

      <div className="steps-section">
        <FadeIn className="step-card">
          <div className="step-num-wrap"><div className="step-num">1</div></div>
          <div className="step-body">
            <div className="step-title">Purchase &amp; License Key</div>
            <p className="step-desc">After payment you will receive a unique license key on your dashboard. Keep it safe.</p>
            <ul className="step-list">
              <li>Register at <a href="/register?plan=lifetime&redirect=payment">/register</a></li>
              <li>You will be redirected to the payment page automatically</li>
              <li>Send USDT to the wallet address shown</li>
              <li>Submit your Transaction ID and screenshot as payment proof</li>
              <li>Wait for verification — Once verified, your payment page updates automatically and you get the license key</li>
              <li>Click "Activate License", paste the key and you're in</li>
            </ul>
            <div className="step-note"><strong>No key yet?</strong>&nbsp;Purchase on the <a href="/pricing">Pricing page</a> — ${price} lifetime access.</div>
          </div>
        </FadeIn>
        <div className="step-connector" />

        <FadeIn className="step-card">
          <div className="step-num-wrap"><div className="step-num">2</div></div>
          <div className="step-body">
            <div className="step-title">Connect Bybit</div>
            <p className="step-desc">Connect your Bybit account to start trading.</p>
            <div className="step-intro">Go to Settings → Bybit tab</div>
            <ul className="step-list">
              <li>Create API key on Bybit: bybit.com → Profile → API Management → Create</li>
              <li>Enable permissions: <strong>Read</strong> and <strong>Trade</strong></li>
              <li>Copy your API Key and Secret</li>
              <li>Paste in Settings → Bybit tab</li>
              <li>Toggle Testnet <strong>OFF</strong> for live trading</li>
              <li>Click Save → Test Connection</li>
            </ul>
          </div>
        </FadeIn>
        <div className="step-connector" />

        <FadeIn className="step-card">
          <div className="step-num-wrap"><div className="step-num">3</div></div>
          <div className="step-body">
            <div className="step-title">Choose Your AI Model <span className="optional">(Optional)</span></div>
            <p className="step-desc">Three AI models available — pick one for instant trade analysis with entry, SL, TP, and reasoning.</p>
            <ul className="step-list">
              <li><strong>GLM-4.7-Flash (Free):</strong> Go to <a href="https://open.bigmodel.cn" target="_blank" rel="noopener">open.bigmodel.cn</a> → Sign up free → Get API key → paste in Settings → Integrations → AI Analysis → Select GLM-4.7-Flash → Save</li>
              <li><strong>Kimi K2:</strong> Go to <a href="https://platform.moonshot.ai" target="_blank" rel="noopener">platform.moonshot.ai</a> → Sign up → Create API key → paste in Settings → Integrations → AI Analysis → Select Kimi K2 → Save</li>
              <li><strong>Claude Sonnet:</strong> Go to <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> → Sign up (free credits) → Create API key → paste in Settings → Integrations → AI Analysis → Select Claude Sonnet → Save</li>
            </ul>
            <div className="step-note"><strong>Tip:</strong>&nbsp;Start with GLM-4.7-Flash — it's completely free and works great. Upgrade to Kimi K2 or Claude Sonnet for higher quality.</div>
          </div>
        </FadeIn>
        <div className="step-connector" />

        <FadeIn className="step-card">
          <div className="step-num-wrap"><div className="step-num">4</div></div>
          <div className="step-body">
            <div className="step-title">Add Your Coins</div>
            <p className="step-desc">Configure which coins the scanner monitors.</p>
            <ul className="step-list">
              <li>Go to Settings → Coins tab</li>
              <li>Add coins you want to scan (e.g. SOLUSDT, LINKUSDT, AVAXUSDT)</li>
              <li>Click Save</li>
            </ul>
          </div>
        </FadeIn>
        <div className="step-connector" />

        <FadeIn className="step-card">
          <div className="step-num-wrap"><div className="step-num">5</div></div>
          <div className="step-body">
            <div className="step-title">Start Scanning</div>
            <p className="step-desc">Find your first setup.</p>
            <ul className="step-list">
              <li>Go to the <strong>Scanner</strong> page</li>
              <li>Cards will load showing all your coins with live signals</li>
              <li>Look for Bull Div, Bear Div, OB, OS signals</li>
              <li>Or click <strong>Scan Setups</strong> for filtered, high-quality opportunities</li>
            </ul>
          </div>
        </FadeIn>
        <div className="step-connector" />

        <FadeIn className="step-card">
          <div className="step-num-wrap"><div className="step-num">6</div></div>
          <div className="step-body">
            <div className="step-title">Place Your First Trade</div>
            <p className="step-desc">Execute a trade directly from the terminal.</p>
            <ul className="step-list">
              <li>Go to the <strong>Terminal</strong> page</li>
              <li>Search for a coin using the symbol input</li>
              <li>Analyze the TradingView chart</li>
              <li>Click <strong>Analyze with AI</strong> for a trade suggestion</li>
              <li>Fill the order form or click <strong>Apply from AI</strong></li>
              <li>Click <strong style={{ color: 'var(--accent)' }}>Place Order</strong></li>
            </ul>
          </div>
        </FadeIn>
        <div className="step-connector" />

        <FadeIn className="step-card">
          <div className="step-num-wrap"><div className="step-num">7</div></div>
          <div className="step-body">
            <div className="step-title">Connect Discord Alerts <span className="optional">(Optional)</span></div>
            <p className="step-desc">Receive trade notifications directly in Discord.</p>
            <ul className="step-list">
              <li>Open Discord → go to any channel</li>
              <li>Click ⚙️ Edit Channel → Integrations → Webhooks</li>
              <li>Click <strong>New Webhook</strong> → Copy Webhook URL</li>
              <li>In Scanr → Settings → Integrations → Discord</li>
              <li>Paste webhook URL → Send Test Message</li>
              <li>Turn on alert toggles you want → Save</li>
            </ul>
            <div className="step-note"><strong>Takes 30 seconds:</strong>&nbsp;No bot setup, no coding, no approval needed. Just paste your webhook and go.</div>
          </div>
        </FadeIn>
        <div className="step-connector" />

        <FadeIn className="step-card">
          <div className="step-num-wrap"><div className="step-num">8</div></div>
          <div className="step-body">
            <div className="step-title">Build Your First Strategy Bot <span className="optional">(Optional)</span></div>
            <p className="step-desc">Build a no-code trading bot that monitors coins and places trades automatically on Bybit.</p>
            <ul className="step-list">
              <li>Go to <strong>Strategy Builder</strong> in navigation</li>
              <li>Click <strong>New Strategy</strong></li>
              <li>Drag filter blocks into the Filters section (Volume Spike, Trading Hours)</li>
              <li>In the IF block drag entry conditions (RSI Value, Trend 4H)</li>
              <li>In the THEN section drag Enter Long + SL + TP blocks</li>
              <li>Click <strong>+ Add ELSE IF</strong> for short conditions</li>
              <li>Click <strong>Save Strategy</strong></li>
              <li>Click <strong>Export Pine Script</strong> to backtest on TradingView</li>
              <li>When ready → select strategy → click <strong style={{ color: 'var(--accent)' }}>Activate Bot</strong></li>
            </ul>
          </div>
        </FadeIn>
      </div>

      <div className="faq-section">
        <div className="faq-inner">
          <FadeIn as="div" className="faq-label">FAQ</FadeIn>
          <FadeIn as="div" className="faq-title">Frequently Asked Questions</FadeIn>
          <FadeIn as="p" className="faq-sub">Everything you need to know before getting started.</FadeIn>

          {FAQS.map((f) => (
            <FadeIn as="details" key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.priceAnswer ? `No. One time payment of $${price} gives you lifetime access to all current and future features.` : f.a}</p>
            </FadeIn>
          ))}
        </div>
      </div>

      <div className="guide-cta">
        <FadeIn className="cta-box">
          <h2>Need help? Contact us directly.</h2>
          <p>We're available to help you get set up and answer any questions.</p>
          <a className="guide-wa-btn" href="mailto:support@scanr.me?subject=Setup%20Help">📧 Contact Us</a>
        </FadeIn>
      </div>
    </MarketingLayout>
  );
}
