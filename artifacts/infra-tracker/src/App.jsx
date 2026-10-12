import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { DataProvider } from './context/DataContext';
import { AuthProvider, useAuth, ZONES } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import UniversityList from './pages/UniversityList';
import UniversityDetail from './pages/UniversityDetail';
import MasterTracker from './pages/MasterTracker';
import EvidenceBoard from './pages/EvidenceBoard';
import Login from './pages/Login';
import AccessManagement from './pages/AccessManagement';
import DailyReports from './pages/DailyReports';
import AiAssistant from './pages/AiAssistant';
import { LogOut, AlertTriangle, Moon, Sun } from 'lucide-react';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { useData } from './context/DataContext';
import {
  CORE_NAV_ITEMS,
  PORTAL_ROLES,
  privilegedNavItemsForRole,
} from './access/coreAccess';

const niatLogo = `${import.meta.env?.BASE_URL || '/'}niat_logo.png`;

// ── ERROR BOUNDARY ────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Global Crash Caught:", error, errorInfo);
  }

  handleReset = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)', padding: '2rem' }}>
          <div className="glass-panel" style={{ maxWidth: '500px', textAlign: 'center', padding: '3rem', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <div style={{ color: '#ef4444', marginBottom: '1.5rem' }}>
              <AlertTriangle size={64} />
            </div>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>System Interruption</h1>
            <p className="text-secondary mb-8">
              The application encountered an unexpected error. This usually happens due to stale session data.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <button className="button button-primary w-full" onClick={this.handleReset}>
                Reset System & Login
              </button>
              <button className="button button-secondary w-full" onClick={() => window.location.reload()}>
                Try Refreshing
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Protected Route Component
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)', color: 'white' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
          <p className="text-secondary">Verifying session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/universities" replace />;
  }

  return children;
};

function useTheme() {
  const [dark, setDark] = React.useState(() =>
    (localStorage.getItem('niat_theme') || 'light') === 'dark'
  );
  React.useEffect(() => {
    const theme = dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('niat_theme', theme);
  }, [dark]);
  return [dark, setDark];
}

function Navbar() {
  const { user, logout } = useAuth();
  const [dark, setDark] = useTheme();
  if (!user) return null;
  const privilegedNavItems = privilegedNavItemsForRole(user.role);

  return (
    <nav className="navbar mb-8">
      <div className="nav-container">
        <Link to="/" className="nav-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', textDecoration: 'none' }}>
          <img src={niatLogo} alt="NIAT" style={{ height: '36px', width: 'auto', objectFit: 'contain' }} />
          <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-primary)', letterSpacing: '-0.01em' }}>InfraTracker</span>
        </Link>
        <div className="nav-links">
          {CORE_NAV_ITEMS.map(item => (
            <Link key={item.to} to={item.to} className="nav-link">{item.label}</Link>
          ))}
          {privilegedNavItems.map(item => (
            <Link key={item.to} to={item.to} className="nav-link">{item.label}</Link>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          {user && (
            <div style={{ textAlign: 'right', cursor: 'default' }} className="user-profile-info">
              <p className="font-semibold text-sm m-0" style={{ color: 'var(--text-primary)', lineHeight: 1.2 }}>{user.name}</p>
              <p className="text-secondary" style={{ fontSize: '0.7rem', margin: 0 }}>
                {user.role === 'zonal_manager' 
                  ? (ZONES[user.zoneIds?.[0]]?.name?.split('—')[1]?.trim() || ZONES[user.zoneId]?.name?.split('—')[1]?.trim() || 'Zonal Manager') 
                  : user.role}
              </p>
            </div>
          )}
          <button
            onClick={() => setDark(d => !d)}
            title={dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{ padding: '0.5rem', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-secondary)', transition: 'all 0.2s' }}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button onClick={logout} className="button button-secondary"
            style={{ padding: '0.5rem', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Log Out">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
}


function MainContent() {
  const { error: dataError } = useData();

  if (dataError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)', padding: '2rem' }}>
        <div className="glass-panel" style={{ maxWidth: '400px', textAlign: 'center', padding: '3rem', border: '1px solid var(--danger)' }}>
          <div style={{ color: 'var(--danger)', marginBottom: '1.5rem' }}>
            <AlertTriangle size={48} />
          </div>
          <h2 style={{ marginBottom: '1rem' }}>Connection Interrupted</h2>
          <p className="text-secondary mb-6">We're having trouble reaching the command center. This might be a temporary database issue.</p>
          <button className="button button-primary w-full" onClick={() => window.location.reload()}>
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      <Navbar />
      <main>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Core routes available to every supported authenticated role */}
          <Route path="/" element={<Navigate to="/universities" replace />} />
          <Route path="/overview" element={<ProtectedRoute allowedRoles={PORTAL_ROLES}><Dashboard /></ProtectedRoute>} />
          <Route path="/master-tracker" element={<ProtectedRoute allowedRoles={PORTAL_ROLES}><MasterTracker /></ProtectedRoute>} />

          {/* Privileged routes */}
          <Route path="/evidence" element={<ProtectedRoute allowedRoles={['admin', 'zonal_manager']}><EvidenceBoard /></ProtectedRoute>} />
          <Route path="/access-management" element={<ProtectedRoute allowedRoles={['admin']}><AccessManagement /></ProtectedRoute>} />

          {/* All authenticated roles */}
          <Route path="/universities" element={<ProtectedRoute allowedRoles={PORTAL_ROLES}><UniversityList /></ProtectedRoute>} />
          <Route path="/university/:id" element={<ProtectedRoute allowedRoles={PORTAL_ROLES}><UniversityDetail /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute allowedRoles={PORTAL_ROLES}><DailyReports /></ProtectedRoute>} />
          <Route path="/assistant" element={<ProtectedRoute allowedRoles={PORTAL_ROLES}><AiAssistant /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/universities" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ConfirmProvider>
        <ToastProvider>
          <AuthProvider>
            <DataProvider>
              <Router>
                <MainContent />
              </Router>
            </DataProvider>
          </AuthProvider>
        </ToastProvider>
      </ConfirmProvider>
    </ErrorBoundary>
  );
}

export default App;
