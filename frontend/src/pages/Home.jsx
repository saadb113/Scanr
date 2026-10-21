import { useState } from 'react';
import MarketingLayout from '../components/MarketingLayout';
import FadeIn from '../components/FadeIn';
import { api } from '../api/client';
import { useLifetimePrice } from '../hooks/useLifetimePrice';
import './Home.css';

const FAQS = [
  { q: 'What exchanges are supported?', a: "Currently Bybit (mainnet and testnet) is fully supported for both spot and linear perpetuals. The platform uses Bybit's V5 API for all market data, order placement, and position management." },
  { q: 'Do I need coding knowledge?', a: 'No coding knowledge is required. The platform is entirely web-based with a clean dashboard interface. You just need a Bybit account and API keys — the setup guide walks you through everything step by step.' },
  { q: 'Is this a monthly subscription?', priceAnswer: true },
  { q: 'What is a license key?', a: 'After purchasing, you will receive a unique license key. You enter this key once when activating your account. It unlocks full platform access permanently and is tied to your account.' },
  { q: 'Is my API key safe?', a: 'Yes. Your Bybit API keys are stored encrypted per-user in the database and are never exposed in the browser or public endpoints. All Bybit requests are made server-side with proper HMAC authentication.' },
  { q: 'Can I use this on mobile?', a: 'Yes, the platform is fully responsive and works on mobile browsers. However, for the best experience — especially when using the scanner and terminal — a desktop or laptop is recommended.' },
  { q: 'What if I need help setting up?', a: 'We provide a full setup guide at /setup-guide covering everything from Bybit API setup to scanner configuration. You can also reach us directly via Email for personal, one-on-one assistance.' },
  { q: 'Do I need to know coding to use the strategy builder?', a: 'No. The strategy builder is fully visual — drag and drop blocks to build your strategy. No coding knowledge required at all.' },
  { q: 'Which AI model should I use?', a: "Start with GLM-4.7-Flash — it's completely free and works great for trade analysis. Upgrade to Kimi K2 or Claude Sonnet if you want higher quality analysis." },
  { q: 'How do Discord alerts work?', a: "Create a webhook URL in your Discord channel (takes 30 seconds), paste it in Settings → Integrations → Discord. You'll receive formatted alerts for every trade event." },
  { q: 'Can the strategy bot trade automatically?', a: 'Yes. Build your strategy using blocks, save it, and activate the bot. It monitors your configured coins and places trades on Bybit automatically when your conditions are met.' },
  { q: 'Is the strategy bot safe to use?', a: 'The bot has built-in guardrails: Custom max trades per day, daily drawdown limit, and only 1 position at a time. It cannot exceed these limits.' },
];

function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [msg, setMsg] = useState(null); // { text, ok }
  const [sending, setSending] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    const { name, email, phone, message } = form;
    if (!name.trim() || !email.trim() || !message.trim()) {
      setMsg({ text: 'Please fill in Name, Email and Message.', ok: false });
      return;
    }
    setSending(true);
    setMsg(null);
    try {
      await api.post('/api/public/contact', { name: name.trim(), email: email.trim(), phone: phone.trim(), message: message.trim() });
      setMsg({ text: "Message sent! We'll get back to you on Email shortly.", ok: true });
      setForm({ name: '', email: '', phone: '', message: '' });
    } catch {
      setMsg({ text: 'Could not send message. Please contact us directly on Email.', ok: false });
    } finally {
      setSending(false);
    }
  }

  return (
    <FadeIn className="contact-card">
      <div className="form-row-2">
        <div className="form-group">
          <label>Full Name *</label>
          <input type="text" placeholder="John Doe" value={form.name} onChange={(e) => update('name', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Email *</label>
          <input type="email" placeholder="john@example.com" value={form.email} onChange={(e) => update('email', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Phone (optional)</label>
        <input type="tel" placeholder="+1 234 567 8900" value={form.phone} onChange={(e) => update('phone', e.target.value)} />
      </div>
      <div className="form-group">
        <label>Message *</label>
        <textarea rows={4} placeholder="Tell us how we can help…" value={form.message} onChange={(e) => update('message', e.target.value)} />
      </div>
      <button className="form-submit" disabled={sending} onClick={handleSubmit}>{sending ? 'Sending…' : 'Send Message'}</button>
      {msg && <div className={`form-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
    </FadeIn>
  );
}

export default function Home() {
  const { lifetime, discountLabel } = useLifetimePrice();
  const display = Number(lifetime.displayPrice || lifetime.original || 49);
  const hasDiscount = lifetime.discounted !== null && lifetime.discountPct !== null;

  async function handleUpgradeClick() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        window.location.href = '/payment?plan=lifetime'; // not migrated yet
      } else {
        window.location.href = '/register?plan=free';
      }
    } catch {
      window.location.href = '/register?plan=free';
    }
  }

  return (
    <MarketingLayout>
      <section className="hero-section">
        <div className="hero-content">
          <div className="hero-badge"><span className="hero-badge-dot" />AI-Powered Trading Platform</div>
          <h1 className="hero-h1">Trade Smarter.<br /><em>Not Harder.</em></h1>
          <p className="hero-p">AI-powered Professional crypto scanner built for serious traders.</p>
          <div className="hero-btns">
            <a href="/register?plan=lifetime&redirect=payment" className="btn-lg filled">Get Started →</a>
            <a href="/features" className="btn-lg outline">View Features</a>
          </div>
        </div>
      </section>

      <div className="stats-bar">
        <div className="stats-bar-inner">
          <div className="stat-item"><div className="stat-value">100+</div><div className="stat-label">Coins Monitored</div></div>
          <div className="stat-item"><div className="stat-value">3</div><div className="stat-label">AI Models Supported</div></div>
          <div className="stat-item"><div className="stat-value">No-Code</div><div className="stat-label">Strategy Builder</div></div>
          <div className="stat-item"><div className="stat-value">Bybit</div><div className="stat-label">Integration + Discord Alerts</div></div>
        </div>
      </div>

      <section className="lp-section">
        <div className="lp-section-inner">
          <FadeIn as="span" className="lp-label">What We Offer</FadeIn>
          <FadeIn as="h2" className="lp-h2">Built for Serious Traders</FadeIn>
          <FadeIn as="p" className="lp-sub">From real-time scanning to automated execution — every tool you need to trade with an edge.</FadeIn>
          <div className="feature-cards">
            <FadeIn className="feature-card">
              <span className="fc-icon">🔍</span>
              <h3>Smart Scanner</h3>
              <p>Scan 100+ coins simultaneously with RSI, MACD, divergence detection and hard filter setup finder. Find high quality setups in seconds.</p>
            </FadeIn>
            <FadeIn className="feature-card">
              <span className="fc-icon">🧑‍💻</span>
              <h3>No-Code Strategy Builder</h3>
              <p>Build your own trading bot using drag and drop blocks — no coding required. Set conditions, actions, and let the bot trade automatically on Bybit.</p>
            </FadeIn>
            <FadeIn className="feature-card">
              <span className="fc-icon">📊</span>
              <h3>Setup Finder</h3>
              <p>Hard filter scanner finds only the highest quality tradeable setups using volume, ATR, trend alignment, and RSI confluence filters.</p>
            </FadeIn>
          </div>
        </div>
      </section>

      <div className="hiw-bg">
        <section className="lp-section">
          <div className="lp-section-inner">
            <FadeIn as="span" className="lp-label">Getting Started</FadeIn>
            <FadeIn as="h2" className="lp-h2">How It Works</FadeIn>
            <FadeIn as="p" className="lp-sub">Three steps from setup to your first automated trade.</FadeIn>
            <div className="steps-grid">
              <FadeIn className="home-step">
                <div className="step-badge">1</div>
                <h3>Scan the Market</h3>
                <p>Launch the real-time scanner and get instant signals across 100+ coins. RSI, MACD, divergences — all surfaced in one view, live.</p>
              </FadeIn>
              <FadeIn className="home-step">
                <div className="step-badge">2</div>
                <h3>Analyze with AI</h3>
                <p>Click any coin to get a full AI trade plan in seconds. Direction, entry, SL, TP, and risk:reward — powered by Kimi AI with inline indicators.</p>
              </FadeIn>
              <FadeIn className="home-step">
                <div className="step-badge">3</div>
                <h3>Build, Automate &amp; Get Alerted</h3>
                <p>Place trades manually or build a no-code strategy bot. Get Discord alerts for every trade event in real time.</p>
              </FadeIn>
            </div>
          </div>
        </section>
      </div>

      <section className="lp-section lp-section-center">
        <div className="lp-section-inner">
          <FadeIn as="span" className="lp-label">Simple Pricing</FadeIn>
          <FadeIn as="h2" className="lp-h2">Choose Your Plan</FadeIn>
          <FadeIn as="p" className="lp-sub">Start free, upgrade anytime. No hidden fees or subscriptions.</FadeIn>
          <div className="home-pricing-grid">
            <FadeIn className="pricing-card free">
              <div className="pc-badge free">Free</div>
              <div className="pc-free-amount">$0</div>
              <p className="pc-period">forever</p>
              <hr className="pc-divider" />
              <ul className="pc-features dim">
                <li><span className="pc-check">✓</span>Coin scanner</li>
                <li><span className="pc-check">✓</span>Price alerts &amp; Discord alerts</li>
                <li><span className="pc-check">✓</span>Challenge tracker</li>
                <li><span className="pc-check">✓</span>3 Free AI Analysis/Day</li>
                <li className="excluded">✗ Live trading terminal (Spot &amp; Futures)</li>
                <li className="excluded">✗ Strategy builder</li>
                <li className="excluded">✗ Strategy automation bot</li>
                <li className="excluded">✗ Apex Setup Scanner</li>
              </ul>
              <a className="home-wa-btn" href="/register?plan=free">Get Started Free</a>
            </FadeIn>

            <FadeIn className="pricing-card premium">
              <div className="pc-popular">★ POPULAR</div>
              <div className="pc-badge">Lifetime Access</div>
              {hasDiscount && <div className="pc-discount-badge">{lifetime.discountPct}% OFF</div>}
              {hasDiscount && <div className="pc-original">${Number(lifetime.original).toFixed(2)}</div>}
              <div className="pc-price-row">
                <span className="pc-currency">$</span>
                <span className="pc-amount">{display}</span>
              </div>
              {hasDiscount && <div className="pc-sale-label">{discountLabel}</div>}
              <p className="pc-period">one time payment</p>
              <hr className="pc-divider" />
              <ul className="pc-features">
                <li><span className="pc-check">✓</span>Coin scanner</li>
                <li><span className="pc-check">✓</span>Price alerts &amp; Discord alerts</li>
                <li><span className="pc-check">✓</span>Challenge tracker</li>
                <li><span className="pc-check">✓</span>Unlimited AI Analysis</li>
                <li><span className="pc-check">✓</span>Live trading terminal (Spot &amp; Futures)</li>
                <li><span className="pc-check">✓</span>Strategy builder</li>
                <li><span className="pc-check">✓</span>Strategy automation bot</li>
                <li><span className="pc-check">✓</span>Apex Setup Scanner</li>
                <li><span className="pc-check">✓</span>All future updates</li>
              </ul>
              <button className="home-wa-btn premium" onClick={handleUpgradeClick}>🚀 Upgrade to Premium</button>
            </FadeIn>
          </div>
        </div>
      </section>

      <section className="lp-section lp-section-center" style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="lp-section-inner">
          <FadeIn as="span" className="lp-label">Support</FadeIn>
          <FadeIn as="h2" className="lp-h2">Frequently Asked Questions</FadeIn>
          <FadeIn as="p" className="lp-sub">Everything you need to know before getting started.</FadeIn>
          <div className="faq-wrap">
            {FAQS.map((f) => (
              <FadeIn as="details" key={f.q}>
                <summary>{f.q}</summary>
                <div className="faq-body">{f.priceAnswer ? `No. Scanr is a one-time payment of $${display.toFixed(2)} for lifetime access. There are no monthly fees, no renewal charges, and all future updates are included at no extra cost.` : f.a}</div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section lp-section-center" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="lp-section-inner">
          <FadeIn as="span" className="lp-label">Reach Out</FadeIn>
          <FadeIn as="h2" className="lp-h2">Get In Touch</FadeIn>
          <FadeIn as="p" className="lp-sub">Have questions before purchasing? Send us a message and we will reply on your Email shortly.</FadeIn>
          <ContactForm />
        </div>
      </section>
    </MarketingLayout>
  );
}
