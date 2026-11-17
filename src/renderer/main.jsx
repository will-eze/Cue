import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider, useToast } from './components/Toast';
import { cleanErrorMessage, isBenignError } from './utils/errorMessage';
import './index.css';

// Last-resort visibility for async failures that React error boundaries can't catch
// (they only catch render-phase throws). These never crash the app. They are logged and
// also surfaced as a debounced error toast so the operator is told something failed.
const toastBridge = { current: null };
const recent = new Map(); // message -> last shown (ms)
let shownAt = [];
function surface(err, raw) {
  try {
    if (isBenignError(err, raw)) return;
    const toast = toastBridge.current;
    if (!toast) return;
    const msg = cleanErrorMessage(err ?? raw);
    const now = Date.now();
    if (now - (recent.get(msg) || 0) < 10000) return;
    shownAt = shownAt.filter((t) => now - t < 60000);
    if (shownAt.length >= 3) return;
    recent.set(msg, now);
    shownAt.push(now);
    toast.error(msg);
  } catch { /* never let the reporter throw */ }
}
window.addEventListener('error', (e) => {
  console.error('[window.onerror]', e.error || e.message);
  surface(e.error, e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
  surface(e.reason);
});

function ToastBridge() {
  const toast = useToast();
  toastBridge.current = toast;
  return null;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <ToastBridge />
      <App />
    </ToastProvider>
  </React.StrictMode>
);
