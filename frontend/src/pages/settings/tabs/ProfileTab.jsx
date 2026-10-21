import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';

export default function ProfileTab() {
  const { refreshUser } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pfp, setPfp] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [okMsg, setOkMsg] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get('/api/settings').then((s) => {
      if (s.firstName) setFirstName(s.firstName);
      if (s.lastName) setLastName(s.lastName);
      if (s.displayName) setDisplayName(s.displayName);
      if (s.profilePicture) setPfp(s.profilePicture);
    }).catch(() => {});
  }, []);

  function loadPfp(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPfp(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function clearPfp() {
    setPfp(null);
    await api.post('/api/settings', { profilePicture: null });
  }

  async function save() {
    if (newPassword && newPassword !== confirmPassword) {
      setErrMsg('Passwords do not match');
      setTimeout(() => setErrMsg(''), 3000);
      return;
    }
    try {
      const body = { firstName: firstName.trim(), lastName: lastName.trim(), displayName: displayName.trim() };
      if (pfp) body.profilePicture = pfp;
      if (newPassword) body.appPassword = newPassword;
      await api.post('/api/settings', body);
      setNewPassword('');
      setConfirmPassword('');
      await refreshUser();
      setOkMsg(true);
      setTimeout(() => setOkMsg(false), 2500);
    } catch (e) {
      setErrMsg(e.message);
      setTimeout(() => setErrMsg(''), 4000);
    }
  }

  return (
    <div>
      <div className="sp-grid">
        <div className="sp-card">
          <div className="sp-card-title">Personal Info</div>
          <div className="s-row"><label>First Name</label><input type="text" className="s-input-full" placeholder="e.g. Alex" maxLength={40} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
          <div className="s-row"><label>Last Name</label><input type="text" className="s-input-full" placeholder="e.g. Smith" maxLength={40} value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
          <div className="s-row"><label>Display Name / Handle</label><input type="text" className="s-input-full" placeholder="e.g. alex_trades" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Profile Picture</div>
          <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: pfp ? 'transparent' : 'var(--bg-elevated)', border: '2px solid var(--border-mid)', margin: '0 auto 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', overflow: 'hidden' }}>
              {pfp ? <img src={pfp} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : '👤'}
            </div>
            <label style={{ display: 'inline-block', background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.7rem', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              Upload Photo
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={loadPfp} />
            </label>
            <button onClick={clearPfp} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.78rem', cursor: 'pointer', marginLeft: '0.5rem' }}>Remove</button>
          </div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Security</div>
          <div className="s-row"><label>New Password</label><input type="password" className="s-input-full" placeholder="Enter new password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
          <div className="s-row"><label>Confirm Password</label><input type="password" className="s-input-full" placeholder="Repeat new password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></div>
        </div>
      </div>
      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        <button onClick={save} style={{ background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '0.5rem 1.4rem', fontSize: '0.9rem', fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>💾 Save Profile</button>
        {okMsg && <span style={{ fontSize: '0.82rem', color: 'var(--accent-green)', fontWeight: 600 }}>✓ Profile saved!</span>}
        {errMsg && <span style={{ fontSize: '0.82rem', color: 'var(--accent-red)', fontWeight: 600 }}>{errMsg}</span>}
      </div>
    </div>
  );
}
