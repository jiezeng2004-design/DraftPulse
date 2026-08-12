'use strict';

const path = require('node:path');
const fs = require('node:fs');

const testFiles = [
  'test_shared.js',
  'test_parse.js',
  'test_timeout.js',
  'test_diagnostics.js',
  'test_growth.js',
  'test_pulse_score.js',
  'test_images.js',
  'test_response.js',
  'test_editor.js',
  'test_settings.js',
  'test_prompt.js',
  'test_reply.js',
  'test_xdom.js',
  'test_cooldown.js',
  'test_thread.js',
  'test_account_memory.js',
  'test_adapters.js',
  'test_voice.js',
  'test_draft_panel.js',
  'test_migration.js',
  'smoke_browser_scripts.js',
  'test_characterization.js',
  'test_consistency.js',
  'test_manifest.js'
];

let passed = 0;
let failed = 0;
const failures = [];

process.on('unhandledRejection', (reason) => {
  failed += 1;
  failures.push(`unhandledRejection: ${reason && reason.stack ? reason.stack.split('\n').slice(0, 4).join('\n    ') : reason}`);
  console.log('FAIL  (unhandledRejection)');
});

async function runSuite(file) {
  const fullPath = path.join(__dirname, file);
  if (!fs.existsSync(fullPath)) {
    failed += 1;
    failures.push(`${file}: 文件不存在`);
    return;
  }
  const suite = require(fullPath);
  const tests = Array.isArray(suite) ? suite : suite.tests || [];
  for (const test of tests) {
    if (!test || typeof test.fn !== 'function') continue;
    try {
      await test.fn();
      passed += 1;
      console.log(`PASS  ${file} :: ${test.name}`);
    } catch (error) {
      failed += 1;
      failures.push(`${file} :: ${test.name}\n    ${error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n    ') : error}`);
      console.log(`FAIL  ${file} :: ${test.name}`);
    }
  }
}

(async () => {
  for (const file of testFiles) {
    await runSuite(file);
  }
  // 等待异步脚本冒烟测试的尾部（DOMContentLoaded 回调、storage 读写）落地。
  await new Promise((resolve) => setTimeout(resolve, 200));
  console.log('');
  console.log(`TOTAL ${passed + failed}  PASS ${passed}  FAIL ${failed}`);
  if (failures.length) {
    console.log('');
    console.log('FAILURE DETAILS');
    for (const detail of failures) console.log(`- ${detail}`);
    process.exit(1);
  } else {
    // vm 沙箱中的 toast/扫描/刷新定时器会阻止事件循环退出，直接结束进程。
    process.exit(0);
  }
})().catch((error) => {
  console.error('TEST RUNNER FAILURE:', error);
  process.exit(1);
});
