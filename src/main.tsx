import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './ui.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the service worker for offline shell + install prompt eligibility.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI).href;
    navigator.serviceWorker.register(swUrl).catch(() => {
      /* offline support is best-effort */
    });
  });
}
