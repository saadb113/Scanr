// Store user tier globally
window.userAccountTier = 'free';

function _ensurePremiumOverlayStyles() {
  if (document.getElementById('premium-overlay-runtime-styles')) return;

  const style = document.createElement('style');
  style.id = 'premium-overlay-runtime-styles';
  style.textContent = `
    .page-content.locked {
      filter: blur(4px);
      pointer-events: none;
      user-select: none;
    }

    .premium-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      backdrop-filter: blur(4px);
      padding: 16px;
    }

    .premium-card {
      background: #1a1d26;
      border: 1px solid #2b2f3e;
      border-radius: 16px;
      padding: 40px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-height: 90vh;
      overflow: scroll;
      scrollbar-width: thin;
      scrollbar-color: var(--accent-green, #00e5a0) transparent;
    }
.premium-card::-webkit-scrollbar {
  width: 8px;
  background: transparent;
  }
  .premium-card::-webkit-scrollbar-track {
  background: transparent;
  }
  .premium-card::-webkit-scrollbar-thumb {
  background: var(--accent-green, #00e5a0);
  border-radius: 40px;
  }
    .premium-card-icon {
      font-size: 56px;
      line-height: 1;
      text-align: center;
      color: #f0b90b;
    }

    .premium-card-title {
      font-size: 22px;
      font-weight: 800;
      color: #ffffff;
      text-align: center;
      margin: 0;
    }

    .premium-card-subtitle {
      color: #8b8fa8;
      text-align: center;
      line-height: 1.55;
      margin: 0;
    }

    .premium-features {
      background: transparent;
      border: 1px solid #2b2f3e;
      border-radius: 10px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .premium-feature-item {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #ffffff;
      font-size: 0.95rem;
    }

    .premium-feature-check {
      color: #0ecb81;
      flex-shrink: 0;
    }

    .premium-price {
      color: var(--accent-green, #00e5a0);
      font-size: 20px;
      font-weight: 800;
      text-align: center;
    }

    .premium-price-original {
      text-align: center;
      color: #8b8fa8;
      font-size: 0.86rem;
      text-decoration: line-through;
      margin-top: -6px;
    }

    .premium-discount-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin: -2px auto 0;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      border: 1px solid rgba(0, 229, 160, 0.35);
      background: rgba(0, 229, 160, 0.14);
      color: var(--accent-green, #00e5a0);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.3px;
    }

    .premium-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 4px;
    }

    .premium-btn-primary {
      background: linear-gradient(135deg, var(--accent-green, #00e5a0), #0ecb81);
      color: #041017;
      border: none;
      border-radius: 8px;
      padding: 14px 32px;
      font-weight: 700;
      font-size: 16px;
      width: 100%;
      cursor: pointer;
    }

    .premium-btn-primary:hover {
      filter: brightness(1.1);
    }

    .premium-btn-secondary {
      background: transparent;
      border: 1px solid #2b2f3e;
      color: #8b8fa8;
      border-radius: 8px;
      padding: 12px 32px;
      width: 100%;
      cursor: pointer;
    }

    .premium-btn-secondary:hover {
      border-color: #8b8fa8;
    }
  `;

  document.head.appendChild(style);
}

function _formatLifetimePrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '49.00';
  return n.toFixed(2);
}

async function _getDynamicLifetimePrice() {
  try {
    const res = await fetch('/api/settings/pricing', { cache: 'no-store' });
    if (!res.ok) {
      return {
        displayPrice: '49.00',
        originalPrice: '49.00',
        hasDiscount: false,
        discountLabel: ''
      };
    }

    const data = await res.json();
    const lifetime = data && data.lifetime ? data.lifetime : {};
    const displayRaw = lifetime.displayPrice || lifetime.original || 49;
    const originalRaw = lifetime.original || displayRaw || 49;
    const displayPrice = _formatLifetimePrice(displayRaw);
    const originalPrice = _formatLifetimePrice(originalRaw);

    const hasDiscount = Number(displayRaw) < Number(originalRaw);
    const fallbackLabel = lifetime.discountPct ? `${lifetime.discountPct}% OFF` : 'Limited Offer';
    const discountLabel = String((data && data.discountLabel) || fallbackLabel || '').trim();

    return {
      displayPrice,
      originalPrice,
      hasDiscount,
      discountLabel: hasDiscount ? discountLabel : ''
    };
  } catch (_) {
    return {
      displayPrice: '49.00',
      originalPrice: '49.00',
      hasDiscount: false,
      discountLabel: ''
    };
  }
}

function _applyPremiumPrice(root, pricing) {
  const priceNodes = root.querySelectorAll('[data-dynamic-lifetime-price]');
  priceNodes.forEach((el) => { el.textContent = pricing.displayPrice; });

  const originalNodes = root.querySelectorAll('[data-dynamic-original-price]');
  originalNodes.forEach((el) => { el.textContent = pricing.originalPrice; });

  const originalWraps = root.querySelectorAll('[data-dynamic-original-wrap]');
  originalWraps.forEach((el) => {
    el.style.display = pricing.hasDiscount ? '' : 'none';
  });

  const discountLabelNodes = root.querySelectorAll('[data-dynamic-discount-label]');
  discountLabelNodes.forEach((el) => { el.textContent = pricing.discountLabel; });

  const discountWraps = root.querySelectorAll('[data-dynamic-discount-wrap]');
  discountWraps.forEach((el) => {
    el.style.display = pricing.hasDiscount ? '' : 'none';
  });
}

// Helper function to check if user is premium
window.isPremium = function() {
  return window.userAccountTier === 'premium';
};

// Function to show premium overlay
window.showPremiumOverlay = function() {
  _ensurePremiumOverlayStyles();

  // Remove any existing overlay
  const existing = document.getElementById('premium-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'premium-overlay';
  overlay.className = 'premium-overlay';
  overlay.innerHTML = `
    <div class="premium-card">
      <div class="premium-card-icon">🔒</div>
      <h2 class="premium-card-title">Premium Feature</h2>
      <p class="premium-card-subtitle">Unlock the full power of Scanr with Premium access</p>
      
      <div class="premium-features">
        <div class="premium-feature-item"><span class="premium-feature-check">✅</span><span>Trading Terminal</span></div>
        <div class="premium-feature-item"><span class="premium-feature-check">✅</span><span>AI Analysis</span></div>
        <div class="premium-feature-item"><span class="premium-feature-check">✅</span><span>Drag n Drop Strategy Builder</span></div>
        <div class="premium-feature-item"><span class="premium-feature-check">✅</span><span>24/7 Strategy Automation Bot</span></div>
        <div class="premium-feature-item"><span class="premium-feature-check">✅</span><span>Apex Setup Scanner</span></div>
      </div>

      <div class="premium-price">$<span data-dynamic-lifetime-price>49.00</span> Lifetime Access</div>
      <div class="premium-price-original" data-dynamic-original-wrap style="display:none;">Was $<span data-dynamic-original-price>69.00</span></div>
      <div class="premium-discount-badge" data-dynamic-discount-wrap style="display:none;"><span data-dynamic-discount-label>Limited Offer</span></div>
      
      <div class="premium-actions">
        <button class="premium-btn-primary" onclick="window.location.href='/payment'">
          🚀 Upgrade to Premium
        </button>
        <button class="premium-btn-secondary" id="maybeLaterBtn">
          Maybe Later
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  const pageContent = document.querySelector('.page-content');
  if (pageContent) {
    pageContent.classList.add('locked');
  }

  // Free users should never view premium page content.
  const maybeLaterBtn = document.getElementById('maybeLaterBtn');
  if (maybeLaterBtn) {
    maybeLaterBtn.addEventListener('click', () => {
      window.location.href = '/dashboard';
    });
  }

  // Disable outside click to close; redirect to dashboard instead.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      window.location.href = '/dashboard';
    }
  });

  _getDynamicLifetimePrice().then((pricing) => {
    _applyPremiumPrice(overlay, pricing);
  });
};

// Function to hide premium overlay
window.hidePremiumOverlay = function() {
  const overlay = document.getElementById('premium-overlay');
  if (overlay) {
    overlay.remove();
  }
  const pageContent = document.querySelector('.page-content');
  if (pageContent) {
    pageContent.classList.remove('locked');
  }
};

// Upgrade Modal
window.showUpgradeModal = function() {
  // Remove any existing modal
  const existing = document.getElementById('upgrade-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'upgrade-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(2px);
  `;
  
  modal.innerHTML = `
    <style>
      #upgrade-modal .upgrade-modal-card {
        scrollbar-width: thin;
        scrollbar-color: var(--accent-green, #00e5a0) transparent;
      }
      #upgrade-modal .upgrade-modal-card::-webkit-scrollbar { width: 8px; }
      #upgrade-modal .upgrade-modal-card::-webkit-scrollbar-track { background: transparent; }
      #upgrade-modal .upgrade-modal-card::-webkit-scrollbar-thumb {
        background: var(--accent-green, #00e5a0);
        border-radius: 20px;
      }
    </style>
    <div style="
      background: var(--bg-surface, #0d1117);
      border: 1px solid var(--border-mid, #243044);
      border-radius: 16px;
      padding: 2rem 1.75rem;
      max-width: 480px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 16px 48px rgba(0,0,0,0.65);
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      animation: upgradeSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    " class="upgrade-modal-card" @keyframes upgradeSlideIn {
      from { opacity: 0; transform: scale(0.95) translateY(-20px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }>
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <h2 style="
          font-size: 1.5rem;
          font-weight: 800;
          color: var(--text-primary, #dde4f0);
          margin: 0;
          letter-spacing: -0.5px;
        ">⚡ Upgrade to Premium</h2>
        <button onclick="document.getElementById('upgrade-modal').remove()" style="
          background: none;
          border: none;
          color: var(--text-secondary, #9aa3b5);
          font-size: 1.5rem;
          cursor: pointer;
          line-height: 1;
          padding: 0;
          transition: color 0.15s;
        " onmouseover="this.style.color='var(--text-primary, #dde4f0)'" onmouseout="this.style.color='var(--text-secondary, #9aa3b5)'">&times;</button>
      </div>
      
      <p style="
        font-size: 0.95rem;
        color: var(--text-secondary, #9aa3b5);
        margin: 0;
        line-height: 1.6;
      ">Unlock the full power of Scanr with Premium access</p>
      
      <div 
        id="upgrade-section"
        style="
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        ">
        <div style="
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          background: var(--bg-raised, #121820);
          border: 1px solid var(--border-dim, #1c2435);
          border-radius: 10px;
          padding: 1rem;
        ">
          <div style="display: flex; align-items: center; gap: 0.6rem; font-size: 0.9rem; color: var(--text-secondary, #9aa3b5);">
            <span style="color: var(--accent-green, #00e5a0); font-weight: 800; font-size: 1.1rem;">✓</span>
            Trading Terminal — Place live trades on Bybit/Binance
          </div>
          <div style="display: flex; align-items: center; gap: 0.6rem; font-size: 0.9rem; color: var(--text-secondary, #9aa3b5);">
            <span style="color: var(--accent-green, #00e5a0); font-weight: 800; font-size: 1.1rem;">✓</span>
            AI Analysis — AI-powered chart analysis and signals
          </div>
          <div style="display: flex; align-items: center; gap: 0.6rem; font-size: 0.9rem; color: var(--text-secondary, #9aa3b5);">
            <span style="color: var(--accent-green, #00e5a0); font-weight: 800; font-size: 1.1rem;">✓</span>
            Strategy Builder — Drag & drop strategy automation
          </div>
          <div style="display: flex; align-items: center; gap: 0.6rem; font-size: 0.9rem; color: var(--text-secondary, #9aa3b5);">
            <span style="color: var(--accent-green, #00e5a0); font-weight: 800; font-size: 1.1rem;">✓</span>
            Apex Setup Scanner — Advanced setup detection
          </div>
        </div>
        
        <div style="
          background: var(--bg-raised, #121820);
          border: 1px solid var(--border-dim, #1c2435);
          border-radius: 10px;
          padding: 1rem;
          text-align: center;
        ">
          <div style="font-size: 0.85rem; color: var(--text-muted, #5a6478); margin-bottom: 0.4rem;">Lifetime access</div>
          <div style="font-size: 1.75rem; font-weight: 800; color: var(--accent-green, #00e5a0);">$<span data-dynamic-lifetime-price>49.00</span></div>
          <div data-dynamic-original-wrap style="display:none; margin-top: 0.3rem; font-size: 0.85rem; color: var(--text-muted, #5a6478);">Was $<span data-dynamic-original-price>69.00</span></div>
          <div data-dynamic-discount-wrap style="display:none; margin-top: 0.45rem;"><span style="display:inline-flex; align-items:center; justify-content:center; background: rgba(0,229,160,0.16); color: var(--accent-green, #00e5a0); border: 1px solid rgba(0,229,160,0.35); border-radius: 999px; padding: 0.22rem 0.55rem; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.3px;" data-dynamic-discount-label>Limited Offer</span></div>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 0.6rem;">
          <button onclick="window.location.href='/payment'" style="
            background: linear-gradient(135deg, var(--accent-green, #00e5a0), #0ecb81);
            color: #041017;
            border: none;
            border-radius: 10px;
            padding: 0.85rem;
            font-size: 1rem;
            font-weight: 800;
            cursor: pointer;
            font-family: inherit;
            transition: opacity 0.15s, transform 0.1s;
            letter-spacing: 0.3px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
          " onmouseover="this.style.opacity='0.9'; this.style.transform='scale(1.01)'" onmouseout="this.style.opacity='1'; this.style.transform='scale(1)'">
            🚀 Upgrade to Premium
          </button>
          <button onclick="window.showLicenseKeyInput()" style="
            background: transparent;
            color: var(--text-secondary, #9aa3b5);
            border: 1px solid var(--border-mid, #243044);
            border-radius: 10px;
            padding: 0.75rem;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            font-family: inherit;
            transition: all 0.15s;
          " onmouseover="this.style.background='var(--bg-raised, #121820)'; this.style.borderColor='var(--border-hi, #2e3d55)'; this.style.color='var(--text-primary, #dde4f0)'" onmouseout="this.style.background='transparent'; this.style.borderColor='var(--border-mid, #243044)'; this.style.color='var(--text-secondary, #9aa3b5)'">
            🔑 Already have a key? Activate
          </button>
          <button onclick="document.getElementById('upgrade-modal').remove()" style="
            background: transparent;
            color: var(--text-secondary, #9aa3b5);
            border: 1px solid var(--border-mid, #243044);
            border-radius: 10px;
            padding: 0.75rem;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            font-family: inherit;
            transition: all 0.15s;
          " onmouseover="this.style.background='var(--bg-raised, #121820)'; this.style.borderColor='var(--border-hi, #2e3d55)'; this.style.color='var(--text-primary, #dde4f0)'" onmouseout="this.style.background='transparent'; this.style.borderColor='var(--border-mid, #243044)'; this.style.color='var(--text-secondary, #9aa3b5)'">
            ✕ Close
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);

  _getDynamicLifetimePrice().then((pricing) => {
    _applyPremiumPrice(modal, pricing);
  });
};

// License Key Input Function
window.showLicenseKeyInput = function() {
  const upgradeSection = document.getElementById('upgrade-section');
  if (!upgradeSection) return;

  upgradeSection.style.display = 'none';

  const keyInputSection = document.createElement('div');
  keyInputSection.id = 'key-input-section';
  keyInputSection.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  `;

  keyInputSection.innerHTML = `
    <div style="
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    ">
      <label style="
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--text-primary, #dde4f0);
      ">Enter your license key:</label>
      <input 
        id="license-key-input" 
        type="text" 
        placeholder="XXXX-XXXX-XXXX-XXXX" 
        maxlength="23"
        style="
          background: var(--bg-raised, #121820);
          border: 1px solid var(--border-mid, #243044);
          color: var(--text-primary, #dde4f0);
          border-radius: 8px;
          padding: 0.75rem;
          font-size: 1rem;
          font-family: inherit;
          transition: all 0.15s;
        " 
        onfocus="this.style.borderColor='var(--accent-amber, #f5a623)'; this.style.boxShadow='0 0 0 2px rgba(245, 166, 35, 0.1)'" 
        onblur="this.style.borderColor='var(--border-mid, #243044)'; this.style.boxShadow='none'"
      />
      <div style="font-size: 0.85rem; color: var(--text-muted, #5a6478);">
        Purchased on our website or received via email
      </div>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
      <button id="activate-key-btn" onclick="window.activateLicenseKey()" style="
        background: linear-gradient(135deg, var(--accent-green, #00e5a0), #00d18f);
        color: #0a0f16;
        border: none;
        border-radius: 10px;
        padding: 0.85rem;
        font-size: 1rem;
        font-weight: 800;
        cursor: pointer;
        font-family: inherit;
        transition: opacity 0.15s, transform 0.1s;
        letter-spacing: 0.3px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      " onmouseover="this.style.opacity='0.9'; this.style.transform='scale(1.01)'" onmouseout="this.style.opacity='1'; this.style.transform='scale(1)'">
        ✓ Activate Key
      </button>
      <button onclick="document.getElementById('key-input-section').remove(); document.getElementById('upgrade-section').style.display='flex'" style="
        background: transparent;
        color: var(--text-secondary, #9aa3b5);
        border: 1px solid var(--border-mid, #243044);
        border-radius: 10px;
        padding: 0.75rem;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.15s;
      " onmouseover="this.style.background='var(--bg-raised, #121820)'; this.style.borderColor='var(--border-hi, #2e3d55)'; this.style.color='var(--text-primary, #dde4f0)'" onmouseout="this.style.background='transparent'; this.style.borderColor='var(--border-mid, #243044)'; this.style.color='var(--text-secondary, #9aa3b5)'">
        ← Back
      </button>
    </div>
  `;

  const modal = document.getElementById('upgrade-modal').querySelector('div');
  modal.appendChild(keyInputSection);
};

// Activate License Key Function
window.activateLicenseKey = async function() {
  const keyInput = document.getElementById('license-key-input');
  const key = keyInput.value.trim();

  if (!key) {
    alert('Please enter a license key');
    return;
  }

  const btn = document.getElementById('activate-key-btn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Validating...';

  try {
    const response = await fetch('/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });

    const data = await response.json();

    if (response.ok) {
      btn.innerHTML = '✓ Activated! Refreshing...';
      window.userAccountTier = 'premium';
      setTimeout(() => {
        document.getElementById('upgrade-modal').remove();
        window.location.reload();
      }, 1000);
    } else {
      alert(data.message || 'Invalid or expired license key');
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  } catch (error) {
    console.error('Error activating license:', error);
    alert('Error activating license key. Please try again.');
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
};

window.enforcePremiumAccess = async function(initPage) {
  try {
    await fetch('/api/auth/refresh-session', { credentials: 'include' });

    const res = await fetch('/api/auth/session-check', {
      credentials: 'include'
    });

    if (!res.ok) {
      window.showPremiumOverlay();
      return false;
    }

    const data = await res.json();
    const tier = (data && data.user && data.user.accountTier) || data.accountTier || 'free';
    window.userAccountTier = tier;
    window.dispatchEvent(new CustomEvent('scanr:tier-updated', { detail: { accountTier: tier } }));

    if (data && data.user && data.user.accountTier === 'premium') {
      window.hidePremiumOverlay();
      if (typeof initPage === 'function') initPage();
      return true;
    }

    window.showPremiumOverlay();
    return false;
  } catch (_) {
    window.showPremiumOverlay();
    return false;
  }
};

async function checkSession() {
  try {
    const res = await fetch('/api/auth/session-check', {
      credentials: 'include'
    })
    if (res.status === 401) {
      showSessionKickedOverlay()
    } else if (res.ok) {
      const data = await res.json();
      const tier = (data && data.user && data.user.accountTier) || data.accountTier;
      if (tier) {
        window.userAccountTier = tier;
        window.dispatchEvent(new CustomEvent('scanr:tier-updated', { detail: { accountTier: tier } }));
      }
    }
  } catch(e) {
  }
}

// Run immediately on page load
checkSession()

// Then run every 60 seconds
setInterval(checkSession, 60000)

function showSessionKickedOverlay() {
  // Remove any existing overlay
  const existing = document.getElementById('session-kicked-overlay')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.id = 'session-kicked-overlay'
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: rgba(10,14,26,0.98);
    z-index: 999999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #e5e9f2;
    font-family: 'Space Grotesk', sans-serif;
  `
  overlay.innerHTML = `
    <div style="font-size:52px;margin-bottom:16px">🔒</div>
    <h2 style="color:#ff4d6d;margin:0 0 12px;font-size:24px">
      Session Ended
    </h2>
    <p style="color:#8892a4;text-align:center;
              max-width:420px;line-height:1.7;
              font-size:15px;padding:0 24px">
      Your account was signed into from another device
      or browser. Only 1 active session is allowed
      at a time. If this wasn't you, contact support.
    </p>
    <button
      onclick="window.location.href='/login'"
      style="margin-top:28px;padding:14px 36px;
             background:#00e5a0;color:#0a0e1a;
             border:none;border-radius:8px;
             font-size:16px;font-weight:700;
             cursor:pointer;letter-spacing:0.3px">
      Sign In Again
    </button>
  `
  document.body.appendChild(overlay)
  setTimeout(() => window.location.href = '/login?kicked=true', 8000)
}
