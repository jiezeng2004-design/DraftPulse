# AGENTS.md — DraftPulse

## 1. 模块职责表（shared/xg_*.js）

| 模块 | 职责 |
|------|------|
| xg_shared.js | 全局命名空间初始化（DraftPulseShared）与消息来源可信校验（isTrustedRuntimeSender） |
| xg_parse.js | 推文指标解析（数字/K/M/万）、文本格式化、sanitizeTweetForPrompt() 注入模式清理 |
| xg_timeout.js | Promise 超时包装（withTimeout）与 sleep 延时工具 |
| xg_images.js | 推文图片 URL 校验、收集与下载约束（协议/域名/MIME/大小） |
| xg_growth.js | 浏览量快照存储、增速计算（computeViewGrowth）、Pulse Score（computePulseScore） |
| xg_settings.js | 回复设置 schema、11 种 persona、7 种语言、normalizeSettings、My Voice 规范化 |
| xg_response.js | 模型回答去重、新回答定位、稳定性判断与请求守卫 |
| xg_editor.js | X 回复框回填决策（填/跳过/阻止）与编辑器选取 |
| xg_selectors.js | X / Gemini / ChatGPT / DeepSeek 各站点 DOM 选择器集中管理 |
| xg_xdom.js | X 页面图片上下文判定（是否配图）与 srcset 择优 |
| xg_cooldown.js | AI 生成冷却管理器（CooldownManager，支持 15/30/60/120 秒） |
| xg_thread.js | 推文线程上下文提取（single/smart/thread 模式，最多 6 条上下文） |
| xg_account_memory.js | 按 X 账号记忆默认设置（persona/language/replyStyle，最多 20 账号） |
| xg_platforms.js | 平台适配器注册表（当前仅 X 平台，支持扩展注册新平台） |
| xg_adapters.js | 提供商传输适配器统一接口（ensureTab / send / wait / cancel） |
| xg_diagnostics.js | 健康评分、分阶段耗时格式化展示工具 |
| xg_prompt.js | 提示词构建（buildPrompt，含 XML 转义与数据边界）、候选回复拆分（splitReplyCandidates） |
| xg_reply.js | 模型回复前缀清理、去重与长度截断 |

## 2. 加载顺序约束

### X 页面加载顺序

manifest.json `content_scripts`（X/Twitter 匹配）中的 `js` 数组顺序即依赖顺序，不可调换：

```
shared/xg_shared.js        ← 必须第一个（初始化 DraftPulseShared 命名空间）
shared/xg_parse.js
shared/xg_timeout.js
shared/xg_images.js
shared/xg_growth.js
shared/xg_settings.js
shared/xg_response.js
shared/xg_editor.js
shared/xg_selectors.js
shared/xg_xdom.js
shared/xg_platforms.js
shared/xg_cooldown.js
shared/xg_thread.js
shared/xg_account_memory.js
content.js                 ← 必须最后一个（主入口）
```

### Background 加载顺序

background.js 顶部 `importScripts()` 顺序：

```
shared/xg_shared.js        ← 必须第一个（初始化 DraftPulseShared 命名空间）
shared/xg_parse.js
shared/xg_timeout.js
shared/xg_images.js
shared/xg_settings.js
shared/xg_prompt.js
shared/xg_response.js
shared/xg_reply.js
shared/xg_adapters.js
shared/xg_diagnostics.js
shared/xg_platforms.js
shared/xg_cooldown.js
shared/xg_thread.js
shared/xg_account_memory.js
```

> **注意**：两个上下文独立加载：X 页面通过 manifest.json content_scripts 注入，Background 通过 importScripts() 加载。xg_adapters/xg_diagnostics/xg_prompt/xg_reply 仅在 Background 中加载。

桥接页面各自的最小依赖子集：
- **Gemini**: shared → xg_shared, xg_timeout, xg_images, xg_response, xg_selectors → gemini_bridge.js
- **ChatGPT**: shared → xg_shared, xg_timeout, xg_images, xg_response, xg_selectors → chatgpt_bridge.js
- **DeepSeek**: shared → xg_shared, xg_timeout, xg_response, xg_selectors → deepseek_bridge.js

## 3. 全局接口 DraftPulseShared (DP)

所有 shared 模块通过 UMD 模式向 `globalThis.DraftPulseShared` 合并导出。

| 分组 | 主要导出 |
|------|---------|
| **安全** | `isTrustedRuntimeSender` |
| **解析/格式化** | `parseMetric`, `formatMetric`, `formatRate`, `formatAge`, `sanitizeText`, `sanitizeTweetForPrompt` |
| **异步工具** | `withTimeout`, `sleep` |
| **图片** | `MAX_IMAGES`, `MAX_IMAGE_BYTES`, `MAX_DATA_URL_LENGTH`, `isAllowedImageUrl`, `normalizeXImageUrl`, `collectTweetImages`, `downloadImagesAsDataURLs` |
| **增速/Pulse** | `SNAPSHOT_STORAGE_KEY`, `normalizeSnapshotStore`, `computeViewGrowth`, `pruneSnapshotStore`, `computePulseScore`, `normalizeToScore`, `PULSE_WEIGHTS`, `PULSE_LABELS` |
| **设置** | `PROVIDER_IDS`, `PERSONA_IDS`, `LANGUAGE_IDS`, `PERSONAS`, `DEFAULT_SETTINGS`, `normalizeSettings`, `normalizeMyVoice`, `getPersonaInstruction`, `getPersona`, `getLanguageInstruction` |
| **回答处理** | `dedupeResponseText`, `findNewResponse`, `isResponseStable`, `createRequestGuard` |
| **编辑器** | `decideFill`, `sanitizeReplyForEditor`, `pickReplyEditor` |
| **选择器** | `SELECTORS`（含 `.x`, `.gemini`, `.chatgpt`, `.deepseek`） |
| **DOM 判定** | `shouldCollectImage`, `pickBestSrcset` |
| **冷却** | `CooldownManager`, `DEFAULT_COOLDOWN_SECONDS`, `ALLOWED_COOLDOWN_VALUES` |
| **线程上下文** | `extractThreadContext`, `collectThreadTweetsFromDOM`, `MAX_CONTEXT_POSTS` |
| **账号记忆** | `ACCOUNT_MEMORY_KEY`, `MAX_ACCOUNTS`, `detectCurrentXAccount`, `normalizeAccountMemoryStore`, `getAccountDefaults`, `setAccountDefaults`, `mergeAccountOverrides` |
| **平台注册** | `X_PLATFORM_DEF`, `PLATFORM_REGISTRY`, `getPlatform`, `registerPlatform` |
| **适配器** | `PROVIDER_DEFS`, `ProviderAdapter`, `createProviderAdapter` |
| **诊断** | `formatTimings`, `formatMs`, `TIMING_LABELS` |
| **提示词** | `buildPrompt`, `splitReplyCandidates` |
| **回复规范化** | `stripReplyPrefix`, `normalizeReplyCandidates` |

## 4. 平台/提供商注册表

### 平台适配器（xg_platforms.js）

| 平台 | ID | URL 模式 | 说明 |
|------|-----|---------|------|
| X / Twitter | `x` | `https://(www.)?(x.com\|twitter.com)/` | 当前唯一支持的社交媒体平台，maxContextPosts=6 |

通过 `registerPlatform(def)` 可扩展注册新平台。

### AI 提供商（xg_adapters.js / xg_settings.js）

| 提供商 | ID | 模式 | 说明 |
|--------|-----|------|------|
| Gemini | `gemini` | 自动 | 自动上传图片、发送提示词、读取回答、回填 X 回复框 |
| ChatGPT | `chatgpt` | 半自动 | 尝试附加图片，发送提示词，手动复制回答 |
| DeepSeek | `deepseek` | 半自动 | 仅文字提示词，手动复制回答 |

## 5. 桥接脚本

| 脚本 | 适配页面 | 说明 |
|------|---------|------|
| gemini_bridge.js | `https://gemini.google.com/*` | 操作 Gemini 网页：附加图片、提交提示词、等待并提取回答 |
| chatgpt_bridge.js | `https://chatgpt.com/*`, `https://chat.openai.com/*` | 操作 ChatGPT 网页：附加图片、提交提示词、等待并提取回答 |
| deepseek_bridge.js | `https://chat.deepseek.com/*` | 操作 DeepSeek 网页：提交提示词、等待并提取回答（无图片） |

## 6. 验证入口

```bash
# 单元测试
node tests/run_tests.js

# 完整检查（lint + 测试 + manifest 校验）
.\tools\run_checks.ps1
```
