import MarketingLayout from '../components/MarketingLayout';
import './MarketingDoc.css';

export default function Refund() {
  return (
    <MarketingLayout>
      <div className="page-hero">
        <h1>Refund Policy</h1>
        <p>Last updated: March 2026</p>
        <span className="reading-time">5 min read</span>
      </div>

      <div className="doc-wrap">
        <div className="doc-inner">
          <a href="/" className="doc-back">← Back to Home</a>

          <div className="doc-section">
            <h2>Our Stance on Refunds</h2>
            <p>Scanr is a digital software product. Due to the nature of digital goods, all sales are final once a license key has been issued and activated.</p>
          </div>

          <div className="doc-section">
            <h2>1. No Refund Policy</h2>
            <p>We do not offer refunds once:</p>
            <ul>
              <li>A license key has been generated and sent to you</li>
              <li>The license key has been activated on an account</li>
              <li>You have accessed the platform and its features</li>
            </ul>
          </div>

          <div className="doc-section">
            <h2>2. Before You Buy</h2>
            <p>We strongly encourage you to:</p>
            <ul>
              <li>Read the full feature list on our features page</li>
              <li>Watch the demo video before purchasing</li>
              <li>Email us at support@scanr.me with any questions before payment</li>
              <li>Test the platform on demo mode before connecting real funds</li>
            </ul>
            <p>We are happy to answer any questions before you commit to a purchase.</p>
          </div>

          <div className="doc-section">
            <h2>3. Exceptions</h2>
            <p>We will consider a refund ONLY in these situations:</p>
            <ul>
              <li>You were charged twice for the same purchase (duplicate payment)</li>
              <li>Your license key was never delivered and we cannot resolve the issue within 48 hours</li>
              <li>A technical issue on our end prevents you from accessing the platform and we cannot fix it within 72 hours</li>
            </ul>
            <p>In these cases contact us on WhatsApp immediately with proof of payment.</p>
          </div>

          <div className="doc-section">
            <h2>4. Subscription Cancellations</h2>
            <p>If you are on a monthly or yearly subscription:</p>
            <ul>
              <li>You can cancel anytime from your account settings</li>
              <li>Cancellation stops future charges immediately</li>
              <li>No refund is issued for the current billing period</li>
              <li>You retain access until the end of your paid period</li>
            </ul>
          </div>

          <div className="doc-section">
            <h2>5. Demo Mode</h2>
            <p>Scanr offers a full demo mode that lets you test all features including the Strategy Bot without real funds. We strongly recommend using demo mode before going live. The availability of demo mode means feature-related refund requests will not be considered.</p>
          </div>

          <div className="doc-section">
            <h2>6. Chargebacks</h2>
            <p>Filing a chargeback without contacting us first will result in permanent suspension of your license with no possibility of reinstatement. Please contact us first — we are always willing to resolve issues fairly.</p>
          </div>

          <div className="doc-section">
            <h2>7. Contact Us</h2>
            <p>For any payment issues or concerns contact us via:</p>
            <ul>
              <li>WhatsApp: (fetched from admin settings)</li>
              <li>Contact form: scanr.online</li>
            </ul>
            <p>We aim to respond within 24 hours.</p>
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
