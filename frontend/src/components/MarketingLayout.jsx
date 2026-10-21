import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import './MarketingLayout.css';

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/setup-guide', label: 'Setup Guide' },
];
const FOOTER_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/setup-guide', label: 'Setup Guide' },
  { to: '/terms', label: 'Terms of Service' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/refund', label: 'Refund Policy' },
];
// Marketing pages already ported to React. The rest still live on Express, so
// those links do a real browser navigation until they're migrated too.
const MIGRATED_ROUTES = new Set(['/', '/terms', '/privacy', '/refund', '/features', '/pricing', '/setup-guide']);

function SiteLink({ to, className, children, onClick }) {
  if (MIGRATED_ROUTES.has(to)) {
    return (
      <NavLink end={to === '/'} to={to} className={({ isActive }) => `${className}${isActive ? ' active' : ''}`} onClick={onClick}>
        {children}
      </NavLink>
    );
  }
  return <a href={to} className={className} onClick={onClick}>{children}</a>;
}

export default function MarketingLayout({ children }) {
  const [appName, setAppName] = useState('Scanr');
  const [navOpen, setNavOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    api.get('/api/public/app-name').then((d) => {
      if (d?.appName) setAppName(d.appName);
    }).catch(() => {});
  }, []);

  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 10); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="mkt-root">
      <header className={`lp-header${navOpen ? ' nav-open' : ''}${scrolled ? ' scrolled' : ''}`}>
        <div className="lp-inner">
          <Link to="/" className="lp-logo"><span className="lp-logo-text">{appName}</span><span className="lp-dot">.</span></Link>
          <nav className="lp-nav">
            {NAV_LINKS.map((l) => <SiteLink key={l.to} to={l.to} className="lp-nav-a">{l.label}</SiteLink>)}
          </nav>
          <div className="lp-header-btns">
            <a href="/login" className="lp-btn-outline">Sign In</a>
            <a href="/register?plan=lifetime&redirect=payment" className="lp-btn-filled">Get Started</a>
          </div>
          <button className="lp-mobile-menu" onClick={() => setNavOpen((v) => !v)}>&#9776;</button>
        </div>
      </header>

      {children}

      <footer className="lp-footer">
        <div className="lp-inner">
          <div className="lp-footer-brand">
            <span className="lp-logo"><span className="lp-logo-text">{appName}</span><span className="lp-dot">.</span></span>
            <p>Professional crypto trading tools for serious traders.</p>
          </div>
          <nav className="lp-footer-nav">
            {FOOTER_LINKS.map((l) => <SiteLink key={l.to} to={l.to} className="">{l.label}</SiteLink>)}
          </nav>
          <div className="lp-footer-right">
            <a className="lp-wa-cta" href="mailto:support@scanr.me">Email Us</a>
            <p className="lp-copy">&copy; 2025 <span className="lp-logo-text">{appName}</span>. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
