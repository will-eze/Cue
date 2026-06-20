import { useEffect, useRef, useState, useCallback } from 'react';
// Vite `?worker` import (same pattern as the pdfjs worker) — bundles whisper-worker.web.js
// as a Web Worker the renderer instantiates with `new WhisperWorker()`.
import WhisperWorker from './whisper-worker.web.js?worker';

// Backend selector for scripture ASR. Owns the engine decision + the WebGPU worker
// lifecycle; the CPU path stays in main (asr.js) exactly as before.
//
// Engine resolution (strictly additive — no device is ever worse than the CPU build):
//   • asrEngine pref 'cpu'            → CPU
//   • 'webgpu' / 'auto' AND a HARDWARE navigator.gpu adapter AND the selected gpuModel is
//     already downloaded                → WebGPU
//   • otherwise                        → CPU
// Per the opt-in rule, the worker only LOADS an already-cached model on arm; it never
// downloads here (that's the explicit Settings button). If the model isn't downloaded we
// resolve to CPU rather than trigger a fetch.
//
// Returns { engine, pushFrame, adapterLabel, gpuAdapter } — useScriptureCapture feeds each
// 16 kHz Int16 frame to pushFrame (→ worker on WebGPU, → main IPC on CPU).
export function useScriptureAsr(armed, cfg) {
  const [gpuAdapter, setGpuAdapter] = useState(null); // { label } | null (no hardware GPU)
  const [probed, setProbed] = useState(false);        // adapter probe finished (gates arm)
  const [engine, setEngine] = useState('cpu');        // resolved active engine
  const workerRef = useRef(null);
  const engineRef = useRef('cpu');                     // latest engine for pushFrame routing

  // ── one-time hardware-adapter probe ────────────────────────────────────────
  // Arm waits for this so a GPU box doesn't briefly resolve to CPU and kick off a CPU
  // model download before the adapter is known.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.gpu) return;
        const adapter = await navigator.gpu.requestAdapter();
        if (cancelled || !adapter || adapter.isFallbackAdapter) return; // software fallback ≠ usable
        const info = adapter.info || {};
        setGpuAdapter({ label: [info.vendor, info.architecture || info.description].filter(Boolean).join(' ') || 'GPU' });
      } catch { /* no WebGPU → CPU */ }
      finally { if (!cancelled) setProbed(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Resolve which engine should run, given the pref, adapter, and downloaded model.
  const pref = cfg?.asrEngine || 'auto';
  const gpuModel = cfg?.gpuModel || 'small.en';
  const gpuModelDownloaded = !!cfg?.gpuModels?.[gpuModel];
  const wantGpu = pref !== 'cpu' && !!gpuAdapter && gpuModelDownloaded;

  const teardownWorker = useCallback(() => {
    const w = workerRef.current;
    if (w) { try { w.postMessage({ type: 'stop' }); } catch {} try { w.terminate(); } catch {} }
    workerRef.current = null;
  }, []);

  // ── arm/disarm: drive main's engine + (on WebGPU) the worker ────────────────
  useEffect(() => {
    if (!armed || !cfg?.enabled) {
      teardownWorker();
      engineRef.current = 'cpu'; setEngine('cpu');
      if (probed) window.cue.scriptureDetect.stop();
      return undefined;
    }
    if (!probed) return undefined; // wait for the adapter probe before choosing an engine

    let disposed = false;
    const resolved = wantGpu ? 'webgpu' : 'cpu';

    // Fall back to the CPU path. Used both when WebGPU isn't selected and when the worker
    // fails to load (missing weights / unsupported numerics) — never crash, never worse
    // than the shipped build.
    const runCpu = () => {
      teardownWorker();
      engineRef.current = 'cpu'; setEngine('cpu');
      window.cue.scriptureDetect.start('cpu');
    };

    if (resolved === 'cpu') { runCpu(); return () => { window.cue.scriptureDetect.stop(); }; }

    // WebGPU: tell main not to load/arm the CPU model, then spin up the worker.
    window.cue.scriptureDetect.start('webgpu');
    const worker = new WhisperWorker();
    workerRef.current = worker;
    const coreConfig = {
      endSilenceMs: cfg.endSilenceMs,
      interimEnabled: !!cfg.interim?.enabled,
      interimCadenceMs: cfg.interim?.cadenceMs,
      softPauseMs: cfg.interim?.softPauseMs,
    };
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (disposed) return;
      switch (m.type) {
        case 'ready':
          worker.postMessage({ type: 'start', config: coreConfig });
          engineRef.current = 'webgpu'; setEngine('webgpu');
          break;
        case 'commit':
          if (m.text) window.cue.scriptureDetect.ingestTranscript({ text: m.text, interim: false, onsetAt: m.onsetAt });
          break;
        case 'interim':
          if (m.text) window.cue.scriptureDetect.ingestTranscript({ text: m.text, interim: true, onsetAt: m.onsetAt });
          break;
        case 'error':
          // Load/decode failure → fall back to CPU so detection still works.
          console.warn('[scripture-asr] WebGPU worker error, falling back to CPU:', m.error);
          if (!disposed) runCpu();
          break;
        default:
          break;
      }
    };
    worker.onerror = (err) => {
      console.warn('[scripture-asr] WebGPU worker crashed, falling back to CPU:', err?.message);
      if (!disposed) runCpu();
    };
    // Load the already-cached model (never downloads — allowDownload:false).
    worker.postMessage({ type: 'load', model: gpuModel, allowDownload: false });

    return () => {
      disposed = true;
      teardownWorker();
      window.cue.scriptureDetect.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, cfg?.enabled, probed, wantGpu, gpuModel, cfg?.endSilenceMs, cfg?.interim?.enabled, cfg?.interim?.cadenceMs, cfg?.interim?.softPauseMs]);

  // Frame sink — routes by the LIVE engine (ref, so it survives a mid-session fallback).
  const pushFrame = useCallback((int16) => {
    if (engineRef.current === 'webgpu' && workerRef.current) {
      const buf = int16.buffer;
      workerRef.current.postMessage({ type: 'frame', buf }, [buf]);
    } else {
      window.cue.scriptureDetect.pushAudio(int16);
    }
  }, []);

  return { engine, pushFrame, adapterLabel: gpuAdapter?.label || null, gpuAdapter: !!gpuAdapter };
}
