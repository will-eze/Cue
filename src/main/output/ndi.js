import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let grandiose = null;
let ndiAvailable = false;

try {
  grandiose = require('grandiose');
  ndiAvailable = true;
} catch {
  ndiAvailable = false;
}

export function isAvailable() {
  return ndiAvailable;
}
