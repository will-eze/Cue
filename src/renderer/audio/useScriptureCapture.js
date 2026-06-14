import { useEffect, useState } from 'react';
// Import the worklet as raw source and load it via a Blob URL. A bundled `?url`
// gets inlined to a `data:` URL in packaged builds (file:// origin), which
// audioWorklet.addModule() handles unreliably; a Blob URL is same-origin and
// always fetchable. (Same class of issue as the pdfjs worker — see CLAUDE.md.)
import workletSource from './captureWorklet.js?raw';

// Capture the selected audio input and stream 16 kHz mono Int16 PCM to main for
// scripture detection. getUserMedia + device enumeration are browser APIs, so
// capture lives in the renderer; the PCM bitrate is trivial (~32 KB/s) so IPC is
// fine. Browser DSP (echo cancel / noise suppression / AGC) is DISABLED — it
// harms ASR on a clean line feed.
//
// Returns { active, error }. Runs only while `enabled` is true.
export function useScriptureCapture(enabled, deviceId) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let ctx, stream, node, cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: false, noiseSuppression: false, autoGainControl: false,
            channelCount: 1,
          },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        // Run the context natively at 16 kHz so Chromium's high-quality (anti-aliased)
        // resampler does the 48k→16k conversion. The worklet then runs at ratio≈1, i.e.
        // no decimation, so we avoid the aliasing the old hand-rolled linear downsampler
        // introduced — aliasing measurably hurts Whisper accuracy.
        ctx = new AudioContext({ sampleRate: 16000 });
        if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* best effort */ } }
        const blobUrl = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }));
        try { await ctx.audioWorklet.addModule(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
        if (cancelled) { ctx.close(); stream.getTracks().forEach((t) => t.stop()); return; }
        const source = ctx.createMediaStreamSource(stream);
        node = new AudioWorkletNode(ctx, 'cue-capture');
        node.port.onmessage = (e) => { window.cue.scriptureDetect.pushAudio(new Int16Array(e.data)); };
        source.connect(node);
        // Keep the worklet pulling without routing mic audio to the speakers.
        const sink = ctx.createGain(); sink.gain.value = 0;
        node.connect(sink); sink.connect(ctx.destination);
        setActive(true); setError(null);
      } catch (err) {
        setError(err.message || 'Microphone access failed');
        setActive(false);
      }
    })();

    return () => {
      cancelled = true;
      setActive(false);
      try { node?.disconnect(); } catch {}
      try { ctx?.close(); } catch {}
      try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
    };
  }, [enabled, deviceId]);

  return { active, error };
}
