import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '../config/supabase';

const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

// Zone definitions
export const ZONES = {
  1: { name: 'Zone 1 — AP & Telangana', states: ['Andhra Pradesh', 'Telangana'] },
  2: { name: 'Zone 2 — Kerala & Tamil Nadu', states: ['Kerala', 'Tamil Nadu'] },
  3: { name: 'Zone 3 — Karnataka', states: ['Karnataka'] },
  4: { name: 'Zone 4 — MH / MP / GJ', states: ['Maharashtra', 'Madhya Pradesh', 'Gujarat'] },
  5: { name: 'Zone 5 — East & North', states: ['Odisha', 'Rajasthan', 'West Bengal', 'Delhi NCR', 'Uttar Pradesh'] },
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [users, setUsers] = useState([]);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        if (!supabase) {
          setLoading(false);
          return;
        }

        // 1. Get initial session
        const { data: { session } } = await supabase.auth.getSession();
        if (mounted && session) {
          await handleUserSession(session);
        } else if (mounted) {
          setLoading(false);
        }

        // 2. Listen for future changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (!mounted) return;

          if (event === 'SIGNED_IN' && session) {
            await handleUserSession(session);
          } else if (event === 'SIGNED_OUT') {
            setUser(null);
            setUsers([]);
            setLoading(false);
          }
        });

        return () => {
          mounted = false;
          if (subscription) subscription.unsubscribe();
        };
      } catch (err) {
        console.error('Auth initialization error:', err);
        if (mounted) setLoading(false);
      }
    };

    initAuth();
  }, []);

  const handleUserSession = async (session) => {
    if (!session?.user) {
      setLoading(false);
      return;
    }

    try {
      // Fetch profile with a timeout/safety
      const { data: profiles, error } = await supabase
        .from('personnel')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      
      let profile = profiles;
      
      // Fallback to email if ID match fails (for legacy or newly linked accounts)
      if (!profile) {
        const { data: emailProfiles } = await supabase
          .from('personnel')
          .select('*')
          .eq('email', session.user.email)
          .maybeSingle();
        profile = emailProfiles;
      }
      
      if (profile && profile.is_active === false) {
        await supabase.auth.signOut();
        setUser(null);
        setLoading(false);
        return;
      }

      const userData = {
        id: session.user.id,
        email: session.user.email,
        name: profile?.name || session.user.user_metadata?.full_name || session.user.email.split('@')[0],
        role: profile?.role || session.user.user_metadata?.role || 'ops',
        zoneIds: profile?.zone_ids || [],
        universityIds: profile?.university_ids || [],
        lastSignIn: session.user.last_sign_in_at
      };

      setUser(userData);
      if (userData.role === 'admin') fetchUsers();
    } catch (err) {
      console.error('handleUserSession error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('personnel')
        .select('*')
        .order('name', { ascending: true });

      if (!error && data) {
        setUsers(data);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  };

  const login = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: password,
      });

      if (error) throw error;

      if (data.user) {
        // Load full profile from personnel table immediately
        let { data: profiles } = await supabase
          .from('personnel')
          .select('*')
          .eq('id', data.user.id);

        if (!profiles || profiles.length === 0) {
          const { data: emailProfiles } = await supabase
            .from('personnel')
            .select('*')
            .eq('email', data.user.email);
          profiles = emailProfiles;
        }

        const profile = profiles && profiles.length > 0 ? profiles[0] : null;

        const userData = {
          id: data.user.id,
          email: data.user.email,
          name: profile?.name || data.user.user_metadata?.full_name || data.user.email.split('@')[0],
          role: profile?.role || data.user.user_metadata?.role || 'admin',
          zoneIds: profile?.zone_ids || [],
          universityIds: profile?.university_ids || [],
          lastSignIn: data.user.last_sign_in_at
        };
        setUser(userData);
        if (userData.role === 'admin') fetchUsers();
        return { success: true };
      }
    } catch (err) {
      console.error('Login error:', err.message);
      return { success: false, error: err.message };
    }
  };

  const logout = async () => {
    try {
      // 1. Tell Supabase to end session
      await supabase.auth.signOut();
      
      // 2. Clear local storage explicitly
      localStorage.clear();
      sessionStorage.clear();
      
      // 3. Clear local state
      setUser(null);
      setUsers([]);
      
      // 4. Force a hard redirect to login to clear all context/state
      window.location.href = '/login';
    } catch (err) {
      console.error('Logout error:', err);
      // Fallback
      window.location.href = '/login';
    }
  };

  const refreshUsers = () => fetchUsers();

  return (
    <AuthContext.Provider value={{ user, users, loading, login, logout, refreshUsers, ZONES }}>
      {loading ? (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
            <div className="flex flex-col items-center gap-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary"></div>
              <p className="text-secondary font-medium animate-pulse">Initializing Command Center...</p>
            </div>
          </div>
        </div>
      ) : children}
    </AuthContext.Provider>
  );
};
