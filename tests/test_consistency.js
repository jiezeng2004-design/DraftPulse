'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHARED_MODULES = [
  'xg_shared',
  'xg_parse',
  'xg_timeout',
  'xg_images',
  'xg_growth',
  'xg_settings',
  'xg_diagnostics',
  'xg_prompt',
  'xg_response',
  'xg_editor',
  'xg_selectors',
  'xg_xdom',
  'xg_reply',
  'xg_adapters'
];
const BROWSER_SCRIPTS = [
  'background.js',
  'content.js',
  'gemini_bridge.js',
  'chatgpt_bridge.js',
  'deepseek_bridge.js',
  'popup.js'
];

function sharedApiKeys() {
  const keys = new Set();
  for (const name of SHARED_MODULES) {
    const exported = require(`../shared/${name}.js`);
    for (const key of Object.keys(exported)) keys.add(key);
  }
  return keys;
}

function collectXGReferences(source) {
  const refs = new Set();
  const pattern = /XG\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) refs.add(match[1]);
  return refs;
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

const tests = [
  {
    name: '浏览器脚本的 XG.* 引用全部存在于共享 API',
    fn() {
      const apiKeys = sharedApiKeys();
      for (const file of BROWSER_SCRIPTS) {
        const source = read(file);
        const refs = collectXGReferences(source);
        for (const ref of refs) {
          assert.ok(apiKeys.has(ref), `${file} 引用了不存在的共享 API: XG.${ref}`);
        }
      }
    }
  },
  {
    name: 'content.js VERSION 与 manifest 版本一致',
    fn() {
      const manifest = JSON.parse(read('manifest.json'));
      const content = read('content.js');
      const match = content.match(/const VERSION = '([^']+)'/);
      assert.ok(match, 'content.js 缺少 VERSION 常量');
      assert.strictEqual(match[1], manifest.version, `content VERSION (${match[1]}) 与 manifest (${manifest.version}) 不一致`);
    }
  },
  {
    name: 'popup.html 引用的共享脚本都存在于 XG 依赖集合',
    fn() {
      const html = read('popup.html');
      const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
      for (const script of scripts) {
        assert.ok(fs.existsSync(path.join(ROOT, script)), `popup.html 缺少脚本: ${script}`);
      }
      assert.ok(scripts.includes('shared/xg_shared.js'), 'popup.html 未注入 xg_shared.js');
      assert.ok(scripts.includes('shared/xg_settings.js'), 'popup.html 未注入 xg_settings.js');
    }
  },
  {
    name: '桥接脚本依赖的共享文件与 manifest 注入列表一致',
    fn() {
      const manifest = JSON.parse(read('manifest.json'));
      const sharedFiles = SHARED_MODULES.map((name) => `shared/${name}.js`);
      const declared = new Set();
      for (const entry of manifest.content_scripts) {
        for (const file of entry.js || []) declared.add(file);
      }
      if (manifest.background?.service_worker) {
        const bg = read(manifest.background.service_worker);
        const importList = bg.match(/importScripts\(([\s\S]*?)\)/);
        if (importList) {
          for (const match of importList[1].matchAll(/'([^']+)'/g)) declared.add(match[1]);
        }
      }
      // popup.html 自身引用的共享脚本也视为已声明。
      const popupHtml = read(manifest.action.default_popup);
      for (const match of popupHtml.matchAll(/<script src="([^"]+)"/g)) declared.add(match[1]);
      for (const file of sharedFiles) {
        assert.ok(declared.has(file), `共享文件 ${file} 未在 manifest/importScripts 中声明`);
      }
    }
  },
  {
    name: 'background 自动修复脚本列表与 manifest 注入顺序一致',
    fn() {
      const manifest = JSON.parse(read('manifest.json'));
      const background = read('background.js');
      const quotedFiles = (block) => [...block.matchAll(/'([^']+\.js)'/g)].map((match) => match[1]);

      const xBlock = background.match(/const X_PAGE_SCRIPT_FILES = Object\.freeze\(\[([\s\S]*?)\]\);/);
      assert.ok(xBlock, 'background 缺少 X_PAGE_SCRIPT_FILES');
      const xManifestEntry = manifest.content_scripts.find((entry) => (entry.matches || []).includes('https://x.com/*'));
      assert.ok(xManifestEntry, 'manifest 缺少 X content script');
      assert.deepStrictEqual(quotedFiles(xBlock[1]), xManifestEntry.js, 'X 自动修复脚本顺序与 manifest 不一致');

      const providerEntries = {
        gemini: manifest.content_scripts.find((entry) => (entry.matches || []).includes('https://gemini.google.com/*')),
        chatgpt: manifest.content_scripts.find((entry) => (entry.matches || []).includes('https://chatgpt.com/*')),
        deepseek: manifest.content_scripts.find((entry) => (entry.matches || []).includes('https://chat.deepseek.com/*'))
      };
      for (const [provider, entry] of Object.entries(providerEntries)) {
        assert.ok(entry, `manifest 缺少 ${provider} content script`);
        const pattern = new RegExp(`${provider}: Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`);
        const block = background.match(pattern);
        assert.ok(block, `background 缺少 ${provider} 自动修复脚本列表`);
        assert.deepStrictEqual(quotedFiles(block[1]), entry.js, `${provider} 自动修复脚本顺序与 manifest 不一致`);
      }
    }
  },
  {
    name: '提供商动作名与桥接文件一致',
    fn() {
      const adapters = require('../shared/xg_adapters.js');
      for (const def of Object.values(adapters.PROVIDER_DEFS)) {
        const bridgeFile = def.id === 'gemini' ? 'gemini_bridge.js' : `${def.id}_bridge.js`;
        const source = read(bridgeFile);
        const actions = [
          def.pingAction,
          def.cancelAction,
          def.attachAction,
          def.submitAction,
          def.waitAction,
          def.extractAction,
          def.requestAction
        ].filter(Boolean);
        for (const action of actions) {
          assert.ok(source.includes(`'${action}'`), `${bridgeFile} 缺少动作 ${action}`);
        }
      }
    }
  },
  {
    name: 'DRAFTPULSE_* 与取消动作在 background/content 中一致',
    fn() {
      const bg = read('background.js');
      const content = read('content.js');
      for (const action of [
        'DRAFTPULSE_PING',
        'DRAFTPULSE_RESCAN',
        'DRAFTPULSE_CLEAR_SNAPSHOTS',
        'CANCEL_PROVIDER_REQUEST',
        'GENERATE_AI_REPLY_WEB'
      ]) {
        assert.ok(bg.includes(`'${action}'`), `background 缺少动作 ${action}`);
        assert.ok(content.includes(`'${action}'`), `content 缺少动作 ${action}`);
      }
    }
  },
  {
    name: '导出诊断不含推文正文/图片/回答/凭据字段',
    fn() {
      const popup = read('popup.js');
      const content = read('content.js');
      const exportedKeys = ['exportedAt', 'version', 'provider', 'xPage', 'providers', 'lastRequest'];
      for (const key of exportedKeys) {
        assert.ok(popup.includes(key), `popup 导出缺少字段 ${key}`);
      }
      for (const word of ['payload.tweetText', 'payload.images', 'payload.reply', 'payload.cookie', 'payload.token']) {
        assert.ok(!popup.includes(word), `popup 导出包含敏感字段 ${word}`);
      }
      const start = content.indexOf('async function recordLastRequest');
      const end = content.indexOf('function scheduleScan');
      assert.ok(start > 0 && end > start, 'content.js 记录函数定位失败');
      const recordBlock = content.slice(start, end);
      for (const key of ['timestamp', 'requestId', 'provider', 'status', 'imageCount', 'skippedImageCount', 'timings', 'error']) {
        assert.ok(
          recordBlock.includes(`'${key}'`) || recordBlock.includes(`${key}:`),
          `最近请求记录缺少字段 ${key}`
        );
      }
      for (const word of ['tweetText', 'reply:']) {
        assert.ok(!recordBlock.includes(word), `最近请求记录包含敏感字段 ${word}`);
      }
    }
  }
];

module.exports = { tests };
