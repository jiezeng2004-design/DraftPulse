'use strict';

const { isTrustedRuntimeSender } = require('../shared/xg_shared.js');

const EXTENSION_ID = 'abcdefghijklmnopqrstuvwxyzaabbcc';

module.exports = [
  // ─── isTrustedRuntimeSender ───
  {
    name: 'isTrustedRuntimeSender: matching extension ID and no URL → trusted',
    fn() {
      const sender = { id: EXTENSION_ID };
      const result = isTrustedRuntimeSender(sender, EXTENSION_ID);
      if (result !== true) throw new Error(`Expected true, got ${result}`);
    }
  },
  {
    name: 'isTrustedRuntimeSender: matching extension ID with chrome-extension URL → trusted',
    fn() {
      const sender = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/background.js` };
      const result = isTrustedRuntimeSender(sender, EXTENSION_ID);
      if (result !== true) throw new Error(`Expected true, got ${result}`);
    }
  },
  {
    name: 'isTrustedRuntimeSender: wrong extension ID → not trusted',
    fn() {
      const sender = { id: 'wrongid' };
      const result = isTrustedRuntimeSender(sender, EXTENSION_ID);
      if (result !== false) throw new Error(`Expected false, got ${result}`);
    }
  },
  {
    name: 'isTrustedRuntimeSender: null sender → not trusted',
    fn() {
      const result = isTrustedRuntimeSender(null, EXTENSION_ID);
      if (result !== false) throw new Error(`Expected false, got ${result}`);
    }
  },
  {
    name: 'isTrustedRuntimeSender: empty extension ID → not trusted',
    fn() {
      const sender = { id: EXTENSION_ID };
      const result = isTrustedRuntimeSender(sender, '');
      if (result !== false) throw new Error(`Expected false, got ${result}`);
    }
  },
  {
    name: 'isTrustedRuntimeSender: sender with tab.url matching extension → trusted',
    fn() {
      const sender = { id: EXTENSION_ID, tab: { url: `chrome-extension://${EXTENSION_ID}/popup.html` } };
      const result = isTrustedRuntimeSender(sender, EXTENSION_ID);
      if (result !== true) throw new Error(`Expected true, got ${result}`);
    }
  },
  {
    name: 'isTrustedRuntimeSender: sender with allowed page pattern → trusted',
    fn() {
      const sender = { id: EXTENSION_ID, url: 'https://x.com/somepage' };
      const pattern = /^https:\/\/x\.com\//;
      const result = isTrustedRuntimeSender(sender, EXTENSION_ID, pattern);
      if (result !== true) throw new Error(`Expected true, got ${result}`);
    }
  },
  {
    name: 'isTrustedRuntimeSender: sender URL not matching pattern → not trusted',
    fn() {
      const sender = { id: EXTENSION_ID, url: 'https://evil.com/page' };
      const pattern = /^https:\/\/x\.com\//;
      const result = isTrustedRuntimeSender(sender, EXTENSION_ID, pattern);
      if (result !== false) throw new Error(`Expected false, got ${result}`);
    }
  },
  {
    name: 'isTrustedRuntimeSender: undefined extension ID → not trusted',
    fn() {
      const sender = { id: EXTENSION_ID };
      const result = isTrustedRuntimeSender(sender, undefined);
      if (result !== false) throw new Error(`Expected false, got ${result}`);
    }
  },
  {
    name: 'isTrustedRuntimeSender: sender ID mismatch with tab URL → not trusted',
    fn() {
      const sender = { id: 'differentid', tab: { url: `chrome-extension://${EXTENSION_ID}/popup.html` } };
      const result = isTrustedRuntimeSender(sender, EXTENSION_ID);
      if (result !== false) throw new Error(`Expected false, got ${result}`);
    }
  }
];
