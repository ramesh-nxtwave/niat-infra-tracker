import React, { createContext, useContext, useState, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const ConfirmContext = createContext();

export const useConfirm = () => useContext(ConfirmContext);

export const ConfirmProvider = ({ children }) => {
  const [config, setConfig] = useState(null);

  const confirm = useCallback((title, message, options = {}) => {
    return new Promise((resolve) => {
      setConfig({
        title,
        message,
        confirmLabel: options.confirmLabel || 'Confirm',
        cancelLabel: options.cancelLabel || 'Cancel',
        isDanger: options.isDanger !== false,
        resolve
      });
    });
  }, []);

  const handleConfirm = () => {
    config.resolve(true);
    setConfig(null);
  };

  const handleCancel = () => {
    config.resolve(false);
    setConfig(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      
      {config && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)'
        }}>
          <div className="fade-in" style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '24px',
            padding: '2rem',
            width: '100%',
            maxWidth: '400px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            textAlign: 'center'
          }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: config.isDanger ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.5rem',
              color: config.isDanger ? '#ef4444' : '#3b82f6'
            }}>
              <AlertTriangle size={32} />
            </div>

            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
              {config.title}
            </h2>
            
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.6 }}>
              {config.message}
            </p>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={handleCancel} className="button button-secondary" style={{ flex: 1 }}>
                {config.cancelLabel}
              </button>
              <button onClick={handleConfirm} className="button" style={{ 
                flex: 1, 
                background: config.isDanger ? '#ef4444' : 'var(--accent-primary)',
                color: 'white'
              }}>
                {config.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};
