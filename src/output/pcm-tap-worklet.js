// ── Program-audio PCM tap (AudioWorkletProcessor) ────────────────────────────
// Runs in the audio rendering thread of the primary audio output window. It
// accumulates the incoming Float32 samples (delivered ~128 at a time) into fixed
// frames and posts each frame, PLANAR, to the main thread. Main fans it out to the
// NDI sender(s) and/or the RTMP encoder. Batching keeps the IPC rate sane (~47
// messages/sec at 48 kHz instead of ~375).
const FRAME_SAMPLES = 1024;

class PcmTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._channels = 0;
    this._buffers = null; // Float32Array[] — one accumulator per channel
    this._filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true; // no upstream yet
    const channels = input.length;
    const frames = input[0].length;
    if (frames === 0) return true;

    if (!this._buffers || this._channels !== channels) {
      this._channels = channels;
      this._buffers = Array.from({ length: channels }, () => new Float32Array(FRAME_SAMPLES));
      this._filled = 0;
    }

    let offset = 0;
    while (offset < frames) {
      const take = Math.min(FRAME_SAMPLES - this._filled, frames - offset);
      for (let c = 0; c < channels; c++) {
        this._buffers[c].set(input[c].subarray(offset, offset + take), this._filled);
      }
      this._filled += take;
      offset += take;

      if (this._filled >= FRAME_SAMPLES) {
        // Pack planar: [ch0 samples…, ch1 samples…]. One transferable ArrayBuffer.
        const planar = new Float32Array(FRAME_SAMPLES * channels);
        for (let c = 0; c < channels; c++) planar.set(this._buffers[c], c * FRAME_SAMPLES);
        this.port.postMessage(
          { planar: planar.buffer, channels, samples: FRAME_SAMPLES, sampleRate },
          [planar.buffer],
        );
        this._filled = 0;
      }
    }
    return true; // keep processor alive
  }
}

registerProcessor('cue-pcm-tap', PcmTapProcessor);
