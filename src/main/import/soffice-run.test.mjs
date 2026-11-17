// Tests convertWithSoffice with fake `soffice` scripts. node --experimental-detect-module ...
import fs from 'fs';
import os from 'os';
import path from 'path';
import { convertWithSoffice } from './soffice-run.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; } else { fail++; console.error(`✗ ${label}`); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-so-'));
const fake = (name, body) => { const p = path.join(dir, name); fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return p; };
const src = path.join(dir, 'deck.pptx'); fs.writeFileSync(src, 'x');

if (process.platform !== 'win32') {
  // success: writes <outdir>/deck.pdf (outdir follows --outdir)
  const good = fake('good', 'while [ "$1" != "--outdir" ]; do shift; done; printf %%PDF > "$2/deck.pdf"');
  const r1 = await convertWithSoffice(good, src, 10000);
  ok('success returns pdf bytes', r1.ok && r1.pdf.toString() === '%PDF' && r1.name === 'deck');
  // exit 0 but no file (corrupt / password protected)
  const none = fake('none', 'exit 0');
  const r2 = await convertWithSoffice(none, src, 10000);
  ok('no PDF → clear message', !r2.ok && /produced no PDF/.test(r2.error) && /export the deck to PDF/.test(r2.error));
  // non-zero exit
  const bad = fake('bad', 'exit 3');
  const r3 = await convertWithSoffice(bad, src, 10000);
  ok('crash → clear message, not raw spawn text', !r3.ok && /could not convert/.test(r3.error) && !/spawn|Command failed/.test(r3.error));
  // hang → timeout resolves quickly instead of blocking forever
  const hang = fake('hang', 'exec sleep 30');
  const t0 = Date.now();
  const r4 = await convertWithSoffice(hang, src, 400);
  ok('hang times out with clear message', !r4.ok && /timed out/.test(r4.error) && Date.now() - t0 < 5000);
  // not executable / missing
  const r5 = await convertWithSoffice(path.join(dir, 'nope'), src, 5000);
  ok('missing binary → clear message', !r5.ok && /could not be started/.test(r5.error));
  // temp dirs are cleaned up
  ok('no temp leak', fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('cue-pptx-')).length === 0);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`soffice-run: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
