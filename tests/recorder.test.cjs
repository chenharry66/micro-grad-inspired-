const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const rate of [16000, 44100, 48000]) {
  let Recorder, result;
  const scope = {
    sampleRate: rate, Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => { result = value; } }; } },
    registerProcessor: (_name, cls) => { Recorder = cls; },
  };
  vm.runInNewContext(fs.readFileSync('web/recorder-worklet.js', 'utf8'), scope);
  const recorder = new Recorder();
  assert.equal(recorder.process([[]]), true);
  // Vary block lengths: capture must stop at exactly one second, not a block boundary.
  let offset = 0;
  while (!result) {
    const length = offset % 3 ? 128 : 256;
    const left = new Float32Array(length).fill(.75);
    const right = new Float32Array(length).fill(.25);
    recorder.process([[left, right]]);
    offset += length;
  }
  assert.equal(result.samples.length, rate);
  assert.equal(result.sampleRate, rate);
  assert.ok(result.samples.every(x => x === .5));
  assert.equal(recorder.process([[new Float32Array(128)]]), false);
}
console.log('Recorder checks passed: exact one second at 16/44.1/48 kHz, stereo downmix, variable blocks.');
