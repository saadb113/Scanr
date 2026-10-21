import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import AppearanceTab from './tabs/AppearanceTab';
import IndicatorsTab from './tabs/IndicatorsTab';
import FiltersTab from './tabs/FiltersTab';
import CoinsTab from './tabs/CoinsTab';
import DrawingsTab from './tabs/DrawingsTab';
import IntegrationsTab from './tabs/IntegrationsTab';
import ProfileTab from './tabs/ProfileTab';
import AgentTab from './tabs/AgentTab';
import BybitModal from './modals/BybitModal';
import BinanceModal from './modals/BinanceModal';
import KimiModal from './modals/KimiModal';
import DiscordModal from './modals/DiscordModal';
import TelegramModal from './modals/TelegramModal';
import './Settings.css';

const TABS = [
  { group: 'Preferences', items: [
    { id: 'appearance', icon: 'fa-brush', label: 'Appearance' },
    { id: 'indicators', icon: 'fa-arrow-up-right-dots', label: 'Indicators' },
    { id: 'filters', icon: 'fa-magnifying-glass', label: 'Filters' },
    { id: 'coins', icon: 'fa-coins', label: 'Coins' },
    { id: 'drawings', icon: 'fa-pencil', label: 'Drawings' },
  ] },
  { group: 'Connections', items: [
    { id: 'integrations', icon: 'fa-link', label: 'Integrations' },
  ] },
  { group: 'Account', items: [
    { id: 'profile', icon: 'fa-user', label: 'Profile' },
    { id: 'agent', icon: 'fa-robot', label: 'Day Agent' },
  ] },
];

export default function Settings() {
  const [tab, setTab] = useState('appearance');
  const [modal, setModal] = useState(null); // 'bybit' | 'binance' | 'kimi' | 'discord' | 'telegram' | null
  const [integrationsRefreshKey, setIntegrationsRefreshKey] = useState(0);
  const refreshIntegrations = () => setIntegrationsRefreshKey((k) => k + 1);

  // Auto-open a tab when navigated here via "Edit Profile" or similar (Layout.jsx sets this).
  useEffect(() => {
    try {
      const requested = sessionStorage.getItem('settings_tab');
      if (!requested) return;
      sessionStorage.removeItem('settings_tab');
      if (requested === 'bybit' || requested === 'ai') {
        setTab('integrations');
        setTimeout(() => setModal(requested === 'ai' ? 'kimi' : 'bybit'), 100);
        return;
      }
      setTab(requested);
    } catch { /* ignore */ }
  }, []);

  async function resetDefaults() {
    if (!window.confirm('Reset everything to defaults?')) return;
    await api.del('/api/settings');
    window.location.reload();
  }

  return (
    <div id="settingsPanel" className="settings-panel">
      <div className="sp-header">
        <div className="sp-header-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#29ffb8" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" /></svg>
          <span>Scanner</span> Settings
        </div>
        <div className="sp-header-actions">
          <button className="s-reset" onClick={resetDefaults}>↺ Reset Defaults</button>
        </div>
      </div>

      <div className="sp-layout">
        <div className="sp-sidebar">
          {TABS.map((g) => (
            <div key={g.group}>
              <div className="sp-sidebar-label">{g.group}</div>
              {g.items.map((t) => (
                <div key={t.id} className={`sp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                  <i className={`fa-solid ${t.icon}`} /> {t.label}
                </div>
              ))}
              <div className="sp-sidebar-divider" />
            </div>
          ))}
        </div>

        <div className="sp-body">
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'indicators' && <IndicatorsTab />}
          {tab === 'filters' && <FiltersTab />}
          {tab === 'coins' && <CoinsTab />}
          {tab === 'drawings' && <DrawingsTab />}
          {tab === 'integrations' && <IntegrationsTab key={integrationsRefreshKey} onOpenModal={setModal} />}
          {tab === 'profile' && <ProfileTab />}
          {tab === 'agent' && <AgentTab />}
        </div>
      </div>

      <BybitModal open={modal === 'bybit'} onClose={() => { setModal(null); refreshIntegrations(); }} />
      <BinanceModal open={modal === 'binance'} onClose={() => { setModal(null); refreshIntegrations(); }} />
      <KimiModal open={modal === 'kimi'} onClose={() => setModal(null)} onSaved={refreshIntegrations} />
      <DiscordModal open={modal === 'discord'} onClose={() => setModal(null)} onSaved={refreshIntegrations} />
      <TelegramModal open={modal === 'telegram'} onClose={() => setModal(null)} onSaved={refreshIntegrations} />
    </div>
  );
}
