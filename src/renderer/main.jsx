import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Toast';
import './index.css';

// Last-resort visibility for async failures that React error boundaries can't catch
// (they only catch render-phase throws). These never crash the app — just stop being
// silent so a misbehaving promise/event handler leaves a trail.
window.addEventListener('error', (e) => {
  console.error('[window.onerror]', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
