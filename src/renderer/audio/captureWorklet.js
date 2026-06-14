// AudioWorklet processor: downsamples the captured input to 16 kHz mono Int16 PCM
// and posts ~250 ms frames to the main thread. Whisper wants 16 kHz mono; the
// hardware AudioContext is usually 44.1/48 kHz, so we linearly resample with a
// persistent fractional read position across process() blocks.
//
// Runs in the AudioWorklet realm (no DOM, no window). Loaded via
// audioWorklet.addModule(new URL('./captureWorklet.js', import.meta.url)).

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 4000; // 250 ms at 16 kHz

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ratio = sampleRate / TARGET_RATE; // sampleRate = context rate (global)
    this._pos = 0;                            // fractional read position
    this._tail = 0;                           // last sample of previous block (for interp)
    this._out = new Int16Array(FRAME_SAMPLES);
    this._n = 0;
  }

  _emit() {
    const buf = this._out.buffer.slice(0, this._n * 2);
    this.port.postMessage(buf, [buf]);
    this._out = new Int16Array(FRAME_SAMPLES);
    this._n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;

    // Resample this block. _pos is relative to the start of this block.
    while (this._pos < ch.length) {
      const i = Math.floor(this._pos);
      const frac = this._pos - i;
      const a = i === 0 ? this._tail : ch[i - 1];
      const b = ch[i];
      const s = a + (b - a) * frac;              // linear interpolation
      this._out[this._n++] = Math.max(-32768, Math.min(32767, s * 32768)) | 0;
      if (this._n >= FRAME_SAMPLES) this._emit();
      this._pos += this._ratio;
    }
    this._pos -= ch.length;       // carry the fractional remainder into the next block
    this._tail = ch[ch.length - 1];
    return true;
  }
}

registerProcessor('cue-capture', CaptureProcessor);
