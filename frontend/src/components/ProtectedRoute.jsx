import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Layout from './Layout';

export default function ProtectedRoute({ children, withLayout = true, requireAdmin = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null; // avoid a login flash while session-check resolves
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  // Mirrors requireAdmin in server.js, which redirects non-admins to '/' for page routes.
  if (requireAdmin && user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return withLayout ? <Layout>{children}</Layout> : children;
}
