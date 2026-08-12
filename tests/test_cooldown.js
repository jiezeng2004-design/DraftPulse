(function () {
  'use strict';
  const DP = require('../shared/xg_cooldown.js');

  function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
  }

  const tests = [];
  tests.push({
    name: 'CooldownManager: first acquire is allowed',
    fn: () => {
      const cm = new DP.CooldownManager({ cooldownSeconds: 30 });
      const result = cm.tryAcquire('tweet1');
      assert(result.allowed === true);
      assert(result.remainingMs === 0);
    }
  });
  tests.push({
    name: 'CooldownManager: second acquire within cooldown is rejected',
    fn: () => {
      const cm = new DP.CooldownManager({ cooldownSeconds: 30 });
      cm.tryAcquire('tweet1');
      const result = cm.tryAcquire('tweet1');
      assert(result.allowed === false);
      assert(result.remainingMs > 0);
      assert(result.remainingMs <= 30000);
    }
  });
  tests.push({
    name: 'CooldownManager: different keys are independent',
    fn: () => {
      const cm = new DP.CooldownManager({ cooldownSeconds: 30 });
      cm.tryAcquire('tweet1');
      const result = cm.tryAcquire('tweet2');
      assert(result.allowed === true);
    }
  });
  tests.push({
    name: 'CooldownManager: release allows immediate re-acquire',
    fn: () => {
      const cm = new DP.CooldownManager({ cooldownSeconds: 30 });
      cm.tryAcquire('tweet1');
      cm.release('tweet1');
      const result = cm.tryAcquire('tweet1');
      assert(result.allowed === true);
    }
  });
  tests.push({
    name: 'CooldownManager: getRemainingMs returns 0 for unknown key',
    fn: () => {
      const cm = new DP.CooldownManager({ cooldownSeconds: 30 });
      assert(cm.getRemainingMs('unknown') === 0);
    }
  });
  tests.push({
    name: 'CooldownManager: getRemainingMs returns positive for active cooldown',
    fn: () => {
      const cm = new DP.CooldownManager({ cooldownSeconds: 30 });
      cm.tryAcquire('tweet1');
      assert(cm.getRemainingMs('tweet1') > 0);
    }
  });
  tests.push({
    name: 'CooldownManager: setCooldownSeconds updates duration',
    fn: () => {
      const cm = new DP.CooldownManager({ cooldownSeconds: 30 });
      cm.setCooldownSeconds(60);
      cm.tryAcquire('tweet1');
      const result = cm.tryAcquire('tweet1');
      assert(result.remainingMs > 30000);
    }
  });
  tests.push({
    name: 'CooldownManager: empty key always allowed',
    fn: () => {
      const cm = new DP.CooldownManager({ cooldownSeconds: 30 });
      const r1 = cm.tryAcquire('');
      const r2 = cm.tryAcquire('');
      assert(r1.allowed === true);
      assert(r2.allowed === true);
    }
  });
  tests.push({
    name: 'CooldownManager: clear removes all cooldowns',
    fn: () => {
      const cm = new DP.CooldownManager({ cooldownSeconds: 30 });
      cm.tryAcquire('tweet1');
      cm.tryAcquire('tweet2');
      cm.clear();
      assert(cm.tryAcquire('tweet1').allowed === true);
      assert(cm.tryAcquire('tweet2').allowed === true);
    }
  });
  tests.push({
    name: 'DEFAULT_COOLDOWN_SECONDS is 30',
    fn: () => {
      assert(DP.DEFAULT_COOLDOWN_SECONDS === 30);
    }
  });
  tests.push({
    name: 'ALLOWED_COOLDOWN_VALUES is frozen',
    fn: () => {
      assert(Object.isFrozen(DP.ALLOWED_COOLDOWN_VALUES));
    }
  });

  module.exports = { tests };
})();
