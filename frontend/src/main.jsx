import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Register PWA service worker safely in production and outside sandboxed iframes
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    try {
      if (window.self !== window.top) return; // Skip in iframes / simulator tools
    } catch {
      return;
    }

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[PWA] Service Worker active with scope:', reg.scope);
      })
      .catch((err) => {
        if (err && err.name !== 'SecurityError') {
          console.warn('[PWA] Service Worker registration note:', err);
        }
      });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
