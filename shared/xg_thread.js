/*
 * xg_thread.js - 推文线程上下文提取（纯函数，可测试）。
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

  const MAX_CONTEXT_POSTS = 6;

  /*
   * Extract thread context for a given tweet article.
   * 
   * This is a DOM-based function designed to work in content scripts.
   * In Node.js tests, pass mock article objects.
   *
   * @param {Object} options
   * @param {string} options.mode - 'single' | 'smart' | 'thread'
   * @param {Object} options.currentTweet - { tweetId, text, author }
   * @param {Array} options.contextTweets - Array of { tweetId, text, author, isParent, isQuote }
   * @returns {Array} Array of { tweetId, text, author, isCurrent, isParent, isQuote }
   */
  function extractThreadContext(options) {
    const opts = options || {};
    const mode = opts.mode || 'single';
    const currentTweet = opts.currentTweet || null;
    const contextTweets = Array.isArray(opts.contextTweets) ? opts.contextTweets : [];

    if (mode === 'single' || !currentTweet) {
      return currentTweet ? [{ ...currentTweet, isCurrent: true, isParent: false, isQuote: false }] : [];
    }

    const result = [];

    // Always include current tweet first (highest priority)
    result.push({ ...currentTweet, isCurrent: true, isParent: false, isQuote: false });

    if (mode === 'smart' || mode === 'thread') {
      // Add parent tweets (the tweet this is replying to in a thread)
      const parents = contextTweets.filter(t => t.isParent).slice(0, MAX_CONTEXT_POSTS - 1);
      for (const parent of parents) {
        if (parent.tweetId && !result.some(r => r.tweetId === parent.tweetId)) {
          result.push({ ...parent, isCurrent: false, isParent: true, isQuote: false });
        }
      }

      // Add quote tweets
      const quotes = contextTweets.filter(t => t.isQuote).slice(0, Math.min(2, MAX_CONTEXT_POSTS - result.length));
      for (const quote of quotes) {
        if (quote.tweetId && !result.some(r => r.tweetId === quote.tweetId)) {
          result.push({ ...quote, isCurrent: false, isParent: false, isQuote: true });
        }
      }
    }

    if (mode === 'thread') {
      // Add remaining thread tweets (same author, consecutive)
      const threadTweets = contextTweets.filter(t => !t.isParent && !t.isQuote);
      for (const tweet of threadTweets) {
        if (result.length >= MAX_CONTEXT_POSTS) break;
        if (tweet.tweetId && !result.some(r => r.tweetId === tweet.tweetId)) {
          result.push({ ...tweet, isCurrent: false, isParent: false, isQuote: false });
        }
      }
    }

    return result.slice(0, MAX_CONTEXT_POSTS);
  }

  /*
   * Build thread context from DOM selectors (content script helper).
   * This function is meant to be called from content.js with real DOM elements.
   * 
   * @param {Element} article - The current tweet's article element
   * @param {Object} selectors - X DOM selectors (SELECTORS.x)
   * @param {string} currentTweetId - The current tweet's ID
   * @returns {Array} Array of { tweetId, text, author, isParent, isQuote }
   */
  function collectThreadTweetsFromDOM(article, selectors, currentTweetId) {
    const contextTweets = [];
    if (!article || !selectors) return contextTweets;

    try {
      // Look for parent tweet link (in-reply-to)
      const replyLink = article.querySelector(selectors.replyingTo || 'a[href*="/status/"]');
      if (replyLink) {
        const href = replyLink.getAttribute('href') || '';
        const match = href.match(/\/status\/(\d+)/);
        if (match && match[1] !== currentTweetId) {
          // Find the parent article
          const parentArticle = replyLink.closest(selectors.article || 'article');
          if (parentArticle && parentArticle !== article) {
            const textEl = parentArticle.querySelector(selectors.tweetText || '[data-testid="tweetText"]');
            const userEl = parentArticle.querySelector(selectors.userName || '[data-testid="User-Name"]');
            contextTweets.push({
              tweetId: match[1],
              text: textEl ? (textEl.innerText || textEl.textContent || '').trim() : '',
              author: userEl ? (userEl.innerText || '').split('\n')[0].trim() : '',
              isParent: true,
              isQuote: false
            });
          }
        }
      }

      // Look for quote tweet within the article
      const quoteContainer = article.querySelector(selectors.quoteContainer || '[data-testid="quoteTweet"]');
      if (quoteContainer) {
        const quoteLink = quoteContainer.querySelector('a[href*="/status/"]');
        if (quoteLink) {
          const href = quoteLink.getAttribute('href') || '';
          const match = href.match(/\/status\/(\d+)/);
          if (match && match[1] !== currentTweetId) {
            const textEl = quoteContainer.querySelector(selectors.tweetText || '[data-testid="tweetText"]');
            const userEl = quoteContainer.querySelector(selectors.userName || '[data-testid="User-Name"]');
            contextTweets.push({
              tweetId: match[1],
              text: textEl ? (textEl.innerText || textEl.textContent || '').trim() : '',
              author: userEl ? (userEl.innerText || '').split('\n')[0].trim() : '',
              isParent: false,
              isQuote: true
            });
          }
        }
      }
    } catch (_) {
      // DOM access may fail in tests; gracefully return what we have
    }

    return contextTweets;
  }

  return {
    MAX_CONTEXT_POSTS,
    extractThreadContext,
    collectThreadTweetsFromDOM
  };
});
