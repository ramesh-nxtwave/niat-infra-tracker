import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';

export const ZONES = {
  1: { name: 'Zone 1 — AP & Telangana', states: ['Andhra Pradesh', 'Telangana'], color: '#3b82f6' },
  2: { name: 'Zone 2 — Kerala & Tamil Nadu', states: ['Kerala', 'Tamil Nadu'], color: '#10b981' },
  3: { name: 'Zone 3 — Karnataka', states: ['Karnataka'], color: '#f59e0b' },
  4: { name: 'Zone 4 — MH / MP / GJ', states: ['Maharashtra', 'Madhya Pradesh', 'Gujarat'], color: '#8b5cf6' },
  5: { name: 'Zone 5 — East & North', states: ['Odisha', 'Rajasthan', 'West Bengal', 'Delhi NCR', 'Uttar Pradesh'], color: '#ef4444' },
};

const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

const TOKEN_KEY = 'niat_token';
const USER_KEY = 'niat_user';

const BASE = '/api';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const getToken = () => localStorage.getItem(TOKEN_KEY);

  const authFetch = useCallback(async (url, opts = {}) => {
    const token = getToken();
    const isFormData = opts.body instanceof FormData;
    const headers = { ...(opts.headers || {}) };
    if (!isFormData) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(`${BASE}${url}`, { ...opts, headers });
    if (resp.status === 204) return null;
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const error = new Error(body.error || `HTTP ${resp.status}`);
      error.status = resp.status;
      error.code = body.code;
      error.correlationId = body.correlationId;
      throw error;
    }
    return body;
  }, []);

  // Verify token on mount — only clear session on explicit 401 auth failures.
  // Network errors and server restarts must NOT log the user out.
  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    authFetch('/auth/me')
      .then(u => {
        setUser(u);
        localStorage.setItem(USER_KEY, JSON.stringify(u));
      })
      .catch((err) => {
        const isAuthFailure = err?.status === 401 || err?.status === 403;
        if (isAuthFailure) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setUser(null);
        }
        // Network/server errors: keep the cached user already loaded in useState initialiser
      })
      .finally(() => setLoading(false));
  }, []);  // eslint-disable-line

  const fetchUsers = useCallback(async () => {
    try {
      const resp = await authFetch('/users?limit=500');
      // GET /users now returns { data: [], total, page, pages }
      const list = resp?.data ?? resp;
      setUsers(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }, [authFetch]);

  useEffect(() => {
    if (user?.role === 'admin') fetchUsers();
  }, [user?.role]);  // eslint-disable-line

  const login = async (email, password) => {
    try {
      const data = await authFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setUser(data.user);
      if (data.user?.role === 'admin') fetchUsers();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || 'Login failed' };
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setUsers([]);
    window.location.href = '/login';
  };

  const refreshUsers = () => fetchUsers();

  const createUser = async (payload) => {
    const u = await authFetch('/users', { method: 'POST', body: JSON.stringify(payload) });
    await fetchUsers();
    return u;
  };

  const updateUser = async (id, payload) => {
    const u = await authFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    await fetchUsers();
    return u;
  };

  const deleteUser = async (id) => {
    await authFetch(`/users/${id}`, { method: 'DELETE' });
    await fetchUsers();
  };

  return (
    <AuthContext.Provider value={{
      user, users, loading,
      login, logout,
      getToken, authFetch,
      refreshUsers, createUser, updateUser, deleteUser,
      ZONES,
    }}>
      {loading ? (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: 'var(--accent-primary)' }}></div>
            <p className="text-secondary font-medium animate-pulse">Initializing Command Center...</p>
          </div>
        </div>
      ) : children}
    </AuthContext.Provider>
  );
};
