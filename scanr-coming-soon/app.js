(() => {
  const config = window.SCANR_CONFIG || {};
  const creator = (config.creatorName || 'Saad').trim();
  document.querySelectorAll('[data-creator-name]').forEach((node) => { node.textContent = creator; });
  document.querySelectorAll('[data-avatar]').forEach((node) => { node.textContent = creator.slice(0, 1).toUpperCase(); });
  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });

  const pagePath = ({ '/': '/', '/features': '/features', '/features.html': '/features', '/about': '/about', '/about.html': '/about', '/privacy': '/privacy', '/privacy.html': '/privacy' })[location.pathname];
  const analyticsChoiceKey = 'scanr-analytics-choice';
  const recordPageView = () => {
    if (!pagePath) return;
    fetch('/api/view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: pagePath }), keepalive: true }).catch(() => {});
  };
  try {
    if (localStorage.getItem(analyticsChoiceKey) === 'accepted') recordPageView();
    else if (!localStorage.getItem(analyticsChoiceKey)) {
      const banner = document.createElement('aside');
      banner.className = 'analytics-consent';
      banner.setAttribute('aria-label', 'Analytics choices');
      banner.innerHTML = '<div><b>Help improve Scanr</b><p>Allow anonymous page-view counts and approximate country totals? Your full IP address is not saved in Scanr.</p></div><div><button type="button" class="analytics-reject">No thanks</button><button type="button" class="analytics-accept">Allow analytics</button></div>';
      document.body.append(banner);
      banner.querySelector('.analytics-accept').addEventListener('click', () => { localStorage.setItem(analyticsChoiceKey, 'accepted'); banner.remove(); recordPageView(); });
      banner.querySelector('.analytics-reject').addEventListener('click', () => { localStorage.setItem(analyticsChoiceKey, 'rejected'); banner.remove(); });
    }
  } catch {}

  const configuredSocials = Object.entries(config.socialLinks || {}).filter(([, url]) => {
    try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol); } catch { return false; }
  });
  document.querySelectorAll('[data-social-links]').forEach((holder) => {
    holder.replaceChildren(...configuredSocials.map(([name, url]) => {
      const anchor = document.createElement('a'); anchor.href = url; anchor.textContent = name;
      anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.setAttribute('aria-label', `${name} profile (opens in new tab)`);
      return anchor;
    }));
  });
  document.querySelectorAll('[data-social-empty]').forEach((node) => { node.hidden = configuredSocials.length > 0; });

  const header = document.querySelector('.site-header');
  const menu = document.querySelector('.menu-toggle');
  menu?.addEventListener('click', () => {
    const open = header.classList.toggle('menu-open');
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  document.querySelectorAll('.main-nav a').forEach((link) => link.addEventListener('click', () => {
    header?.classList.remove('menu-open'); menu?.setAttribute('aria-expanded', 'false');
  }));
  const setScrolled = () => header?.classList.toggle('scrolled', window.scrollY > 12);
  setScrolled(); window.addEventListener('scroll', setScrolled, { passive: true });

  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.12 });
    revealEls.forEach((node, i) => { node.style.transitionDelay = `${Math.min(i % 4, 3) * 65}ms`; observer.observe(node); });
  } else revealEls.forEach((node) => node.classList.add('visible'));

  document.querySelectorAll('[data-subscribe-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const copy = form.closest('.waitlist-copy');
      const message = copy?.querySelector('[data-form-message]');
      const consent = copy?.querySelector('[data-consent]');
      const button = form.querySelector('button[type="submit"]');
      if (!consent?.checked) {
        if (message) { message.textContent = 'Please confirm you want to receive launch updates.'; message.classList.add('error'); }
        consent?.focus(); return;
      }
      const email = form.elements.email.value.trim();
      if (message) { message.textContent = 'Adding you to the launch list…'; message.classList.remove('error'); }
      button.disabled = true; button.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch('/api/subscribe', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, consent: true, company: form.elements.company.value }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'We couldn’t save your email right now. Please try again shortly.');
        if (message) { message.textContent = result.alreadySubscribed ? 'You’re already on the list. Thanks for following Scanr.' : 'You’re on the list. I’ll email you when there’s a meaningful Scanr update.'; message.classList.remove('error'); }
        form.reset();
      } catch (error) {
        if (message) { message.textContent = error.message || 'Something went wrong. Please try again.'; message.classList.add('error'); }
      } finally { button.disabled = false; button.removeAttribute('aria-busy'); }
    });
  });
})();
