import { useEffect, useState } from 'react';
import { api } from '../../api/client';

export default function AdminSettings() {
  const [appName, setAppName] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [walletTRC20, setWalletTRC20] = useState('');
  const [walletERC20, setWalletERC20] = useState('');
  const [walletBEP20, setWalletBEP20] = useState('');
  const [pricePlanStandard, setPricePlanStandard] = useState('');
  const [pricePlanPKR, setPricePlanPKR] = useState('');
  const [pricingOriginal, setPricingOriginal] = useState('');
  const [pricingDiscounted, setPricingDiscounted] = useState('');
  const [pricingLabel, setPricingLabel] = useState('');
  const [settingMsg, setSettingMsg] = useState(null);
  const [pricingMsg, setPricingMsg] = useState(null);

  useEffect(() => {
    api.get('/api/admin/settings').then((d) => {
      if (d.appName) setAppName(d.appName);
      if (d.telegramBotToken) setTelegramBotToken(d.telegramBotToken);
      if (d.walletTRC20) setWalletTRC20(d.walletTRC20);
      if (d.walletERC20) setWalletERC20(d.walletERC20);
      if (d.walletBEP20) setWalletBEP20(d.walletBEP20);
      if (d.pricePlanStandard) setPricePlanStandard(d.pricePlanStandard);
      if (d.pricePlanPKR) setPricePlanPKR(d.pricePlanPKR);
      if (d.pricing_lifetime_original) setPricingOriginal(d.pricing_lifetime_original);
      if (d.pricing_lifetime_discounted !== undefined) setPricingDiscounted(d.pricing_lifetime_discounted);
      if (d.pricing_discount_label !== undefined) setPricingLabel(d.pricing_discount_label);
    }).catch((e) => console.error(e));
  }, []);

  async function saveSettings() {
    try {
      // Only appName and telegramBotToken are actually persisted by /api/admin/settings
      // server-side (confirmed in server.js — it destructures just {whatsapp, appName,
      // telegramBotToken} and ignores everything else). The wallet-address and plan-price
      // fields below have no backing endpoint yet; they're kept visible for when the
      // payment system gets built, matching the current admin.html layout.
      await api.post('/api/admin/settings', { appName: appName.trim(), telegramBotToken: telegramBotToken.trim() });
      setSettingMsg({ text: 'Settings saved!', ok: true });
      setTimeout(() => setSettingMsg(null), 3000);
    } catch (e) {
      setSettingMsg({ text: e.message, ok: false });
    }
  }

  async function savePricing() {
    try {
      // Same caveat as saveSettings — the backend doesn't read these pricing_* fields,
      // so this currently has no real effect. Kept for UI parity until that's wired up.
      await api.post('/api/admin/settings', {
        pricing_lifetime_original: pricingOriginal || 49,
        pricing_lifetime_discounted: pricingDiscounted === '' ? '' : pricingDiscounted,
        pricing_discount_label: pricingLabel,
      });
      try { sessionStorage.removeItem('scanr_pricing'); } catch { /* ignore */ }
      setPricingMsg({ text: 'Pricing saved!', ok: true });
      setTimeout(() => setPricingMsg(null), 3000);
    } catch (e) {
      setPricingMsg({ text: e.message, ok: false });
    }
  }

  const original = Number(pricingOriginal) || 49;
  const discounted = pricingDiscounted === '' ? null : Number(pricingDiscounted);
  const preview = discounted && discounted > 0 && discounted < original
    ? `Lifetime: $${original} (strikethrough) $${discounted} (${Math.round(((original - discounted) / original) * 100)}% OFF)`
    : `Lifetime: $${original} (no discount)`;

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Admin Settings</div>
      <div className="adm-card" style={{ maxWidth: 520 }}>
        <div className="adm-form-field">
          <label>App Name</label>
          <input type="text" placeholder="e.g. Scanr" value={appName} onChange={(e) => setAppName(e.target.value)} />
        </div>
        <div className="adm-form-field">
          <label>Telegram Bot Token</label>
          <input type="text" placeholder="123456:ABC-DEF..." value={telegramBotToken} onChange={(e) => setTelegramBotToken(e.target.value)} />
        </div>

        <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Payment System Settings</div>
          <div className="adm-form-field"><label>USDT TRC20 Wallet Address</label><input type="text" placeholder="Tron wallet address" value={walletTRC20} onChange={(e) => setWalletTRC20(e.target.value)} /></div>
          <div className="adm-form-field"><label>USDT ERC20 Wallet Address</label><input type="text" placeholder="Ethereum wallet address" value={walletERC20} onChange={(e) => setWalletERC20(e.target.value)} /></div>
          <div className="adm-form-field"><label>USDT BEP20 Wallet Address</label><input type="text" placeholder="BSC wallet address" value={walletBEP20} onChange={(e) => setWalletBEP20(e.target.value)} /></div>
          <div className="adm-form-field"><label>Plan Price (USD)</label><input type="number" placeholder="69" step="0.01" value={pricePlanStandard} onChange={(e) => setPricePlanStandard(e.target.value)} /></div>
          <div className="adm-form-field"><label>Plan Price (PKR)</label><input type="number" placeholder="19500" step="0.01" value={pricePlanPKR} onChange={(e) => setPricePlanPKR(e.target.value)} /></div>
        </div>

        <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Pricing</div>
          <div className="adm-form-field"><label>Lifetime Original Price (USDT)</label><input type="number" placeholder="69" step="0.01" value={pricingOriginal} onChange={(e) => setPricingOriginal(e.target.value)} /></div>
          <div className="adm-form-field"><label>Lifetime Discounted Price (USDT)</label><input type="number" placeholder="49" step="0.01" value={pricingDiscounted} onChange={(e) => setPricingDiscounted(e.target.value)} /></div>
          <div className="adm-form-field"><label>Discount Label</label><input type="text" placeholder="Limited Time Offer" value={pricingLabel} onChange={(e) => setPricingLabel(e.target.value)} /></div>
          <button className="adm-save-btn" type="button" onClick={savePricing}>Save Pricing</button>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            <div>{preview}</div>
            <div style={{ opacity: 0.8 }}>Label: {pricingLabel || 'None'}</div>
          </div>
          {pricingMsg && <div className={`adm-form-msg ${pricingMsg.ok ? 'ok' : 'err'}`}>{pricingMsg.text}</div>}
        </div>

        <button className="adm-save-btn" style={{ marginTop: 24 }} onClick={saveSettings}>Save Settings</button>
        {settingMsg && <div className={`adm-form-msg ${settingMsg.ok ? 'ok' : 'err'}`}>{settingMsg.text}</div>}
      </div>
    </div>
  );
}
