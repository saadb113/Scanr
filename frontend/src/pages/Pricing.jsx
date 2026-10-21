import MarketingLayout from '../components/MarketingLayout';
import FadeIn from '../components/FadeIn';
import { useLifetimePrice } from '../hooks/useLifetimePrice';
import './Pricing.css';

export default function Pricing() {
  const { lifetime, discountLabel } = useLifetimePrice();

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

  const display = Number(lifetime.displayPrice || lifetime.original || 49);
  const hasDiscount = lifetime.discounted !== null && lifetime.discountPct !== null;

  return (
    <MarketingLayout>
      <FadeIn as="section" className="pricing-hero">
        <div className="lp-chip">✦ Transparent Pricing</div>
        <h1>Simple Pricing.<br />No Surprises.</h1>
        <p>One payment. Lifetime access to every feature and every future update — no subscriptions, ever.</p>
      </FadeIn>

      <div className="pricing-wrap">
        <div className="pricing-grid">
          {/* FREE TIER */}
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
            <a className="lp-wa-btn" href="/register?plan=free">Get Started Free</a>
          </FadeIn>

          {/* PREMIUM TIER */}
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
            <button className="lp-wa-btn premium" onClick={handleUpgradeClick}>🚀 Upgrade to Premium</button>
          </FadeIn>
        </div>

        <FadeIn className="pricing-below">
          <p className="pc-signin">Already have a license key? <a href="/login">Sign in →</a></p>
          <div className="pc-note">Have questions before purchasing? Email us at support@scanr.me — we're happy to help.</div>
        </FadeIn>
      </div>

      <div className="trust-section">
        <FadeIn as="p" className="trust-heading">Why Traders Choose <span className="lp-logo-text">Scanr</span></FadeIn>
        <FadeIn as="p" className="trust-sub">No tiers, no limits, no surprises.</FadeIn>
        <div className="trust-grid">
          <FadeIn className="trust-item">
            <div className="trust-icon">∞</div>
            <h4>Lifetime Access</h4>
            <p>Pay once and use the platform forever. All future features included at no extra cost.</p>
          </FadeIn>
          <FadeIn className="trust-item">
            <div className="trust-icon">🚀</div>
            <h4>Always Updated</h4>
            <p>New features ship regularly. Your license gives access to every update automatically.</p>
          </FadeIn>
          <FadeIn className="trust-item">
            <div className="trust-icon">🔒</div>
            <h4>Secure by Design</h4>
            <p>Device fingerprinting, single-session enforcement, and encrypted API keys protect you.</p>
          </FadeIn>
          <FadeIn className="trust-item">
            <div className="trust-icon">📧</div>
            <h4>Direct Support</h4>
            <p>Email support from the team. Fast responses, hands-on help through setup and beyond.</p>
          </FadeIn>
        </div>
      </div>
    </MarketingLayout>
  );
}
