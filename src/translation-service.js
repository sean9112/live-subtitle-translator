import * as OpenCC from 'opencc-js';

const MODELS = {
  asr: 'Xenova/whisper-tiny',
  translators: {
    'en->zh-TW': 'Xenova/opus-mt-en-zh',
    'zh-TW->en': 'Xenova/opus-mt-zh-en',
  },
};

const whisperLanguageMap = {
  en: 'english',
  'zh-TW': 'chinese',
};

const translatorCache = new Map();
let asrPipelinePromise = null;
let transformersModulePromise = null;
let configuredModelCacheDir = null;

const toTaiwanTraditional = OpenCC.Converter({ from: 'cn', to: 'twp' });

async function getTransformersModule() {
  if (!transformersModulePromise) {
    transformersModulePromise = import('@huggingface/transformers').then((module) => {
      if (configuredModelCacheDir) {
        module.env.cacheDir = configuredModelCacheDir;
        module.env.allowLocalModels = true;
      }

      return module;
    });
  }

  return transformersModulePromise;
}

export function configureModelCache(cacheDir) {
  configuredModelCacheDir = cacheDir;

  void getTransformersModule().then(({ env }) => {
    env.cacheDir = cacheDir;
    env.allowLocalModels = true;
  });
}

function getLanguageCode(language) {
  if (language === 'zh-TW' || language === 'en') {
    return language;
  }

  throw new Error(`Unsupported language: ${language}`);
}

async function getAsrPipeline() {
  if (!asrPipelinePromise) {
    asrPipelinePromise = getTransformersModule().then(({ pipeline }) =>
      pipeline(
        'automatic-speech-recognition',
        MODELS.asr,
        { quantized: true },
      ),
    );
  }

  return asrPipelinePromise;
}

async function getTranslator(sourceLanguage, targetLanguage) {
  const key = `${sourceLanguage}->${targetLanguage}`;
  const cached = translatorCache.get(key);
  if (cached) {
    return cached;
  }

  const model = MODELS.translators[key];
  if (!model) {
    throw new Error(`No translator model configured for ${key}`);
  }

  const translatorPromise = getTransformersModule().then(({ pipeline }) =>
    pipeline('translation', model, { quantized: true }),
  );
  translatorCache.set(key, translatorPromise);
  return translatorPromise;
}

function normalizeTextOutput(result) {
  if (!result) {
    return '';
  }

  if (typeof result === 'string') {
    return result.trim();
  }

  if (Array.isArray(result) && result.length > 0) {
    const first = result[0];
    if (typeof first === 'string') {
      return first.trim();
    }

    if (typeof first?.translation_text === 'string') {
      return first.translation_text.trim();
    }

    if (typeof first?.generated_text === 'string') {
      return first.generated_text.trim();
    }
  }

  if (typeof result?.text === 'string') {
    return result.text.trim();
  }

  return '';
}

function normalizeChineseForTaiwan(text) {
  return text ? toTaiwanTraditional(text) : '';
}

export async function warmupModels({ sourceLanguage, targetLanguage }) {
  const normalizedSource = getLanguageCode(sourceLanguage);
  const normalizedTarget = getLanguageCode(targetLanguage);

  await Promise.all([
    getAsrPipeline(),
    getTranslator(normalizedSource, normalizedTarget),
  ]);

  return {
    ok: true,
    sourceLanguage: normalizedSource,
    targetLanguage: normalizedTarget,
  };
}

export async function processAudioChunk(payload) {
  const sourceLanguage = getLanguageCode(payload?.sourceLanguage);
  const targetLanguage = getLanguageCode(payload?.targetLanguage);

  if (sourceLanguage === targetLanguage) {
    throw new Error('Source and target languages must be different.');
  }

  const rawSamples = payload?.samples;
  if (!Array.isArray(rawSamples) || rawSamples.length === 0) {
    return { ok: true, skipped: true };
  }

  const samples = Float32Array.from(rawSamples);
  const asr = await getAsrPipeline();
  const transcriptionResult = await asr(samples, {
    language: whisperLanguageMap[sourceLanguage],
    task: 'transcribe',
  });

  let transcriptionText = normalizeTextOutput(transcriptionResult);
  if (!transcriptionText) {
    return { ok: true, skipped: true };
  }

  if (sourceLanguage === 'zh-TW') {
    transcriptionText = normalizeChineseForTaiwan(transcriptionText);
  }

  const translator = await getTranslator(sourceLanguage, targetLanguage);
  const translationResult = await translator(transcriptionText, {
    max_new_tokens: 256,
  });

  let translationText = normalizeTextOutput(translationResult);
  if (targetLanguage === 'zh-TW') {
    translationText = normalizeChineseForTaiwan(translationText);
  }

  return {
    ok: true,
    skipped: false,
    transcriptionText,
    translationText,
    sourceLanguage,
    targetLanguage,
  };
}
