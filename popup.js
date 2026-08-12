document.addEventListener('DOMContentLoaded', async () => {
  const BUILD_TAG = 'r1';
  const DP = globalThis.DraftPulseShared;
  const $ = (id) => document.getElementById(id);
  const AUTO_SAVE_DEBOUNCE_MS = 600;

  const providerSelect = $('provider');
  const personaSelect = $('persona');
  const customPersonaWrap = $('customPersonaWrap');
  const customPersonaInput = $('customPersona');
  const personaDescription = $('personaDescription');
  const languageSelect = $('replyLanguage');
  const customLanguageWrap = $('customLanguageWrap');
  const customLanguageInput = $('customLanguage');
  const maxReplyLengthInput = $('maxReplyLength');
  const replyCountSelect = $('replyCount');
  const useEmojiInput = $('useEmoji');
  const askQuestionInput = $('askQuestion');
  const allowDisagreementInput = $('allowDisagreement');
  const customRequirementsInput = $('customRequirements');
  const threadContextModeSelect = $('threadContextMode');
  const draftPanelModeSelect = $('draftPanelMode');
  const generationCooldownSelect = $('generationCooldownSeconds');
  const myVoiceEnabledInput = $('myVoiceEnabled');
  const myVoiceFields = $('myVoiceFields');
  const myVoiceDescriptionInput = $('myVoiceDescription');
  const myVoiceSamplesInput = $('myVoiceSamples');
  const myVoiceForbiddenInput = $('myVoiceForbidden');
  const toggleExtensionButton = $('toggleExtensionBtn');
  const toggleExtensionHint = $('toggleExtensionHint');
  const saveButton = $('saveBtn');
  const resetSettingsButton = $('resetSettingsBtn');
  const openButton = $('openProviderBtn');
  const repairXButton = $('repairXBtn');
  const rescanXButton = $('rescanXBtn');
  const clearSnapshotsButton = $('clearSnapshotsBtn');
  const exportDiagButton = $('exportDiagBtn');
  const copyDiagButton = $('copyDiagBtn');
  const diagOutput = $('diagOutput');
  const runHealthCheckBtn = $('runHealthCheckBtn');
  const healthBadge = $('healthBadge');
  const healthStorage = $('healthStorage');
  const statusElement = $('providerTabStatus');
  const detailElement = $('statusDetail');
  const xPageStatusElement = $('xPageStatus');
  const xPageDetailElement = $('xPageDetail');
  const modeElement = $('modeLabel');
  const tipElement = $('providerTip');
  const versionLabel = $('versionLabel');
  // Pulse Score elements
  const pulseEnabledInput = $('pulseEnabled');
  const pulseWeightFields = $('pulseWeightFields');
  const pulseWeightVelocity = $('pulseWeightVelocity');
  const pulseWeightVelocityVal = $('pulseWeightVelocityVal');
  const pulseWeightEngagement = $('pulseWeightEngagement');
  const pulseWeightEngagementVal = $('pulseWeightEngagementVal');
  const pulseWeightFreshness = $('pulseWeightFreshness');
  const pulseWeightFreshnessVal = $('pulseWeightFreshnessVal');
  const resetPulseButton = $('resetPulseBtn');
  let refreshInFlight = false;
  let extensionEnabled = true;
  let autoSaveTimer = null;
  let pulseSaveTimer = null;

  const PULSE_STORAGE_KEY = 'draftpulsePulseSettings';
  const PULSE_DEFAULTS = {
    enabled: true,
    weights: {
      velocity: Math.round(DP.PULSE_WEIGHTS.velocity * 100),
      engagement: Math.round(DP.PULSE_WEIGHTS.engagement * 100),
      freshness: Math.round(DP.PULSE_WEIGHTS.freshness * 100)
    }
  };

  /* ── Tab switching ── */
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  const PERSONA_DESCRIPTIONS = {
    professional: '专业、简洁，补充一个有价值的观察',
    agreeable: '友善、真诚，避免空泛吹捧',
    humorous: '轻松机智，但不冒犯、不使用低俗表达',
    questioning: '提出一个具体、能推动讨论的问题',
    counter: '提出一个有理有据的反方视角，礼貌但直接',
    pithy: '简短锐评，一两句话内点出重点',
    tech_creator: '聚焦技术创作、开源工具和AI技术',
    developer: '开发者视角，注重实践和最佳实践',
    researcher: '研究视角，注重数据和方法论',
    casual: '自然随意的交流风格',
    custom: '输入你自己的回复风格描述'
  };

  const PROVIDERS = {
    gemini: {
      label: 'Gemini',
      mode: '自动桥接',
      tip: 'Gemini 会逐张确认推文图片、自动发送提示词、读取新回答并回填 X 草稿；不会自动点击发布。'
    },
    chatgpt: {
      label: 'ChatGPT',
      mode: '半自动桥接',
      tip: 'ChatGPT 会预填文字并尝试附加图片，但不会自动发送或读取回答。请手动发送、复制结果，再返回 X 粘贴。'
    },
    deepseek: {
      label: 'DeepSeek',
      mode: '半自动桥接',
      tip: 'DeepSeek 当前只预填文字，不附加 X 图片，也不会自动发送或读取回答。'
    }
  };

  const manifestVersion = chrome.runtime.getManifest().version;
  versionLabel.textContent = `v${manifestVersion}-${BUILD_TAG}`;

  const stored = await chrome.storage.sync.get([
    'extensionEnabled',
    'selectedProvider',
    'replyPersona',
    'customReplyStyle',
    'replyLanguage',
    'customReplyLanguage',
    'maxReplyLength',
    'useEmoji',
    'askQuestion',
    'allowDisagreement',
    'replyCount',
    'customRequirements',
    'threadContextMode',
    'generationCooldownSeconds',
    'draftPanelMode',
    'myVoice'
  ]);
  const settings = DP.normalizeSettings(stored);
  extensionEnabled = settings.extensionEnabled;
  applySettingsToForm(settings);
  renderExtensionToggle();
  renderConditionalFields();
  updatePersonaDescription();
  renderProviderInfo();
  renderMyVoiceVisibility();
  await loadPulseSettings();
  await refreshAll();
  setInterval(refreshAll, 4000);

  /* ── Helpers ── */

  function applySettingsToForm(s) {
    providerSelect.value = s.selectedProvider;
    personaSelect.value = s.replyPersona;
    customPersonaInput.value = s.customReplyStyle;
    languageSelect.value = s.replyLanguage;
    customLanguageInput.value = s.customReplyLanguage;
    maxReplyLengthInput.value = s.maxReplyLength;
    replyCountSelect.value = String(s.replyCount);
    useEmojiInput.checked = s.useEmoji;
    askQuestionInput.checked = s.askQuestion;
    allowDisagreementInput.checked = s.allowDisagreement;
    customRequirementsInput.value = s.customRequirements;
    threadContextModeSelect.value = s.threadContextMode || 'smart';
    generationCooldownSelect.value = String(s.generationCooldownSeconds || 30);
    draftPanelModeSelect.value = s.draftPanelMode || 'auto_fill';
    // My Voice
    const mv = s.myVoice || {};
    myVoiceEnabledInput.checked = Boolean(mv.enabled);
    myVoiceDescriptionInput.value = mv.description || '';
    myVoiceSamplesInput.value = Array.isArray(mv.samples) ? mv.samples.join('\n') : '';
    myVoiceForbiddenInput.value = Array.isArray(mv.forbiddenPhrases) ? mv.forbiddenPhrases.join('\n') : '';
  }

  function collectFormSettings() {
    return {
      extensionEnabled,
      selectedProvider: providerSelect.value,
      replyPersona: personaSelect.value,
      customReplyStyle: customPersonaInput.value.trim(),
      replyLanguage: languageSelect.value,
      customReplyLanguage: customLanguageInput.value.trim(),
      maxReplyLength: maxReplyLengthInput.value,
      replyCount: replyCountSelect.value,
      useEmoji: useEmojiInput.checked,
      askQuestion: askQuestionInput.checked,
      allowDisagreement: allowDisagreementInput.checked,
      customRequirements: customRequirementsInput.value.trim(),
      threadContextMode: threadContextModeSelect.value,
      generationCooldownSeconds: generationCooldownSelect.value,
      draftPanelMode: draftPanelModeSelect.value,
      myVoice: {
        enabled: myVoiceEnabledInput.checked,
        description: myVoiceDescriptionInput.value.trim(),
        samples: myVoiceSamplesInput.value.split('\n').map(s => s.trim()).filter(Boolean),
        forbiddenPhrases: myVoiceForbiddenInput.value.split('\n').map(s => s.trim()).filter(Boolean)
      }
    };
  }

  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      saveSettings(true);
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  async function saveSettings(isAutoSave) {
    const customStyle = customPersonaInput.value.trim();
    const customLanguage = customLanguageInput.value.trim();
    if (!isAutoSave) {
      if (personaSelect.value === 'custom' && !customStyle) {
        customPersonaInput.focus();
        flashSave('请填写自定义风格', 'error');
        return;
      }
      if (languageSelect.value === 'custom' && !customLanguage) {
        customLanguageInput.focus();
        flashSave('请填写自定义语言', 'error');
        return;
      }
    }
    const raw = collectFormSettings();
    saveButton.disabled = true;
    try {
      await chrome.storage.sync.set(DP.normalizeSettings(raw));
      flashSave(isAutoSave ? '已自动保存' : '已保存', 'success');
    } catch (_) {
      flashSave('保存失败，请重试', 'error');
    } finally {
      saveButton.disabled = false;
    }
  }

  function flashSave(text, type) {
    saveButton.textContent = text;
    saveButton.classList.remove('save-success', 'save-error');
    if (type === 'success') saveButton.classList.add('save-success');
    else if (type === 'error') saveButton.classList.add('save-error');
    setTimeout(() => {
      saveButton.textContent = '保存设置';
      saveButton.classList.remove('save-success', 'save-error');
    }, 1300);
  }

  function updateElement(id, text, className) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    if (className !== undefined) el.className = className;
  }

  function batchUpdate(updates) {
    for (const [id, config] of Object.entries(updates)) {
      if (typeof config === 'string') updateElement(id, config);
      else updateElement(id, config.text, config.className);
    }
  }

  /* ── Provider change ── */

  providerSelect.addEventListener('change', async () => {
    providerSelect.value = DP.normalizeProviderId(providerSelect.value);
    await chrome.storage.sync.set({ selectedProvider: providerSelect.value });
    renderProviderInfo();
    await refreshAll();
  });

  /* ── Auto-save triggers ── */

  personaSelect.addEventListener('change', () => { renderConditionalFields(); updatePersonaDescription(); scheduleAutoSave(); });
  languageSelect.addEventListener('change', () => { renderConditionalFields(); scheduleAutoSave(); });
  maxReplyLengthInput.addEventListener('change', scheduleAutoSave);
  replyCountSelect.addEventListener('change', scheduleAutoSave);
  useEmojiInput.addEventListener('change', scheduleAutoSave);
  askQuestionInput.addEventListener('change', scheduleAutoSave);
  allowDisagreementInput.addEventListener('change', scheduleAutoSave);
  customPersonaInput.addEventListener('input', scheduleAutoSave);
  customLanguageInput.addEventListener('input', scheduleAutoSave);
  customRequirementsInput.addEventListener('input', scheduleAutoSave);
  threadContextModeSelect.addEventListener('change', scheduleAutoSave);
  generationCooldownSelect.addEventListener('change', scheduleAutoSave);
  draftPanelModeSelect.addEventListener('change', scheduleAutoSave);
  // My Voice auto-save
  myVoiceEnabledInput.addEventListener('change', () => { renderMyVoiceVisibility(); scheduleAutoSave(); });
  myVoiceDescriptionInput.addEventListener('input', scheduleAutoSave);
  myVoiceSamplesInput.addEventListener('input', scheduleAutoSave);
  myVoiceForbiddenInput.addEventListener('input', scheduleAutoSave);

  /* ── Pulse Score settings ── */

  async function loadPulseSettings() {
    const stored = await chrome.storage.local.get([PULSE_STORAGE_KEY]);
    const pulse = stored[PULSE_STORAGE_KEY] || {};
    const enabled = typeof pulse.enabled === 'boolean' ? pulse.enabled : PULSE_DEFAULTS.enabled;
    const weights = { ...PULSE_DEFAULTS.weights, ...(pulse.weights || {}) };
    pulseEnabledInput.checked = enabled;
    pulseWeightVelocity.value = weights.velocity;
    pulseWeightVelocityVal.textContent = weights.velocity;
    pulseWeightEngagement.value = weights.engagement;
    pulseWeightEngagementVal.textContent = weights.engagement;
    pulseWeightFreshness.value = weights.freshness;
    pulseWeightFreshnessVal.textContent = weights.freshness;
    renderPulseFieldsVisibility();
  }

  function renderPulseFieldsVisibility() {
    pulseWeightFields.hidden = !pulseEnabledInput.checked;
  }

  function schedulePulseSave() {
    if (pulseSaveTimer) clearTimeout(pulseSaveTimer);
    pulseSaveTimer = setTimeout(() => {
      pulseSaveTimer = null;
      savePulseSettings();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  async function savePulseSettings() {
    const value = {
      enabled: pulseEnabledInput.checked,
      weights: {
        velocity: Number(pulseWeightVelocity.value),
        engagement: Number(pulseWeightEngagement.value),
        freshness: Number(pulseWeightFreshness.value)
      }
    };
    try {
      await chrome.storage.local.set({ [PULSE_STORAGE_KEY]: value });
    } catch (_) {}
  }

  function updatePulseSliderDisplay(slider, display) {
    display.textContent = slider.value;
  }

  pulseEnabledInput.addEventListener('change', () => {
    renderPulseFieldsVisibility();
    schedulePulseSave();
  });
  pulseWeightVelocity.addEventListener('input', () => {
    updatePulseSliderDisplay(pulseWeightVelocity, pulseWeightVelocityVal);
    schedulePulseSave();
  });
  pulseWeightEngagement.addEventListener('input', () => {
    updatePulseSliderDisplay(pulseWeightEngagement, pulseWeightEngagementVal);
    schedulePulseSave();
  });
  pulseWeightFreshness.addEventListener('input', () => {
    updatePulseSliderDisplay(pulseWeightFreshness, pulseWeightFreshnessVal);
    schedulePulseSave();
  });

  resetPulseButton.addEventListener('click', async () => {
    pulseEnabledInput.checked = PULSE_DEFAULTS.enabled;
    pulseWeightVelocity.value = PULSE_DEFAULTS.weights.velocity;
    pulseWeightVelocityVal.textContent = PULSE_DEFAULTS.weights.velocity;
    pulseWeightEngagement.value = PULSE_DEFAULTS.weights.engagement;
    pulseWeightEngagementVal.textContent = PULSE_DEFAULTS.weights.engagement;
    pulseWeightFreshness.value = PULSE_DEFAULTS.weights.freshness;
    pulseWeightFreshnessVal.textContent = PULSE_DEFAULTS.weights.freshness;
    renderPulseFieldsVisibility();
    await savePulseSettings();
    resetPulseButton.textContent = '已恢复';
    setTimeout(() => { resetPulseButton.textContent = '恢复默认'; }, 1200);
  });

  /* ── Toggle extension ── */

  toggleExtensionButton.addEventListener('click', async () => {
    if (toggleExtensionButton.disabled) return;
    toggleExtensionButton.disabled = true;
    const nextEnabled = !extensionEnabled;
    try {
      await chrome.storage.sync.set({ extensionEnabled: nextEnabled });
      extensionEnabled = nextEnabled;
      renderExtensionToggle();
      setXPageStatus(
        nextEnabled ? '正在恢复' : '已暂停',
        nextEnabled ? 'warn' : 'ok',
        nextEnabled ? '正在重新扫描当前 X 页面。' : '已停止扫描并移除 X 页面工具栏。'
      );
      await new Promise((resolve) => setTimeout(resolve, 180));
      await refreshAll();
    } catch (error) {
      setXPageStatus('切换失败', 'error', error.message || '无法保存插件启用状态。');
    } finally {
      toggleExtensionButton.disabled = false;
    }
  });

  /* ── Repair X ── */

  repairXButton.addEventListener('click', async () => {
    repairXButton.disabled = true;
    repairXButton.textContent = '正在注入…';
    setXPageStatus('处理中', 'warn', '正在向当前 X 标签页重新注入工具栏。');
    try {
      const response = await chrome.runtime.sendMessage({ action: 'REPAIR_X_PAGE' });
      if (!response?.success) throw new Error(response?.error || 'X 页面修复失败。');
      setXPageStatus('已启用', 'ok', response.message || 'X 页面增强已加载。');
    } catch (error) {
      setXPageStatus('修复失败', 'error', error.message);
    } finally {
      repairXButton.disabled = false;
      repairXButton.textContent = '重新注入 X 页面脚本';
    }
  });

  /* ── Rescan X ── */

  rescanXButton.addEventListener('click', async () => {
    rescanXButton.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'RESCAN_X_PAGE' });
      if (!response?.success) throw new Error(response?.error || '重新扫描失败。');
      setXPageStatus('已扫描', 'ok', response.message || '已重新扫描推文。');
    } catch (error) {
      setXPageStatus('扫描失败', 'error', error.message);
    } finally {
      rescanXButton.disabled = false;
    }
  });

  /* ── Open provider tab ── */

  openButton.addEventListener('click', async () => {
    const provider = providerSelect.value;
    openButton.disabled = true;
    openButton.textContent = '正在打开…';
    try {
      const response = await chrome.runtime.sendMessage({ action: 'OPEN_PROVIDER_TAB', provider });
      if (!response?.success) throw new Error(response?.error || `无法打开 ${PROVIDERS[provider].label} 标签页。`);
      detailElement.textContent = `请在打开的 ${PROVIDERS[provider].label} 标签页中确认登录；完成后返回 X 使用。`;
      setTimeout(refreshAll, 1200);
    } catch (error) {
      setStatus('打开失败', 'error', error.message);
    } finally {
      openButton.disabled = false;
      openButton.textContent = `打开专用 ${PROVIDERS[providerSelect.value].label} 标签页`;
    }
  });

  /* ── Clear snapshots ── */

  clearSnapshotsButton.addEventListener('click', async () => {
    if (!window.confirm('确定清除本机保存的浏览增速快照吗？该操作不可撤销。')) return;
    clearSnapshotsButton.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'CLEAR_VIEW_SNAPSHOTS' });
      if (!response?.success) throw new Error(response?.error || '清除失败。');
      setXPageStatus('快照已清除', 'ok', '本机浏览增速快照已清除。');
    } catch (error) {
      setXPageStatus('清除失败', 'error', error.message);
    } finally {
      clearSnapshotsButton.disabled = false;
    }
  });

  /* ── Manual save ── */

  saveButton.addEventListener('click', () => saveSettings(false));

  /* ── Reset settings ── */

  resetSettingsButton.addEventListener('click', async () => {
    if (!window.confirm('确定将所有回复设置恢复为默认值吗？该操作不可撤销。')) return;
    resetSettingsButton.disabled = true;
    try {
      const defaults = DP.DEFAULT_SETTINGS;
      await chrome.storage.sync.set(defaults);
      const refreshed = DP.normalizeSettings(await chrome.storage.sync.get([
        'extensionEnabled', 'selectedProvider', 'replyPersona', 'customReplyStyle',
        'replyLanguage', 'customReplyLanguage', 'maxReplyLength', 'useEmoji',
        'askQuestion', 'allowDisagreement', 'replyCount', 'customRequirements',
        'threadContextMode', 'generationCooldownSeconds', 'draftPanelMode', 'myVoice'
      ]));
      extensionEnabled = refreshed.extensionEnabled;
      applySettingsToForm(refreshed);
      renderExtensionToggle();
      renderConditionalFields();
      renderMyVoiceVisibility();
      renderProviderInfo();
      flashSave('已恢复默认', 'success');
    } catch (_) {
      flashSave('恢复失败', 'error');
    } finally {
      resetSettingsButton.disabled = false;
    }
  });

  /* ── Export diagnostics ── */

  exportDiagButton.addEventListener('click', async () => {
    if (exportDiagButton.disabled) return;
    exportDiagButton.disabled = true;
    exportDiagButton.textContent = '正在导出…';
    try {
      const diagnostics = await collectDiagnostics();
      const payload = {
        exportedAt: new Date().toISOString(),
        version: diagnostics.version,
        provider: diagnostics.provider,
        xPage: diagnostics.xPage,
        providers: diagnostics.providers,
        lastRequest: diagnostics.lastRequest
      };
      diagOutput.value = JSON.stringify(payload, null, 2);
      diagOutput.hidden = false;
      copyDiagButton.hidden = false;
    } catch (_) {
      diagOutput.value = '诊断导出失败，请稍后重试。';
      diagOutput.hidden = false;
    } finally {
      exportDiagButton.disabled = false;
      exportDiagButton.textContent = '导出脱敏诊断信息';
    }
  });

  /* ── Copy diagnostics ── */

  copyDiagButton.addEventListener('click', async () => {
    if (!diagOutput.value) return;
    try {
      await navigator.clipboard.writeText(diagOutput.value);
      copyDiagButton.textContent = '已复制';
    } catch (_) {
      diagOutput.focus();
      diagOutput.select();
      try { document.execCommand('copy'); copyDiagButton.textContent = '已复制'; } catch (_) {}
    }
    setTimeout(() => { copyDiagButton.textContent = '复制诊断文本'; }, 1200);
  });

  /* ── Health Check ── */

  runHealthCheckBtn.addEventListener('click', async () => {
    runHealthCheckBtn.disabled = true;
    runHealthCheckBtn.textContent = '检查中…';
    try {
      const diagnostics = await collectDiagnostics();
      const health = DP.computeHealthScore({
        xPage: diagnostics.xPage,
        activeProvider: diagnostics.provider,
        providers: diagnostics.providers
      });
      // Update badge
      healthBadge.textContent = health.score;
      healthBadge.className = `health-badge ${health.level}`;
      // Update individual items
      const itemMap = {
        healthXDom: health.checks[0],
        healthProvider: health.checks[1],
        healthExtraction: health.checks[2],
        healthImageExtraction: health.checks[3],
        healthAccount: null, // account detection — non-blocking
        healthReplyComposer: health.checks[5]
      };
      // Account detection: check if xPage is ready (account detection depends on X DOM)
      const accountOk = diagnostics.xPage?.ready === true;
      const accountItem = $('healthAccount');
      if (accountItem) {
        accountItem.classList.toggle('fail', !accountOk);
      }
      for (const [id, check] of Object.entries(itemMap)) {
        if (!check) continue;
        const el = $(id);
        if (!el) continue;
        el.classList.toggle('fail', check.status === 'fail');
      }
      // Storage usage
      try {
        const usage = await chrome.storage.sync.getBytesInUse();
        const localUsage = await chrome.storage.local.getBytesInUse();
        const storageInfo = DP.formatStorageUsage({
          syncBytes: usage,
          localBytes: localUsage,
          syncQuota: 102400,
          localQuota: 10485760
        });
        healthStorage.textContent = `存储：sync ${storageInfo.syncText}（${storageInfo.syncPercent}%）· local ${storageInfo.localText}（${storageInfo.localPercent}%）`;
      } catch (_) {
        healthStorage.textContent = '存储信息获取失败。';
      }
    } catch (error) {
      healthBadge.textContent = '—';
      healthBadge.className = 'health-badge unhealthy';
      healthStorage.textContent = `检查失败：${error.message}`;
    } finally {
      runHealthCheckBtn.disabled = false;
      runHealthCheckBtn.textContent = '运行健康检查';
    }
  });

  /* ── Render helpers ── */

  function renderConditionalFields() {
    customPersonaWrap.hidden = personaSelect.value !== 'custom';
    customLanguageWrap.hidden = languageSelect.value !== 'custom';
  }

  function renderMyVoiceVisibility() {
    myVoiceFields.hidden = !myVoiceEnabledInput.checked;
  }

  function updatePersonaDescription() {
    if (!personaDescription) return;
    personaDescription.textContent = PERSONA_DESCRIPTIONS[personaSelect.value] || '';
  }

  function renderExtensionToggle() {
    toggleExtensionButton.textContent = extensionEnabled ? '暂时关闭插件' : '恢复插件';
    toggleExtensionButton.className = extensionEnabled ? 'pause' : 'resume';
    toggleExtensionHint.textContent = extensionEnabled
      ? '关闭后会停止扫描并移除 X 页面工具栏；再次点击即可恢复。'
      : '插件当前已暂停，不会在 X 页面扫描或显示工具栏。设置和历史快照仍会保留。';
    repairXButton.disabled = !extensionEnabled;
    rescanXButton.disabled = !extensionEnabled;
  }

  function renderProviderInfo() {
    const provider = PROVIDERS[providerSelect.value];
    modeElement.textContent = provider.mode;
    modeElement.className = providerSelect.value === 'gemini' ? 'ok' : 'warn';
    tipElement.textContent = provider.tip;
    openButton.textContent = `打开专用 ${provider.label} 标签页`;
  }

  async function refreshAll() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const diagnostics = await collectDiagnostics();
      renderProviderStatus(diagnostics);
      renderXPageStatus(diagnostics.xPage);
      renderDiagnostics(diagnostics);
    } catch (error) {
      setStatus('检测失败', 'error', error.message);
      setXPageStatus('未检测', 'warn', error.message);
      batchUpdate({
        diagLastRequest: '诊断获取失败',
        diagError: error.message
      });
    } finally {
      refreshInFlight = false;
    }
  }

  function renderProviderStatus(diagnostics) {
    const provider = providerSelect.value;
    const status = diagnostics.providers?.[provider];
    if (!status) {
      setStatus('未检测', 'warn', '提供商状态不可用。');
      return;
    }
    if (status.ready) setStatus('已连接', 'ok', status.message);
    else {
      setStatus(status.state === 'missing' ? '未建立' : '未就绪', 'warn', status.message);
      statusElement.title = status.message;
    }
  }

  function renderXPageStatus(xPage) {
    if (!xPage) {
      setXPageStatus('未检测', 'warn', 'X 页面状态不可用。');
      return;
    }
    if (xPage.state === 'paused') setXPageStatus('已暂停', 'ok', xPage.message);
    else if (xPage.ready) setXPageStatus('已启用', 'ok', xPage.message);
    else {
      setXPageStatus('未注入', 'warn', xPage.message || '点击下方按钮进行修复。');
      xPageStatusElement.title = xPage.message || '';
    }
  }

  function renderDiagnostics(diagnostics) {
    batchUpdate({
      diagVersion: diagnostics.version,
      diagInjected: { text: diagnostics.xPage?.ready ? '已注入' : '未注入', className: diagnostics.xPage?.ready ? 'ok' : 'warn' },
      diagCounts: `${Number(diagnostics.xPage?.tweets || 0)} 条 / ${Number(diagnostics.xPage?.panels || 0)} 个`,
      diagProvider: diagnostics.providerLabel
    });
    const providerTab = diagnostics.providers?.[diagnostics.provider];
    batchUpdate({
      diagProviderTab: { text: providerTab?.state === 'missing' ? '不存在' : '存在', className: providerTab?.state === 'missing' ? 'warn' : 'ok' },
      diagLogin: {
        text: providerTab?.ready ? '已登录（可判断）' : (providerTab?.state === 'missing' ? '无法判断' : '未登录或不可用'),
        className: providerTab?.ready ? 'ok' : 'warn'
      }
    });
    renderLastRequest(diagnostics.lastRequest);
  }

  function renderLastRequest(lastRequest) {
    if (!lastRequest) {
      batchUpdate({
        diagLastRequest: '暂无记录',
        diagTimings: '尚未发起过请求。',
        diagError: '无最近错误。'
      });
      return;
    }
    const statusLabels = { success: '成功', error: '失败', pending_fill: '等待回填' };
    const time = new Date(lastRequest.timestamp).toLocaleTimeString();
    batchUpdate({
      diagLastRequest: `${statusLabels[lastRequest.status] || lastRequest.status} · ${time} · ${lastRequest.provider}`,
      diagTimings: DP.formatTimings(lastRequest.timings),
      diagError: lastRequest.error ? `最近错误：${lastRequest.error}` : '无最近错误。'
    });
  }

  async function collectDiagnostics() {
    const diagnostics = await chrome.runtime.sendMessage({ action: 'GET_DIAGNOSTICS' });
    if (!diagnostics?.success) throw new Error(diagnostics?.error || '诊断获取失败。');
    const provider = String(diagnostics.activeProvider || 'gemini');
    return {
      version: diagnostics.version,
      provider,
      providerLabel: PROVIDERS[provider]?.label || provider,
      providers: diagnostics.providers || {},
      xPage: diagnostics.xPage || {},
      lastRequest: diagnostics.lastRequest || null
    };
  }

  function setStatus(label, className, detail) {
    statusElement.textContent = label;
    statusElement.className = className;
    detailElement.textContent = detail || '';
  }

  function setXPageStatus(label, className, detail) {
    xPageStatusElement.textContent = label;
    xPageStatusElement.className = className;
    xPageDetailElement.textContent = detail || '';
  }
});
