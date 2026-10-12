import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import niatLogo from '../assets/niat_logo.png';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const result = await login(email, password);
    if (result.success) {
      navigate('/');
    } else {
      setError(result.error);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
      <div className="glass-panel fade-in" style={{ width: '100%', maxWidth: '440px', padding: '3rem 2.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ marginBottom: '1.25rem' }}>
            <img src={niatLogo} alt="NIAT" style={{ height: '100px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <h1 className="page-title text-gradient" style={{ fontSize: '1.85rem', fontWeight: 900 }}>NIAT Infra Tracker</h1>
          <p className="text-secondary mt-2">Access the Command Center</p>
        </div>

        {error && (
          <div className="blocker-alert" style={{ marginBottom: '1.5rem', background: 'rgba(239, 68, 68, 0.2)' }}>
            <p className="text-danger font-semibold">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}><Mail size={16} /> Email Address</label>
            <input
              type="email"
              className="form-input"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}><Lock size={16} /> Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="button button-primary" style={{ marginTop: '1rem', padding: '0.875rem', fontSize: '1rem', fontWeight: 800 }}>
            Secure Login
          </button>
        </form>
      </div>
    </div>
  );
}
