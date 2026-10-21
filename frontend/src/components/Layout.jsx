import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import '../nav.css';

const THEME_KEY = 'SCANR-theme';
const NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/scanner', label: 'Scanner' },
  { to: '/challenge', label: 'Challenge' },
  { to: '/terminal', label: 'Trade' },
  { to: '/setups', label: 'Setups' },
  { to: '/strategy', label: 'Strategy' },
];
// Pages already ported to this React app. Everything else still lives on the
// Express-rendered public/*.html pages, so those links do a real browser
// navigation instead of client-side routing until they're migrated too.
const MIGRATED_ROUTES = new Set(['/dashboard', '/challenge', '/settings', '/setups', '/strategy', '/terminal', '/scanner']);

function readSavedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark';
  } catch {
    return 'dark';
  }
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [appName, setAppName] = useState('SCANR');
  const [clockText, setClockText] = useState('');
  const [theme, setTheme] = useState(readSavedTheme);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const clockTimezoneRef = useRef('America/New_York');
  const navRef = useRef(null);
  const hamburgerRef = useRef(null);

  const updateClock = useCallback(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: clockTimezoneRef.current,
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(new Date());
    const day = parts.find((p) => p.type === 'day')?.value || '';
    const mon = parts.find((p) => p.type === 'month')?.value || '';
    const hr = parts.find((p) => p.type === 'hour')?.value || '';
    const mm = parts.find((p) => p.type === 'minute')?.value || '';
    const ampm = parts.find((p) => p.type === 'dayPeriod')?.value || '';
    const tz = clockTimezoneRef.current.split('/').pop().replace('_', ' ');
    setClockText(`${day} ${mon}, ${hr}:${mm}${ampm} ${tz}`);
  }, []);

  // Theme: apply to <html> and persist.
  useEffect(() => {
    document.documentElement.classList.toggle('light-mode', theme === 'light');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // Branding + clock timezone.
  useEffect(() => {
    api.get('/api/public/app-name').then((d) => {
      if (d?.appName) setAppName(d.appName);
    }).catch(() => {});
    api.get('/api/settings').then((s) => {
      clockTimezoneRef.current = s?.clockTimezone || 'America/New_York';
      updateClock();
    }).catch(() => {});
    updateClock();
    const id = setInterval(updateClock, 1000);
    return () => clearInterval(id);
  }, [updateClock]);

  // Close the profile dropdown on outside click.
  useEffect(() => {
    function onDocClick() {
      setDropdownOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // Close the mobile nav on outside click.
  useEffect(() => {
    function onDocClick(e) {
      if (navRef.current && !navRef.current.contains(e.target) && e.target !== hamburgerRef.current) {
        setMobileOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  async function handleSignOut() {
    setDropdownOpen(false);
    try {
      await logout();
    } finally {
      navigate('/login');
    }
  }

  function handleEditProfile() {
    setDropdownOpen(false);
    try {
      sessionStorage.setItem('settings_tab', 'profile');
    } catch {
      /* ignore */
    }
    navigate('/settings');
  }

  const upgradeVisible = user && user.accountTier !== 'premium';

  return (
    <>
      <header className="site-header" id="siteHeader">
        <div className="sh-left">
          <a className="sh-logo" href="/">
            {appName}
            <span>.</span>
          </a>
          <span className="sh-clock">{clockText}</span>
        </div>
        <nav className={`sh-nav${mobileOpen ? ' mob-open' : ''}`} ref={navRef}>
          {NAV_LINKS.map((link) =>
            MIGRATED_ROUTES.has(link.to) ? (
              <NavLink
                key={link.to}
                className={({ isActive }) => `sh-link${isActive ? ' active' : ''}`}
                to={link.to}
              >
                {link.label}
              </NavLink>
            ) : (
              <a key={link.to} className="sh-link" href={link.to}>
                {link.label}
              </a>
            ),
          )}
          {user?.role === 'admin' && (
            <a className="sh-link sh-admin-link" href="/admin">
              Admin
            </a>
          )}
          {upgradeVisible && (
            <button className="sh-upgrade-btn" type="button" onClick={() => window.showUpgradeModal?.({ forceAllBenefits: true })}>
              <i className="fa-solid fa-rocket" /> Upgrade to Premium
            </button>
          )}
          <div className="sh-pfp-wrap" style={{ marginLeft: 5 }} onClick={(e) => { e.stopPropagation(); setDropdownOpen((v) => !v); }}>
            <span className="sh-pfp" title="Profile">
              {user?.profilePicture ? (
                <img src={user.profilePicture} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} alt="" />
              ) : (
                '👤'
              )}
            </span>
            <div className={`sh-pfp-dropdown${dropdownOpen ? ' open' : ''}`}>
              <button className="sh-dd-item" onClick={handleEditProfile}>
                <i className="fa-solid fa-user" /> Edit Profile
              </button>
              <div className="sh-dd-sep" />
              <button className="sh-dd-item sh-settings-btn" onClick={() => { setDropdownOpen(false); navigate('/settings'); }}>
                <i className="fa-solid fa-gear" /> Settings
              </button>
              <div className="sh-dd-sep" />
              <button className="sh-dd-item sh-theme-btn" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}>
                <i className={`fa-solid fa-${theme === 'light' ? 'sun' : 'moon'}`} /> {theme === 'light' ? 'Light Mode' : 'Dark Mode'}
              </button>
              <div className="sh-dd-sep" />
              <button className="sh-dd-item sh-dd-signout" onClick={handleSignOut}>
                <i className="fa-solid fa-sign-out-alt" /> Sign Out
              </button>
            </div>
          </div>
        </nav>
        <button
          className="sh-hamburger"
          aria-label="Menu"
          ref={hamburgerRef}
          onClick={(e) => {
            e.stopPropagation();
            setMobileOpen((v) => !v);
          }}
        >
          &#9776;
        </button>
      </header>
      <main>{children}</main>
    </>
  );
}
