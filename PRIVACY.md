# PRIVACY.md — DraftPulse v2.0

## 本地存储

### chrome.storage.sync（跨设备同步）

- **回复设置**：persona（风格人设）、language（回复语言）、maxReplyLength（最大回复长度）、useEmoji、askQuestion、allowDisagreement、replyCount（候选数量）、customRequirements
- **My Voice**：enabled、description、samples（写作样本）、forbiddenPhrases（禁用短语）
- **Thread Context Mode**：single / smart / thread
- **Draft Panel Mode**：auto_fill / panel
- **Generation Cooldown**：冷却时间（15 / 30 / 60 / 120 秒）
- **Provider**：selectedProvider（gemini / chatgpt / deepseek）

### chrome.storage.local（仅本机）

- **View Growth Snapshots**（key: `draftpulseViewSnapshotsV1`）：推文浏览量随时间的快照数据，用于计算浏览增速。每条记录仅包含 `tweetId`、`views`（整数）、`observedAt`（时间戳）、`publishedAt`（时间戳）。最多 600 条，保留 14 天，自动清理过期条目。
- **Per-Account Memory**（key: `draftpulseAccountMemoryV1`）：按 X 账号记忆的设置覆盖（persona、language、replyStyle、lastUsedAt）。最多 20 个账号，按最近使用时间排序裁剪。
- **AI Request Records**：用于诊断面板显示最近请求的分阶段耗时与状态。仅包含状态码、耗时、错误类型，不包含推文正文、图片或 AI 回答。

## 发送到 AI 提供商的内容

当用户点击"生成"按钮时，扩展会向用户选择的 AI 提供商（Gemini / ChatGPT / DeepSeek）发送以下内容：

- **推文正文**：用户选中的推文文本内容（来自 X 页面）
- **上下文推文**：当 Thread Context 模式启用时，包含相关线程推文（上级推文、引用推文）
- **作者信息**：推文作者的用户名
- **图片**：用户选中的推文附带图片（最多 4 张，来自 pbs.twimg.com）
- **My Voice 偏好**：当 My Voice 功能启用时，发送用户的写作风格描述、写作样本和禁用短语
- **Persona 风格指令**：所选人设的风格说明

所有外部内容（推文正文、作者名）在构建提示词时经过 XML 实体转义（`<` → `&lt;`，`>` → `&gt;`，`&` → `&amp;`），并放置在明确标记的不可信数据边界内（`<tweet>`、`<thread_context>`、`<my_voice>`）。

## 不存储或不传输的内容

- ❌ X 密码
- ❌ X Cookie
- ❌ X Token / Session Token
- ❌ Gemini / ChatGPT / DeepSeek 的 session token 或 auth header
- ❌ 浏览器 cookie 或 session 信息的读取/导出

## 确认

**经代码审查确认：DraftPulse 扩展当前代码不读取、不导出、不传输任何浏览器的 cookie 或 session token。** 扩展通过与用户已登录的 AI 网页会话交互来工作（发送提示词、读取回答），但从不访问或导出认证凭据。
