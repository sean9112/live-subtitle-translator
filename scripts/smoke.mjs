import os from 'node:os';
import path from 'node:path';
import {
  configureModelCache,
  warmupModels,
} from '../src/translation-service.js';

configureModelCache(path.join(os.tmpdir(), 'live-subtitle-translator-models'));

console.log('Smoke check: translation service module loaded.');
console.log('Warmup function available:', typeof warmupModels === 'function');
