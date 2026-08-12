/*
 * xg_selectors.js - 站点选择器集中管理。
 * 每个角色提供多级 fallback；fallback 均限定在对应站点的输入/会话区域，
 * 不使用“页面所有 contenteditable / 所有 button”这类过宽选择器。
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

  const SELECTORS = Object.freeze({
    x: Object.freeze({
      article: 'article[data-testid="tweet"]',
      tweetText: 'div[data-testid="tweetText"]',
      showMore: '[data-testid="tweet-text-show-more-link"], button[aria-label*="Show more" i], button[aria-label*="显示更多"]',
      userName: 'div[data-testid="User-Name"]',
      time: 'time[datetime]',
      statusLink: 'a[href*="/status/"]',
      replyButton: 'button[data-testid="reply"]',
      retweetButton: 'button[data-testid="retweet"], button[data-testid="unretweet"]',
      likeButton: 'button[data-testid="like"], button[data-testid="unlike"]',
      viewLink: 'a[href$="/analytics"], a[aria-label*="view" i], a[aria-label*="浏览"], a[aria-label*="观看"]',
      actionGroup: 'div[role="group"]',
      tweetPhotoImage: 'div[data-testid="tweetPhoto"] img[src]',
      photoLinkImage: 'a[href*="/photo/"] img[src]',
      anyMediaImage: 'img[src*="pbs.twimg.com/media/"]',
      videoContainer: 'div[data-testid="videoPlayer"], video, a[href*="/video/"]',
      cardContainer: '[data-testid="card.wrapper"], [data-testid^="card."]',
      avatarContainer: '[data-testid^="UserAvatar"], [data-testid*="-Avatar"], img[src*="/profile_images/"]',
      quoteContainer: '[data-testid="tweetQuote"], [data-testid*="Quote" i]',
      backgroundPhoto: 'div[data-testid="tweetPhoto"] [style*="background-image"]',
      replyEditorDialog: '[role="dialog"] div[data-testid^="tweetTextarea_"] [contenteditable="true"]',
      replyEditorTextbox: '[role="dialog"] div[role="textbox"][contenteditable="true"]',
      replyEditorInline: 'main div[data-testid^="tweetTextarea_"] [contenteditable="true"]',
      replyEditorGlobal: 'div[data-testid^="tweetTextarea_"] [contenteditable="true"]',
      replyingTo: 'a[href*="/status/"]',
      inReplyTo: 'span.r-poiln0.r-bcqeeo.r-qvutc0, [data-testid="tweet"] span.css-901oao.css-16my406',
      threadLink: 'a[href*="/status/"]',
      quoteTweetContainer: '[data-testid="quoteTweet"], [data-testid="tweet"] [role="link"]'
    }),
    gemini: Object.freeze({
      composer: [
        'rich-textarea [contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'main textarea[aria-label*="prompt" i]',
        'textarea[aria-label*="prompt" i]',
        'textarea[placeholder*="Gemini" i]'
      ],
      response: [
        'message-content',
        'model-response message-content',
        '[data-message-author-role="model"]',
        '.model-response-text',
        '.markdown-main-panel',
        '.markdown'
      ],
      userMessage: 'user-query, [data-message-author-role="user"], [data-author="user"]',
      thinking: '[class*="thinking" i], [class*="reasoning" i]',
      fileInput: 'input[type="file"][accept*="image" i], input[type="file"][accept*="jpeg" i], input[type="file"][accept*="png" i], input[type="file"][accept*="webp" i]',
      sendButton: [
        'button.send-button',
        'button[aria-label="Send message"]',
        'button[aria-label="发送消息"]',
        'button[aria-label*="Send" i]',
        'button[aria-label*="发送"]'
      ],
      stopButton: [
        'button[aria-label="Stop response"]',
        'button[aria-label="停止回答"]',
        'button[aria-label="停止响应"]',
        'button[aria-label*="Stop" i]',
        'button[aria-label*="停止"]'
      ],
      uploading: [
        '[role="progressbar"]',
        'mat-progress-spinner',
        'progress',
        '[aria-label*="uploading" i]',
        '[aria-label*="上传中"]',
        '[class*="upload-progress" i]'
      ],
      attachmentRoot: 'form, input-area-v2, bard-mode-switcher, [class*="input-area" i], [class*="composer" i]',
      removeControl: [
        '[aria-label*="remove file" i]',
        '[aria-label*="remove image" i]',
        '[aria-label*="删除文件" i]',
        '[aria-label*="删除图片" i]',
        '[aria-label*="移除文件" i]',
        '[aria-label*="移除图片" i]'
      ],
      previewUnit: '[data-testid*="attachment" i], [data-test-id*="attachment" i], [class*="file-preview" i], [class*="attachment-preview" i]',
      attachButtonPattern: /(?:add|attach|upload).*(?:file|photo|image)|(?:file|photo|image).*(?:add|attach|upload)|添加.*(?:文件|图片|照片)|上传.*(?:文件|图片|照片)|附件/i,
      uploadMenuPattern: /upload files?|upload image|上传文件|上传图片|从设备上传/i
    }),
    chatgpt: Object.freeze({
      composer: [
        '#prompt-textarea',
        'textarea[data-testid="prompt-textarea"]',
        'div[data-testid="prompt-textarea"][contenteditable="true"]',
        'main form textarea',
        'main div[contenteditable="true"][role="textbox"]'
      ],
      fileInput: 'input[type="file"][accept*="image" i], input[type="file"][accept*="jpeg" i], input[type="file"][accept*="png" i], input[type="file"][accept*="webp" i]',
      attachButtonPattern: /attach|upload|add photos|add files|添加文件|上传|附件|照片|图片|添加/i,
      uploadMenuPattern: /upload|from computer|add photos|上传|从电脑|添加照片|添加文件/i,
      attachSignal: 'img[src^="blob:"], img[src^="data:image/"], [data-testid*="attachment" i], [data-testid*="file" i], button[aria-label*="remove" i], button[aria-label*="删除" i]'
    }),
    deepseek: Object.freeze({
      composer: [
        'main textarea[placeholder*="输入" i]',
        'main textarea[placeholder*="message" i]',
        '[class*="chat-input" i] textarea',
        '[class*="input-area" i] textarea',
        'main textarea'
      ],
      excludePlaceholderPattern: /search|搜索|设置|邮箱|email|password|密码/i
    })
  });

  return { SELECTORS };
});
