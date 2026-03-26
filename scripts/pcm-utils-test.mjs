import assert from 'node:assert/strict';
import {
  concatFloat32Arrays,
  resampleAudio,
} from '../src/pcm-capture.js';

const chunkA = new Float32Array([0, 0.5, 1]);
const chunkB = new Float32Array([-1, -0.5]);
const merged = concatFloat32Arrays([chunkA, chunkB], 5);

assert.equal(merged.length, 5);
assert.deepEqual(Array.from(merged), [0, 0.5, 1, -1, -0.5]);

const passthrough = resampleAudio(chunkA, 16000, 16000);
assert.strictEqual(passthrough, chunkA);

const downsampled = resampleAudio(new Float32Array([0, 1, 0, -1]), 32000, 16000);
assert.equal(downsampled.length, 2);
assert.ok(Number.isFinite(downsampled[0]));
assert.ok(Number.isFinite(downsampled[1]));

console.log('PCM utility tests passed.');
