import { useEffect } from 'react';

// Tracks how many modal-like components are currently mounted. The
// document-level operator shortcuts in OperatorView stand down while
// count > 0 so Esc/Space/G/arrows don't fire transport actions under
// an open modal (e.g. pressing Esc to close a song editor should
// not also blank the live program).
let count = 0;

export function hasOpenModal() { return count > 0; }

// Register the calling component as an open modal for its lifetime.
// Call unconditionally at the top of the component function (Rules of Hooks),
// before any early returns.
export function useModalGuard() {
  useEffect(() => {
    count++;
    return () => { count--; };
  }, []);
}
