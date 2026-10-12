import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, X, Info, Loader } from 'lucide-react';

const ToastContext = createContext();

export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'success', duration = 4000) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    if (duration !== Infinity) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Toast Container */}
      <div style={{
        position: 'fixed',
        bottom: '2rem',
        right: '2rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        pointerEvents: 'none'
      }}>
        {toasts.map((toast) => (
          <div key={toast.id} className="fade-in" style={{
            pointerEvents: 'auto',
            minWidth: '300px',
            maxWidth: '450px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '1rem',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            borderLeft: `4px solid ${
              toast.type === 'success' ? '#10b981' : 
              toast.type === 'error' ? '#ef4444' : 
              toast.type === 'warning' ? '#f59e0b' : '#3b82f6'
            }`
          }}>
            <div style={{ 
              color: toast.type === 'success' ? '#10b981' : 
                     toast.type === 'error' ? '#ef4444' : 
                     toast.type === 'warning' ? '#f59e0b' : '#3b82f6',
              display: 'flex'
            }}>
              {toast.type === 'success' && <CheckCircle size={20} />}
              {toast.type === 'error' && <AlertCircle size={20} />}
              {toast.type === 'warning' && <AlertCircle size={20} />}
              {toast.type === 'info' && <Info size={20} />}
            </div>
            
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {toast.message}
              </p>
            </div>

            <button onClick={() => removeToast(toast.id)} style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              padding: '4px',
              borderRadius: '50%',
              transition: 'background 0.2s'
            }} onMouseOver={e => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'} onMouseOut={e => e.currentTarget.style.background = 'none'}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
