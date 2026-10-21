import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import ChallengeList from './pages/ChallengeList';
import ChallengeDetail from './pages/ChallengeDetail';
import PnlCalendar from './pages/PnlCalendar';
import LicenseActivate from './pages/LicenseActivate';
import Suspended from './pages/Suspended';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import Refund from './pages/Refund';
import Features from './pages/Features';
import Pricing from './pages/Pricing';
import SetupGuide from './pages/SetupGuide';
import Home from './pages/Home';
import Admin from './pages/admin/Admin';
import Settings from './pages/settings/Settings';
import Setups from './pages/Setups';
import Strategy from './pages/Strategy';
import Terminal from './pages/Terminal';
import CoinDetail from './pages/CoinDetail';
import Scanner from './pages/Scanner';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/challenge"
            element={
              <ProtectedRoute>
                <ChallengeList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/challenge/:id"
            element={
              <ProtectedRoute>
                <ChallengeDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/calendar"
            element={
              <ProtectedRoute>
                <PnlCalendar />
              </ProtectedRoute>
            }
          />
          <Route
            path="/license"
            element={
              <ProtectedRoute withLayout={false}>
                <LicenseActivate />
              </ProtectedRoute>
            }
          />
          <Route
            path="/suspended"
            element={
              <ProtectedRoute withLayout={false}>
                <Suspended />
              </ProtectedRoute>
            }
          />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/refund" element={<Refund />} />
          <Route path="/features" element={<Features />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/setup-guide" element={<SetupGuide />} />
          <Route path="/" element={<Home />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute withLayout={false} requireAdmin>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/setups"
            element={
              <ProtectedRoute>
                <Setups />
              </ProtectedRoute>
            }
          />
          <Route
            path="/strategy"
            element={
              <ProtectedRoute>
                <Strategy />
              </ProtectedRoute>
            }
          />
          <Route
            path="/terminal"
            element={
              <ProtectedRoute>
                <Terminal />
              </ProtectedRoute>
            }
          />
          <Route
            path="/coin-detail"
            element={
              <ProtectedRoute>
                <CoinDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scanner"
            element={
              <ProtectedRoute>
                <Scanner />
              </ProtectedRoute>
            }
          />
          {/* Everything else still lives on the Express-rendered pages during the migration. */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
