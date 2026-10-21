import MarketingLayout from '../components/MarketingLayout';
import './MarketingDoc.css';

export default function Privacy() {
  return (
    <MarketingLayout>
      <div className="page-hero">
        <h1>Privacy Policy</h1>
        <p>Last updated: March 2026</p>
        <span className="reading-time">5 min read</span>
      </div>

      <div className="doc-wrap">
        <div className="doc-inner">
          <a href="/" className="doc-back">← Back to Home</a>

          <div className="doc-section">
            <h2>1. Information We Collect</h2>
            <ul>
              <li>Email address and name (for account creation)</li>
              <li>Device fingerprint (for security — detecting unauthorized logins)</li>
              <li>IP address (for security logging)</li>
              <li>API keys you provide (Bybit, AI providers, Discord webhook) — stored encrypted, never shared</li>
              <li>Trade history and strategy data you create</li>
            </ul>
          </div>

          <div className="doc-section">
            <h2>2. How We Use Your Information</h2>
            <ul>
              <li>To provide and maintain your Scanr account</li>
              <li>To enforce single session security</li>
              <li>To send license keys and important account emails</li>
              <li>To detect suspicious activity and protect your account</li>
              <li>We do NOT sell your data to any third party</li>
              <li>We do NOT use your data for advertising</li>
            </ul>
          </div>

          <div className="doc-section">
            <h2>3. API Keys &amp; Sensitive Data</h2>
            <p>Your Bybit API keys, AI provider keys and Discord webhooks are stored securely in our database. They are used solely to provide the features you configured. We never share or log these keys.</p>
          </div>

          <div className="doc-section">
            <h2>4. Data Storage</h2>
            <p>Your data is stored on secure cloud servers (DigitalOcean). We use MongoDB Atlas for database storage with encryption at rest.</p>
          </div>

          <div className="doc-section">
            <h2>5. Cookies &amp; Sessions</h2>
            <p>Scanr uses session tokens to keep you logged in. No advertising cookies or tracking pixels are used.</p>
          </div>

          <div className="doc-section">
            <h2>6. Third Party Services</h2>
            <p>Scanr connects to these third party services on your behalf:</p>
            <ul>
              <li>Binance (market data)</li>
              <li>Bybit (trade execution — using your own API keys)</li>
              <li>Kimi / GLM / Claude (AI analysis — using your own API keys)</li>
              <li>Discord (notifications — using your own webhook URL)</li>
            </ul>
            <p>We are not responsible for the privacy practices of these services.</p>
          </div>

          <div className="doc-section">
            <h2>7. Data Retention</h2>
            <p>Your data is retained as long as your account is active. You can request deletion of your account and all associated data by contacting us via WhatsApp.</p>
          </div>

          <div className="doc-section">
            <h2>8. Children's Privacy</h2>
            <p>Scanr is not intended for users under 18 years of age.</p>
          </div>

          <div className="doc-section">
            <h2>9. Changes to Privacy Policy</h2>
            <p>We may update this policy at any time. We will notify users of significant changes via email.</p>
          </div>

          <div className="doc-section">
            <h2>10. Contact</h2>
            <p>For privacy concerns contact us via email or the contact form on scanr.online</p>
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
