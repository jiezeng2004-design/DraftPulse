/*
 * xg_settings.js - 回复设置 schema、默认值、校验与旧版本兼容。
 * UMD 包装器：浏览器合并到 DraftPulseShared 命名空间，Node.js 走 module.exports。
 */
(function (global, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    if (!global.DraftPulseShared) global.DraftPulseShared = {};
    Object.assign(global.DraftPulseShared, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROVIDER_IDS = Object.freeze(['gemini', 'chatgpt', 'deepseek']);
  const PERSONA_IDS = Object.freeze(['professional', 'agreeable', 'humorous', 'questioning', 'counter', 'pithy', 'tech_creator', 'developer', 'researcher', 'casual', 'custom']);
  const LANGUAGE_IDS = Object.freeze(['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'custom']);

  const PERSONA_INSTRUCTIONS = Object.freeze({
    professional: '专业、简洁，补充一个有价值的观察',
    agreeable: '友善、真诚，避免空泛吹捧',
    humorous: '轻松机智，但不冒犯、不使用低俗表达',
    questioning: '提出一个具体、能推动讨论的问题',
    counter: '提出一个有理有据的反方视角，礼貌但直接',
    pithy: '简短锐评，一两句话内点出重点',
    tech_creator: '聚焦技术创作、开源工具和AI技术',
    developer: '开发者视角，注重实践和最佳实践',
    researcher: '研究视角，注重数据和方法论',
    casual: '自然随意的交流风格'
  });

  const PERSONAS = Object.freeze([
    { id: 'professional', name: '专业洞察', description: '专业、简洁，补充有价值的观察', systemPrompt: '专业、简洁，补充一个有价值的观察', tone: 'professional', emojiPolicy: 'minimal' },
    { id: 'agreeable', name: '友善赞同', description: '友善、真诚，避免空泛吹捧', systemPrompt: '友善、真诚，避免空泛吹捧', tone: 'warm', emojiPolicy: 'moderate' },
    { id: 'humorous', name: '风趣幽默', description: '轻松机智，但不冒犯', systemPrompt: '轻松机智，但不冒犯、不使用低俗表达', tone: 'humorous', emojiPolicy: 'moderate' },
    { id: 'questioning', name: '启发提问', description: '提出具体、能推动讨论的问题', systemPrompt: '提出一个具体、能推动讨论的问题', tone: 'curious', emojiPolicy: 'minimal' },
    { id: 'counter', name: '反方讨论', description: '有理有据的反方视角', systemPrompt: '提出一个有理有据的反方视角，礼貌但直接', tone: 'direct', emojiPolicy: 'none' },
    { id: 'pithy', name: '简短锐评', description: '简短锐评，一两句话点出重点', systemPrompt: '简短锐评，一两句话内点出重点', tone: 'concise', emojiPolicy: 'none' },
    { id: 'tech_creator', name: 'Tech Creator', description: '聚焦技术创作、开源和工具', systemPrompt: '聚焦技术创作、开源工具和AI技术', tone: 'technical', emojiPolicy: 'minimal' },
    { id: 'developer', name: 'Developer', description: '开发者视角，注重实践', systemPrompt: '开发者视角，注重实践和最佳实践', tone: 'practical', emojiPolicy: 'minimal' },
    { id: 'researcher', name: 'Researcher', description: '研究视角，注重数据和方法', systemPrompt: '研究视角，注重数据和方法论', tone: 'analytical', emojiPolicy: 'none' },
    { id: 'casual', name: 'Casual', description: '自然随意的交流风格', systemPrompt: '自然随意的交流风格', tone: 'casual', emojiPolicy: 'moderate' },
    { id: 'custom', name: '自定义', description: '用户自定义风格', systemPrompt: '', tone: 'custom', emojiPolicy: 'moderate' }
  ]);

  const LANGUAGE_INSTRUCTIONS = Object.freeze({
    auto: '跟随原推文的主要语言',
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어'
  });

  const DEFAULT_SETTINGS = Object.freeze({
    extensionEnabled: true,
    selectedProvider: 'gemini',
    replyPersona: 'professional',
    customReplyStyle: '',
    replyLanguage: 'auto',
    customReplyLanguage: '',
    maxReplyLength: 200,
    useEmoji: true,
    askQuestion: false,
    allowDisagreement: true,
    replyCount: 1,
    customRequirements: '',
    threadContextMode: 'smart',
    generationCooldownSeconds: 30,
    draftPanelMode: 'auto_fill',
    myVoice: Object.freeze({ enabled: false, description: '', samples: Object.freeze([]), forbiddenPhrases: Object.freeze([]) })
  });

  const MAX_LENGTHS = Object.freeze({
    customReplyStyle: 600,
    customReplyLanguage: 80,
    customRequirements: 600
  });

  function normalizeProviderId(value) {
    const id = String(value || '').toLowerCase();
    return PROVIDER_IDS.includes(id) ? id : 'gemini';
  }

  function normalizePersona(value) {
    return PERSONA_IDS.includes(value) ? value : 'professional';
  }

  function normalizeLanguage(value) {
    return LANGUAGE_IDS.includes(value) ? value : 'auto';
  }

  function toBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (value === 0) return false;
    if (value === 1) return true;
    if (value === '0') return false;
    if (value === '1') return true;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return Boolean(fallback);
  }

  function normalizeMyVoice(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const enabled = toBoolean(input.enabled, false);
    const description = String(input.description || '').trim().slice(0, 600);
    const rawSamples = Array.isArray(input.samples) ? input.samples : [];
    const samples = rawSamples
      .filter(s => typeof s === 'string')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => s.slice(0, 300))
      .slice(0, 10);
    const rawForbidden = Array.isArray(input.forbiddenPhrases) ? input.forbiddenPhrases : [];
    const forbiddenPhrases = rawForbidden
      .filter(s => typeof s === 'string')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => s.slice(0, 100))
      .slice(0, 20);
    return { enabled, description, samples, forbiddenPhrases };
  }

  function normalizeSettings(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const maxLength = Number(input.maxReplyLength);
    const replyCount = Number(input.replyCount);
    return {
      extensionEnabled: toBoolean(input.extensionEnabled, DEFAULT_SETTINGS.extensionEnabled),
      selectedProvider: normalizeProviderId(input.selectedProvider),
      replyPersona: normalizePersona(input.replyPersona),
      customReplyStyle: String(input.customReplyStyle || '').trim().slice(0, MAX_LENGTHS.customReplyStyle),
      replyLanguage: normalizeLanguage(input.replyLanguage),
      customReplyLanguage: String(input.customReplyLanguage || '').trim().slice(0, MAX_LENGTHS.customReplyLanguage),
      maxReplyLength: Number.isFinite(maxLength) ? Math.min(500, Math.max(20, Math.round(maxLength))) : DEFAULT_SETTINGS.maxReplyLength,
      useEmoji: toBoolean(input.useEmoji, DEFAULT_SETTINGS.useEmoji),
      askQuestion: toBoolean(input.askQuestion, DEFAULT_SETTINGS.askQuestion),
      allowDisagreement: toBoolean(input.allowDisagreement, DEFAULT_SETTINGS.allowDisagreement),
      replyCount: replyCount === 3 ? 3 : 1,
      customRequirements: String(input.customRequirements || '').trim().slice(0, MAX_LENGTHS.customRequirements),
      threadContextMode: ['single', 'smart', 'thread'].includes(input.threadContextMode) ? input.threadContextMode : DEFAULT_SETTINGS.threadContextMode,
      generationCooldownSeconds: (() => { const v = Number(input.generationCooldownSeconds); return [15, 30, 60, 120].includes(v) ? v : DEFAULT_SETTINGS.generationCooldownSeconds; })(),
      draftPanelMode: input.draftPanelMode === 'panel' ? 'panel' : DEFAULT_SETTINGS.draftPanelMode,
      myVoice: normalizeMyVoice(input.myVoice)
    };
  }

  function getPersonaInstruction(value, customValue) {
    if (value === 'custom') {
      return String(customValue || '').trim().slice(0, 600) || PERSONA_INSTRUCTIONS.professional;
    }
    const persona = PERSONAS.find(p => p.id === value);
    if (persona && persona.systemPrompt) return persona.systemPrompt;
    return PERSONA_INSTRUCTIONS[value] || PERSONA_INSTRUCTIONS.professional;
  }

  function getPersona(value) {
    const id = PERSONA_IDS.includes(value) ? value : 'professional';
    return PERSONAS.find(p => p.id === id) || PERSONAS[0];
  }

  function getLanguageInstruction(value, customValue) {
    if (value === 'custom') {
      return String(customValue || '').trim().slice(0, 80) || LANGUAGE_INSTRUCTIONS.auto;
    }
    return LANGUAGE_INSTRUCTIONS[value] || LANGUAGE_INSTRUCTIONS.auto;
  }

  return {
    PROVIDER_IDS,
    PERSONA_IDS,
    LANGUAGE_IDS,
    PERSONA_INSTRUCTIONS,
    PERSONAS,
    LANGUAGE_INSTRUCTIONS,
    DEFAULT_SETTINGS,
    normalizeProviderId,
    normalizePersona,
    normalizeLanguage,
    normalizeSettings,
    normalizeMyVoice,
    getPersonaInstruction,
    getPersona,
    getLanguageInstruction
  };
});
