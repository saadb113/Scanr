import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      await api.get('/api/auth/session-check');
      const me = await api.get('/api/auth/me');
      setUser(me && me._id ? me : null);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email, password, deviceFingerprint) => {
    const result = await api.post('/api/auth/login', { email, password, deviceFingerprint });
    await refreshUser();
    return result;
  }, [refreshUser]);

  const register = useCallback(async (payload) => {
    const result = await api.post('/api/auth/register', payload);
    await refreshUser();
    return result;
  }, [refreshUser]);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
