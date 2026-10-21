import MarketingLayout from '../components/MarketingLayout';
import './MarketingDoc.css';

export default function Terms() {
  return (
    <MarketingLayout>
      <div className="page-hero">
        <h1>Terms of Service</h1>
        <p>Last updated: March 2026</p>
        <span className="reading-time">5 min read</span>
      </div>

      <div className="doc-wrap">
        <div className="doc-inner">
          <a href="/" className="doc-back">← Back to Home</a>

          <div className="doc-section">
            <h2>1. Acceptance of Terms</h2>
            <p>By purchasing or using Scanr, you agree to these terms. If you do not agree, do not use the service.</p>
          </div>

          <div className="doc-section">
            <h2>2. License</h2>
            <p>Scanr grants you a non-transferable, non-exclusive license to use the software. One license = one user account. Sharing, reselling or distributing your license key is prohibited.</p>
          </div>

          <div className="doc-section">
            <h2>3. Payment &amp; Refunds</h2>
            <p>All payments are final. Due to the digital nature of the product, we do not offer refunds once a license key has been issued. Contact support before purchasing if you have questions.</p>
          </div>

          <div className="doc-section">
            <h2>4. Demo Mode</h2>
            <p>We strongly recommend testing all features in demo mode before connecting real funds. Scanr is a tool — trading decisions and outcomes are your responsibility.</p>
          </div>

          <div className="doc-section">
            <h2>5. Financial Disclaimer</h2>
            <p>Scanr is a trading tool, not financial advice. We are not responsible for any financial losses incurred while using the platform. Crypto and forex trading involves significant risk. Only trade with money you can afford to lose.</p>
          </div>

          <div className="doc-section">
            <h2>6. Strategy Bot</h2>
            <p>The Strategy Bot is an automated tool in beta. Past performance does not guarantee future results. Always monitor bots and use demo mode first. We are not liable for any losses caused by automated trading.</p>
          </div>

          <div className="doc-section">
            <h2>7. Account Suspension</h2>
            <p>We reserve the right to suspend or terminate your license without refund if you violate these terms, attempt to reverse engineer the software, or abuse the platform.</p>
          </div>

          <div className="doc-section">
            <h2>8. Service Availability</h2>
            <p>We aim for 24/7 uptime but do not guarantee uninterrupted service. Maintenance, updates or third party API issues (Binance, Bybit) may cause temporary downtime.</p>
          </div>

          <div className="doc-section">
            <h2>9. Changes to Terms</h2>
            <p>We may update these terms at any time. Continued use of Scanr after changes means you accept the new terms.</p>
          </div>

          <div className="doc-section">
            <h2>10. Contact</h2>
            <p>For any questions contact us via email (link from admin settings) or through the contact form on our website.</p>
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
