(function () {
  'use strict';
  const DP = require('../shared/xg_thread.js');

  function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
  }

  const tests = [];

  tests.push({
    name: 'extractThreadContext: single mode returns only current tweet',
    fn: () => {
      const result = DP.extractThreadContext({
        mode: 'single',
        currentTweet: { tweetId: '1', text: 'Hello', author: 'Alice' },
        contextTweets: [{ tweetId: '2', text: 'Parent', author: 'Bob', isParent: true }]
      });
      assert(result.length === 1);
      assert(result[0].tweetId === '1');
      assert(result[0].isCurrent === true);
    }
  });

  tests.push({
    name: 'extractThreadContext: smart mode includes parent',
    fn: () => {
      const result = DP.extractThreadContext({
        mode: 'smart',
        currentTweet: { tweetId: '1', text: 'Reply', author: 'Alice' },
        contextTweets: [{ tweetId: '2', text: 'Parent', author: 'Bob', isParent: true }]
      });
      assert(result.length === 2);
      assert(result[0].isCurrent === true);
      assert(result[1].isParent === true);
    }
  });

  tests.push({
    name: 'extractThreadContext: smart mode includes quote',
    fn: () => {
      const result = DP.extractThreadContext({
        mode: 'smart',
        currentTweet: { tweetId: '1', text: 'QT', author: 'Alice' },
        contextTweets: [{ tweetId: '3', text: 'Quoted', author: 'Carol', isQuote: true }]
      });
      assert(result.length === 2);
      assert(result[1].isQuote === true);
    }
  });

  tests.push({
    name: 'extractThreadContext: thread mode includes all',
    fn: () => {
      const result = DP.extractThreadContext({
        mode: 'thread',
        currentTweet: { tweetId: '1', text: 'Thread 3', author: 'Alice' },
        contextTweets: [
          { tweetId: '2', text: 'Parent', author: 'Alice', isParent: true },
          { tweetId: '3', text: 'Thread 1', author: 'Alice' },
          { tweetId: '4', text: 'Thread 2', author: 'Alice' }
        ]
      });
      assert(result.length === 4);
    }
  });

  tests.push({
    name: 'extractThreadContext: MAX_CONTEXT_POSTS limit',
    fn: () => {
      const contextTweets = [];
      for (let i = 2; i <= 20; i++) {
        contextTweets.push({ tweetId: String(i), text: `Tweet ${i}`, author: 'Alice', isParent: i === 2 });
      }
      const result = DP.extractThreadContext({
        mode: 'thread',
        currentTweet: { tweetId: '1', text: 'Current', author: 'Alice' },
        contextTweets
      });
      assert(result.length <= DP.MAX_CONTEXT_POSTS);
    }
  });

  tests.push({
    name: 'extractThreadContext: null currentTweet returns empty',
    fn: () => {
      const result = DP.extractThreadContext({ mode: 'smart', currentTweet: null });
      assert(result.length === 0);
    }
  });

  tests.push({
    name: 'extractThreadContext: no duplicates',
    fn: () => {
      const result = DP.extractThreadContext({
        mode: 'smart',
        currentTweet: { tweetId: '1', text: 'Current', author: 'Alice' },
        contextTweets: [
          { tweetId: '1', text: 'Duplicate', author: 'Alice', isParent: true }
        ]
      });
      assert(result.length === 1);
    }
  });

  tests.push({
    name: 'MAX_CONTEXT_POSTS is 6',
    fn: () => {
      assert(DP.MAX_CONTEXT_POSTS === 6);
    }
  });

  module.exports = { tests };
})();
