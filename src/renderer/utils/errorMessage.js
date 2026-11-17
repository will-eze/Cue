// Turn a thrown value into a short, plain-language message for an operator.
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Your outputs are still running.';

export function cleanErrorMessage(err, max = 160) {
  let msg = '';
  if (typeof err === 'string') msg = err;
  else if (err && typeof err.message === 'string') msg = err.message;
  // Electron wraps IPC failures: "Error invoking remote method 'x:y': Error: real message"
  msg = msg.replace(/^\s*Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/i, '');
  msg = msg.replace(/^\s*(?:Uncaught\s+)?(?:[A-Za-z]*Error:\s*)+/i, '');
  msg = msg.replace(/\s+/g, ' ').trim();
  if (!msg || msg === '[object Object]') return GENERIC_ERROR_MESSAGE;
  if (msg.length > max) msg = msg.slice(0, max - 1).trimEnd() + '…';
  return msg;
}

// Benign noise that must never reach the operator.
export function isBenignError(err, rawMessage) {
  const m = String((err && err.message) || rawMessage || err || '');
  if (/ResizeObserver loop/i.test(m)) return true;
  if (err && err.name === 'AbortError') return true;
  if (/\baborted\b|AbortError|The user aborted a request/i.test(m)) return true;
  return false;
}
