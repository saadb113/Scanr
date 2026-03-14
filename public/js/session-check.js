async function checkSession() {
  try {
    const res = await fetch('/api/auth/session-check', {
      credentials: 'include'
    })
    if (res.status === 401) {
      showSessionKickedOverlay()
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
