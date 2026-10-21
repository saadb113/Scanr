import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './PremiumGate.css';

// Wraps a premium-only page's content. Free-tier users see a locked overlay
// instead (ports the vanilla enforcePremiumAccess()/showPremiumOverlay() pattern
// from public/js/session-check.js, used by setups/strategy/terminal/calendar.html).
export default function PremiumGate({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);

  if (user?.accountTier === 'premium') return children;

  return (
    <>
      <div className="premium-gate-wrap">
        <div className="premium-gate-content" aria-hidden="true">{children}</div>
        <div className="premium-overlay" onClick={() => setShowModal(true)}>
          <div className="premium-overlay-hint">🔒 Premium feature — click to unlock</div>
        </div>
      </div>
      {showModal && (
        <div className="premium-modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="premium-modal" onClick={(e) => e.stopPropagation()}>
            <div className="premium-modal-title"><i className="fa-solid fa-rocket" /> Upgrade to Premium</div>
            <div className="premium-modal-body">Unlock the full power of Scanr — this feature is available to Premium members only.</div>
            <div className="premium-modal-actions">
              <button className="premium-modal-btn" onClick={() => navigate('/pricing')}>View Plans</button>
              <button className="premium-modal-btn secondary" onClick={() => setShowModal(false)}>Maybe Later</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
