/**
 * nav.js — Injects the shared site header and handles theme toggle.
 * Include this script at the top of <body> on every page.
 */
(function () {
  'use strict';

  // ── Inject nav.css if not already loaded ──────────────────
  if (!document.querySelector('link[href*="nav.css"]')) {
    const link = document.createElement('link');
    link.rel    = 'stylesheet';
    link.href   = '/css/nav.css';
    document.head.appendChild(link);
  }

  // ── Build header HTML ──────────────────────────────────────
  const headerEl = document.createElement('header');
  headerEl.className = 'site-header';
  headerEl.id = 'siteHeader';
  headerEl.innerHTML = `
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css" integrity="sha512-2SwdPD6INVrV/lHTZbO2nodKhrnDdJK9/kg2XD1r9uGqPo1cUbujc+IYdlYdEErWNu69gVcYgdxlmVmzTWnetw==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <div class="sh-left">
      <a class="sh-logo" href="/">Monty<span>.</span></a>
      <span class="sh-clock" id="shClock"></span>
    </div>
    <nav class="sh-nav" id="shNav">
      <a class="sh-link" href="/dashboard">Dashboard</a>
      <a class="sh-link" href="/scanner">Scanner</a>
      <a class="sh-link" href="/setups">Setups</a>
      <a class="sh-link" href="/strategy">Strategy</a>
      <a class="sh-link" href="/terminal">Trade</a>
      <a class="sh-link" href="/challenge">Challenge</a>
      <a class="sh-link" href="/agent">AI Agent(Beta)</a>
    
      <a class="sh-link sh-admin-link" href="/admin" id="shAdminLink" style="display:none">Admin</a>
      
      
      <div class="sh-pfp-wrap" style="margin-left: 5px;" id="shPfpWrap">
        <span class="sh-pfp" id="shPfp" title="Profile">👤</span>
        <div class="sh-pfp-dropdown" id="shPfpDropdown">
          <button class="sh-dd-item" id="shDdProfile"><i class="fa-solid fa-user" style="color: rgb(255, 255, 255);"></i> Edit Profile</button>
          <div class="sh-dd-sep"></div>
          <button class="sh-dd-item sh-settings-btn" id="shSettingsBtn" title="Settings"><i class="fa-solid fa-gear" style="color: rgb(255, 255, 255);"></i> Settings</button>
          <div class="sh-dd-sep"></div>
          <button class="sh-dd-item sh-theme-btn" id="shThemeBtn" title="Toggle light/dark mode"></button>
          <div class="sh-dd-sep"></div>
          <button class="sh-dd-item sh-dd-signout" id="shDdSignout"><i class="fa-solid fa-sign-out-alt" style="color: rgb(255, 255, 255);"></i> Sign Out</button>
        </div>
      </div>
    </nav>
    <button class="sh-hamburger" id="shHamburger" aria-label="Menu">&#9776;</button>
  `;
  document.body.insertBefore(headerEl, document.body.firstChild);

  // ── Page loading overlay ───────────────────────────────────
  const loaderEl = document.createElement('div');
  loaderEl.id = 'pageLoader';
  loaderEl.innerHTML = '<div class="pl-ring"></div>';
  document.body.appendChild(loaderEl);
  document.addEventListener('DOMContentLoaded', () => {
    loaderEl.classList.add('fade-out');
    setTimeout(() => loaderEl.remove(), 320);
  });

  let __clockTimezone = 'America/New_York';
  function updateClock() {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: __clockTimezone,
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(d);
    const day = parts.find(p => p.type === 'day')?.value || '';
    const mon = parts.find(p => p.type === 'month')?.value || '';
    const hr = parts.find(p => p.type === 'hour')?.value || '';
    const mm = parts.find(p => p.type === 'minute')?.value || '';
    const ampm = parts.find(p => p.type === 'dayPeriod')?.value || '';
    const tz = (__clockTimezone || 'America/New_York').split('/').pop().replace('_', ' ');
    const el = document.getElementById('shClock');
    if (el) el.textContent = `${day} ${mon}, ${hr}:${mm}${ampm} ${tz}`;
  }

  // ── Active link highlight ──────────────────────────────────
  const path = window.location.pathname;
  document.querySelectorAll('.sh-nav .sh-link[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href === '/' ? path === '/' : path.startsWith(href)) {
      a.classList.add('active');
    }
  });

  // ── Settings button ────────────────────────────────────────
  document.getElementById('shSettingsBtn').addEventListener('click', () => {
    window.location.href = '/settings';
  });

  // ── Theme toggle ───────────────────────────────────────────
  const THEME_KEY = 'monty-theme';
  const root      = document.documentElement;
  const themeBtn  = document.getElementById('shThemeBtn');

  function applyTheme(t) {
    if (t === 'light') {
      root.classList.add('light-mode');
      if (themeBtn) themeBtn.innerHTML = '<i class="fa-solid fa-sun" style="color: rgb(255, 255, 255);"></i> Light Mode';
    } else {
      root.classList.remove('light-mode');
      if (themeBtn) themeBtn.innerHTML = '<i class="fa-solid fa-moon" style="color: rgb(255, 255, 255);"></i> Dark Mode';
    }
    try { localStorage.setItem(THEME_KEY, t); } catch {}
  }

  const savedTheme = (function () { try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; } })();
  applyTheme(savedTheme);
  themeBtn.addEventListener('click', () => {
    applyTheme(root.classList.contains('light-mode') ? 'dark' : 'light');
  });

  // ── Load current user (profile pic + admin link) ───────────
  fetch('/api/auth/me')
    .then(r => r.ok ? r.json() : null)
    .then(user => {
      if (!user) return;
      if (user.role === 'admin') {
        const adminLink = document.getElementById('shAdminLink');
        if (adminLink) adminLink.style.display = '';
      }
      if (user.profilePicture) {
        const pfp = document.getElementById('shPfp');
        if (pfp) pfp.innerHTML = `<img src="${user.profilePicture}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      }
    })
    .catch(() => {});

  // ── App name (branding) ────────────────────────────────────
  fetch('/api/public/app-name')
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      const name = data?.appName;
      if (!name) return;
      const logo = document.querySelector('.sh-logo');
      if (logo) logo.innerHTML = name + '<span>.</span>';
      if (document.title) {
        document.title = document.title.replace(/Monty/g, name);
      }
    })
    .catch(() => {});

  // ── Profile dropdown ───────────────────────────────────────
  const pfpWrap     = document.getElementById('shPfpWrap');
  const pfpDropdown = document.getElementById('shPfpDropdown');

  pfpWrap.addEventListener('click', e => {
    e.stopPropagation();
    pfpDropdown.classList.toggle('open');
  });

  document.addEventListener('click', () => pfpDropdown.classList.remove('open'));

  document.getElementById('shDdProfile').addEventListener('click', e => {
    e.stopPropagation();
    pfpDropdown.classList.remove('open');
    try { sessionStorage.setItem('settings_tab', 'profile'); } catch(_) {}
    window.location.href = '/settings';
  });

  document.getElementById('shDdSignout').addEventListener('click', async e => {
    e.stopPropagation();
    pfpDropdown.classList.remove('open');
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch(_) {}
    window.location.href = '/login';
  });

  // ── Accent color — applied to all CSS vars on every page ──────
  window.applyAccentColor = function(color) {
    const c = color || '#00e5a0';
    document.documentElement.style.setProperty('--accent-green', c);
    document.documentElement.style.setProperty('--green', c);
    document.documentElement.style.setProperty('--accent', c);
  };

  // Apply on load for pages that don't use app.js
  fetch('/api/settings')
    .then(r => r.ok ? r.json() : null)
    .then(s => {
      if (s && s.accentColor) window.applyAccentColor(s.accentColor);
      __clockTimezone = s?.clockTimezone || 'America/New_York';
      updateClock();
    })
    .catch(() => {});
  updateClock();
  setInterval(updateClock, 1000);

  // ── Hamburger mobile menu ─────────────────────────────────────
  const hamburger = document.getElementById('shHamburger');
  const shNavEl   = document.getElementById('shNav');
  hamburger.addEventListener('click', e => {
    e.stopPropagation();
    shNavEl.classList.toggle('mob-open');
  });
  document.addEventListener('click', e => {
    if (!shNavEl.contains(e.target) && e.target !== hamburger) {
      shNavEl.classList.remove('mob-open');
    }
  });

  // ── Sign out ───────────────────────────────────────────────────
})();
