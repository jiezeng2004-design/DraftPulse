'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function allReferencedJs() {
  const files = new Set();
  if (manifest.background?.service_worker) files.add(manifest.background.service_worker);
  for (const entry of manifest.content_scripts || []) {
    for (const file of entry.js || []) files.add(file);
  }
  return [...files];
}

function allFilesMentioned() {
  const files = new Set(allReferencedJs());
  if (manifest.action?.default_popup) files.add(manifest.action.default_popup);
  const popupHtml = manifest.action?.default_popup;
  if (popupHtml) {
    const html = fs.readFileSync(path.join(ROOT, popupHtml), 'utf8');
    for (const match of html.matchAll(/<script src="([^"]+)"/g)) files.add(match[1]);
    for (const match of html.matchAll(/href="([^"]+\.css)"/g)) files.add(match[1]);
  }
  for (const icon of Object.values(manifest.icons || {})) files.add(icon);
  for (const icon of Object.values(manifest.action?.default_icon || {})) files.add(icon);
  return [...files];
}

const tests = [
  {
    name: '版本为 2.0',
    fn() {
      assert.strictEqual(manifest.manifest_version, 3);
      assert.strictEqual(manifest.version, '2.0');
    }
  },
  {
    name: '权限最小化',
    fn() {
      assert.deepStrictEqual([...manifest.permissions].sort(), ['scripting', 'storage']);
      assert.ok(!manifest.permissions.includes('tabs'));
      assert.ok(!manifest.permissions.includes('clipboardWrite'));
      assert.ok(!manifest.permissions.includes('downloads'));
    }
  },
  {
    name: '无 <all_urls> 与明文 http',
    fn() {
      const hosts = JSON.stringify(manifest.host_permissions || []);
      assert.ok(!hosts.includes('<all_urls>'));
      assert.ok(!hosts.includes('http://'));
      for (const host of manifest.host_permissions) assert.ok(host.startsWith('https://'));
    }
  },
  {
    name: 'manifest 引用的文件全部存在',
    fn() {
      for (const file of allFilesMentioned()) {
        assert.ok(fs.existsSync(path.join(ROOT, file)), `缺少文件: ${file}`);
      }
    }
  },
  {
    name: 'content script 共享文件先于入口脚本',
    fn() {
      for (const entry of manifest.content_scripts || []) {
        const js = entry.js || [];
        if (js.length === 1) continue;
        const first = js[0];
        assert.ok(first.startsWith('shared/'), `入口脚本顺序错误: ${js.join(', ')}`);
        const firstEntry = js.findIndex((file) => !file.startsWith('shared/'));
        assert.ok(firstEntry > 0, `缺少入口脚本: ${js.join(', ')}`);
        assert.ok(
          !js.slice(firstEntry + 1).some((file) => file.startsWith('shared/')),
          `共享文件必须位于入口脚本之前: ${js.join(', ')}`
        );
      }
    }
  },
  {
    name: '无 eval / new Function / 远程脚本',
    fn() {
      for (const file of allReferencedJs()) {
        const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
        assert.ok(!/eval\s*\(/.test(code), `${file} 包含 eval(`);
        assert.ok(!/new\s+Function\s*\(/.test(code), `${file} 包含 new Function`);
      }
      const popupHtml = fs.readFileSync(path.join(ROOT, manifest.action.default_popup), 'utf8');
      assert.ok(!/<script[^>]+src=["']https?:/i.test(popupHtml), 'popup.html 包含远程脚本');
      assert.ok(!/<script(?![^>]*src=)[^>]*>/.test(popupHtml), 'popup.html 包含内联脚本');
    }
  },
  {
    name: '无明文 http URL',
    fn() {
      for (const file of allReferencedJs()) {
        const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const matches = code.match(/https?:\/\/[^\s"'`)]+/g) || [];
        for (const match of matches) {
          assert.ok(match.startsWith('https://'), `${file} 包含明文 http: ${match}`);
        }
      }
    }
  },
  {
    name: 'CSP 合规（无远程代码策略）',
    fn() {
      const csp = manifest.content_security_policy;
      assert.ok(!csp || !/script-src[^;]*https?:/i.test(JSON.stringify(csp)), 'CSP 允许远程脚本');
      assert.ok(!csp || !/unsafe-eval/i.test(JSON.stringify(csp)), 'CSP 包含 unsafe-eval');
    }
  },
  {
    name: 'background 使用 importScripts 加载共享模块',
    fn() {
      const code = fs.readFileSync(path.join(ROOT, manifest.background.service_worker), 'utf8');
      assert.ok(code.includes('importScripts('), 'background 未使用 importScripts');
      assert.ok(code.includes("'shared/xg_shared.js'"), 'background 未加载共享模块');
      for (const file of allReferencedJs()) {
        if (file.startsWith('shared/')) continue;
        const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
        assert.ok(content.includes('DraftPulseShared'), `${file} 未引用共享命名空间`);
      }
    }
  },
  {
    name: 'background importScripts 引用的共享文件全部存在',
    fn() {
      const code = fs.readFileSync(path.join(ROOT, manifest.background.service_worker), 'utf8');
      const matches = code.match(/importScripts\(([\s\S]*?)\)/);
      assert.ok(matches, 'background 缺少 importScripts');
      const files = [...matches[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
      assert.ok(files.length >= 7, '共享模块数量不足');
      for (const file of files) {
        assert.ok(fs.existsSync(path.join(ROOT, file)), `缺少文件: ${file}`);
      }
    }
  }
];

module.exports = { tests };
