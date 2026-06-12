import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Build number ≈ total git commit count, resolved at config eval (dev serve + make).
// Falls back to 0 when git isn't available (e.g. building from a source tarball).
function gitCommitCount() {
  try {
    return parseInt(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// MAJOR = DB schema version, MINOR = features w/o migration, PATCH = fixes/docs/chores.
// Bump this string by hand per the convention in CLAUDE.md; the Build number is automatic.
const APP_VERSION = '19.0.0';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_NUMBER__: JSON.stringify(gitCommitCount()),
  },
});
