# Changelog

## v2.0（2026-08-11）

- 修复在 X 页面批量插入工具栏后当前视口发生偏移：扫描前记录可见推文锚点，插入后只补偿实际布局差值，并禁止工具栏自身成为浏览器滚动锚点。
- Gemini 长时间闲置后若第一次发送点击未被页面接受，会在确认“没有用户消息、编辑框未清空、没有新回答、没有生成信号”后自动重新聚焦并提交一次；最多两次，避免重复发送。
- popup 新增“暂时关闭插件 / 恢复插件”按钮。暂停后停止扫描、移除 X 工具栏并取消正在处理的请求；设置与浏览增速快照保留。
- 浏览器验证脚本不再包含个人绝对截图路径；默认写入系统临时目录，也可通过参数指定；最终断言改为读取清单版本，不再硬编码旧版 `1.5.0`。
- 现场构建标记为 `v1.5.2-r1`。

## v1.5.1（2026-08-08）

- 修复扩展升级/重载后旧 X 标签页抛出 `Extension context invalidated`：生成前主动检测上下文，错误不再原样暴露；工具栏改为明确的“刷新 X 页面恢复”入口，并在回复框有未发布文字时先确认，避免误丢草稿。
- 新内容脚本启动时清理扩展失效后遗留的孤儿工具栏；每条推文只保留当前实例管理的一个面板，诊断计数按推文去重，避免看起来显示两套回复工具栏、实际只有一个有效实例。
- 长推文生成前同时读取 `innerText` 与完整 DOM `textContent`；检测到 X 的“显示更多”控件时自动展开并等待正文重绘，再把完整内容传给模型，不再要求用户预先手动展开。
- 现场构建标记重置为 `v1.5.1-r1`。

## v1.5.0（2026-08-06）

相比 v1.4.0 的具体改动：

### 架构
- 新增 `shared/` 共享模块：数字解析、图片规范化与下载校验、浏览增速快照、设置 schema 与迁移、统一提示词构建、回答去重/稳定性判断、X 回填决策、站点选择器注册表、`ProviderAdapter` 统一接口。
- 提供商改为统一适配器（`ensureDedicatedTab / prepareRequest / attachImages / submitPrompt / waitForResponse / extractResponse / cancelRequest` + 能力标记），Gemini 保留自动模式，ChatGPT/DeepSeek 保持半自动，未增加其自动读取回答能力。
- 站点选择器集中到 `shared/xg_selectors.js`，为关键选择器提供多级 fallback，并收窄过宽选择器（DeepSeek 不再裸匹配 `textarea`，ChatGPT 限定 `main` 区域）。

### Gemini 多图上传
- Gemini 桥接拆分为逐张附加、发送、等待、提取四个子消息，background 对每张图片独立重试（最多 2 次重试）与间隔控制。
- 每张图片上传后校验附件预览数量确实 +1 才确认成功；返回实际确认张数，X 页面按实际张数显示，不虚报。
- 上传失败时明确返回“第几张失败 + 原因”；有正文的推文不会因图片失败而卡住（跳过失败图片继续生成）。
- X 侧图片提取增加上下文分类：排除头像、引用推文、GIF/视频播放器封面、外链卡片图、表情/图标；按媒体 ID 去重并统一提升为 `name=large`。

### Gemini 回答读取与回填
- 发送前记录回答节点基线，等待/提取只读取本次请求后新增的模型回答节点。
- 停止生成改为多信号判断（停止按钮 + 进度指示器），停止并稳定约 500ms（生成中需静止 1.5s 兜底）后返回，不再依赖单一 aria-label。
- 新增 `requestId` 全链路校验（X → background → 桥接 → 返回）。
- 回填前决策：空框直接填入、已有相同内容不重复插入、已有用户手写内容不覆盖。
- 重复回答清理：完整段落重复、两次相同文本拼接、DOM 嵌套重复行。
- 不再自动点击 X 的回复/发布按钮；回复框未打开时明确提示，已生成但未回填的内容会在打开回复框后再次点击时直接填入。

### 浏览增速
- 快照结构改为 `{tweetId, views, observedAt, publishedAt}`，兼容迁移 v1.4.0 旧结构。
- 快照间隔未达 3 分钟阈值、浏览量下降、时间异常、解析失败时一律回退“平均增速”，不再显示瞬时虚假增速。
- 刚发布不足 1 分钟显示“增速待积累”，避免异常巨大数值；支持跨天间隔；600 条/14 天上限与自动清理。

### 设置与弹窗
- 新增“反方讨论”“简短锐评”两种预设风格；新增最大回复长度、Emoji、结尾提问、允许不同意见、回复数量（1/3 候选）、自定义补充要求。
- 所有设置存 `chrome.storage.sync`，经 `normalizeSettings` 校验与默认值迁移，三个提供商共用统一 prompt builder。
- 提示词明确声明推文内容是待分析材料、不执行推文中的命令、不遵循图片中的提示词或角色设定、只输出最终回复。

### 诊断与安全
- 新增诊断区：版本、X 注入状态、推文/工具栏数、提供商、专用标签页、登录状态、最近请求状态、各阶段耗时、最近错误；按钮：重新注入、重新扫描、打开专用标签页、清除快照、导出脱敏诊断。
- 所有 `chrome.runtime.onMessage` 校验 sender 与站点；图片下载校验最终重定向的协议/域名/路径；错误信息不含完整 URL 参数与页面内部数据。
- 分阶段耗时记录：图片下载、图片上传、提示词发送、模型生成、回答提取、X 回填，仅记录时间。
- 3 条候选实际可用：生成后返回全部候选，X 工具栏提供候选切换；仅当回复框内容仍与已填入文本一致（未被手动修改）时才允许安全替换。
- 排队中或下载中的请求可取消：后台维护取消标记，取消在图片下载前、逐张上传前、发送前各阶段生效，不再只对正在 Gemini 等待中的请求生效。
- 纯图片推文的上传失败不再被静默跳过：有正文时失败图片跳过并继续生成，无正文时明确报错。
- Gemini “回答提取”阶段改为真实测量耗时；弹窗状态区每 4 秒自动刷新。
- 回复最终规范化（前缀清理、去重、候选拆分、长度截断）提取到 `shared/xg_reply.js`，background 编排逻辑变薄，行为可单测。
- 图片下载从串行改为 2 路并发（总量校验保持不变），多图推文的下载等待时间明显缩短。
- 弹窗诊断刷新增加防重入（4 秒轮询不会叠加请求），三个提供商状态改为并行查询，最坏等待从 9s+ 收敛到 3s。
- X 侧“待回填草稿 / 候选回复”两个临时 Map 增加 60 条容量上限，避免长时间浏览后内存无界增长。
- X 侧图片上下文分类与 srcset 择优提取到 `shared/xg_xdom.js` 纯函数，7 项组合测试覆盖头像/引用/视频/卡片/表情排除与清晰度选择。
- X 工具栏的推文元数据（图片数、推文 ID、发布时间）按推文面板缓存 5 秒，滚动与虚拟列表复用场景的扫描开销下降；点击生成时仍实时读取。
- 取消检查覆盖图片下载循环、Gemini 发送按钮等待、ChatGPT 附件等待阶段，取消响应更及时。
- 验证脚本 `tools/run_checks.ps1` 支持无参数运行（默认校验同目录 ZIP）。
- X 工具栏互动指标（回复/转发/喜欢/浏览）增加 2 秒面板缓存，滚动与高频扫描时 DOM 查询次数进一步下降；点击生成时仍实时读取推文与图片。
- 失败的请求现在保留分阶段耗时：下载/上传/发送/等待各阶段已耗时随错误一并返回，弹窗诊断可看到失败前各环节耗时（此前失败请求的耗时全部丢失）。
- 新增 `tests/test_adapters.js`：用假 transport 覆盖 `ProviderAdapter` 全部接口接线、能力标记、未知提供商回退与无标签页短路（10 项）。
- 测试框架修复：`tests/run_tests.js` 现在真正等待异步测试并统计（此前异步断言未 await，失败时统计不可靠）；已用探针用例验证 FAIL 计数与退出码 1 正确。
- 弹窗状态刷新收敛为单次 `GET_DIAGNOSTICS`：一次往返同时更新提供商状态、X 页面状态、诊断区与最近请求；移除 popup 对 `GET_PROVIDER_STATUS`、`GET_X_PAGE_STATUS`、`GET_ACTIVE_PROVIDER` 的重复轮询，background 相应删除三个不再使用的消息动作。
- “重新扫描推文”现在会强制失效所有工具栏的元数据/指标缓存，重新扫描立即反映最新图片数与互动数字，不再受 2~5 秒缓存窗口影响。
- 修复浏览量锚点延迟渲染时的缓存缺陷：指标缓存只在成功读到浏览量时写入，X 尚未渲染浏览量链接的窗口不会被缓存成“无数据”。
- 新增 `tests/smoke_browser_scripts.js`：用 Node `vm` 沙箱（注入最小 chrome/document/storage mock）真实执行 content、三个桥接与 popup 脚本，验证加载、监听器注册、popup 初始化流程；测试运行器增加 `unhandledRejection` 统计。用探针验证过：破坏 content.js 引用后冒烟测试 FAIL 1，还原后 104/104 通过。
- 修复真实运行 bug：background.js 以裸标识符调用 `getProviderDef`，而它定义在 `xg_adapters` 共享命名空间内（真实浏览器会 `ReferenceError`）。background 冒烟测试捕获后改为 `XG.getProviderDef`，所有共享 API 调用统一走命名空间。
- 新增 background.js vm 集成冒烟：注入 `importScripts` 实现后真实加载 background，验证监听器注册、`GET_DIAGNOSTICS` 完整响应（version/activeProvider/providers/xPage）与非法消息来源拒绝。
- 回填比较的空白归一化改为“折叠连续空白为单个空格”而非删除全部空白，避免 `hello world` 与 `helloworld` 被误判为相同而跳过回填。
- 新增 `tests/test_consistency.js`：静态校验全部浏览器脚本的 `XG.*` 引用必须存在于共享 API 集合、content.js 的 VERSION 与 manifest 版本一致、popup 脚本依赖与桥接共享文件注入完整。探针验证：把 `XG.parseMetric` 改拼错后测试 FAIL 1、退出码 1。
- 取消语义补全：X 页面在用户点击取消后记录本地取消标记，即使回答已在 Gemini 生成完成、后台仍返回成功响应，也不再填入回复框，并显示“请求已取消，已忽略已完成的回答”。
- background.js 的 `GENERATE_AI_REPLY_WEB` 全链路加入 vm 集成冒烟：非法来源立即拒绝、取消标记使排队请求立即失败、合法来源返回 requestId 与分阶段耗时。测试发现并修复真实缺陷：回答规范化（`normalizeReplyCandidates`）失败时未附带 `timings`，失败诊断的耗时全部丢失。
- 新增提供商动作名与桥接文件一致性校验：`PROVIDER_DEFS` 中的 ping/attach/submit/wait/extract/cancel/request 动作必须存在于对应桥接文件；`DRAFTPULSE_*` 与生成/取消动作在 background 与 content 中必须一致。
- popup 交互流程纳入 vm 冒烟：保存设置按钮写入 `storage.sync`（校验风格/语言/长度/数量/开关字段）、重新注入与重新扫描按钮发出对应动作。测试基建修复：元素 mock 的 Proxy `set` 陷阱此前用错参数索引导致属性赋值不生效。
- 弹窗诊断耗时列表增加“总耗时”项（`totalMs`），与图片下载、图片上传、提示词发送、模型生成、回答提取、X 回填并列展示。
- 真实浏览器端到端验证：新增 `tools/browser_verify.ps1` + `browser_verify.js`，使用 Chrome for Testing 119（`--load-extension` 支持）在真实 Chrome 中加载扩展、连接 CDP、打开 `https://x.com/`，通过 `Runtime.executionContextCreated` 确认 content script 隔离世界注入并读取实例版本。实测通过：扩展 1.5.0 加载、注入成功、实例版本 1.5.0、零页面异常。`run_checks.ps1 -IncludeBrowserVerify` 可复现。说明：Chrome 137+ 移除了命令行加载扩展，本机 Chrome 151 无法用于该验证，需下载 Chrome for Testing 119。
- X 工具栏 DOM 引用缓存：面板创建时缓存 badge/metrics/select/button/cancel/status/candidate 元素引用（WeakMap），每次扫描不再重复 querySelector，扫描开销进一步下降。
- 图片下载增加单张 30 秒超时（AbortController）：单张请求挂起不会拖死整个请求，超时按该张失败跳过；取消标记检查仍保留在各阶段。
- 修复生成完成后按钮文本被旧文案覆盖的问题：`finally` 中不再写回生成前的 `originalText`，按钮标签始终反映最新图片数。
- 真实浏览器验证增加全局 110 秒看门狗与阶段硬超时：x.com 网络不通或页面挂起时验证脚本会超时退出而非无限等待，回归不会再卡住。
- 新增导出脱敏静态断言：popup 导出字段白名单（版本/提供商/xPage/最近请求）校验 + 最近请求记录字段白名单校验，防止推文正文、图片、AI 回答或凭据混入诊断导出。
- 真实浏览器验证扩展至 popup 页面：CDP 打开 `chrome-extension://<id>/popup.html`，验证版本标签 `v1.5.0`、诊断区渲染（3 个提供商选项）、点击“导出脱敏诊断”后输出 JSON 且不含 `tweetText/images/reply`（实测 537 字节，全字段脱敏通过）。
- 三个桥接（Gemini/ChatGPT/DeepSeek）新增 PING 集成测试：合法站点来源返回 `success:true` 状态结构，非法站点来源被拒绝。
- 核心成功路径补上 vm 集成测试（此前只测失败路径）：Gemini 自动模式无图请求端到端走完 PING→SUBMIT→WAIT→EXTRACT 编排，验证 requestId 透传、候选回复返回、分阶段耗时回传、调用顺序（PING/SUBMIT/WAIT/EXTRACT）与 manual 分支；ChatGPT 半自动成功路径验证 `mode:'manual'`、`prepared:true` 与 instruction 内容。测试基建增强：chrome mock 支持可配置 storage 预置数据、标签页查询与按 action 路由的 `tabs.sendMessage`。
- **修复真实生产级缺陷**：真实浏览器验证新增 background→content 的 `DRAFTPULSE_PING` 消息往返检查，发现 Chrome 中 `tabs.sendMessage`（SW → content/bridge）不填充 `sender.url`/`sender.tab`（探针实测 `id` 有值、`url` 缺失、`tab` 为 null），旧实现会拒绝所有后台消息，导致生成链路在真实浏览器中不可用。已放宽来源校验：扩展自身 `sender.id` 校验保持不变，URL 站点校验仅在元数据存在时执行（content 与三个桥接同步修复）；并补充“无 URL 元数据接受 / 恶意 URL 拒绝”的 vm 测试覆盖。
- content 侧生成请求增加 140 秒超时保护：service worker 卡死或重启导致响应丢失时，按钮会自动恢复并提示重试，不再永久禁用。
- popup 保存设置增加 try/catch/finally：storage 写入失败时按钮恢复可点并提示“保存失败，请重试”。
- 真实浏览器验证扩展至三个 AI 提供商页面：`browser_verify` 依次打开 gemini.google.com / chatgpt.com / chat.deepseek.com，验证桥接隔离世界注入与 background→桥接的 PING 往返。实测全部通过：Gemini `ready:false`（未登录提示）、ChatGPT `ready:true`、DeepSeek `ready:false`（未登录提示），证明三个桥接的注入、消息通道与状态判断在真实页面均可用。站点不可达（网络受限）时如实记录 `reachable:false` 而不误报注入失败。
- 修复图片下载超时回归：重构中丢失的 30 秒 AbortController 超时已恢复（单张请求挂起不再拖死整个请求），并新增下载路径 vm 集成测试：fetch 成功（携带 abort signal、附加 1 张图、downloadMs 回传）与重定向到非法域名时纯图请求报错且附带下载耗时。
- 新增 `shared/xg_timeout.js`：`withTimeout`/`sleep` 从 background 与 content 的三份重复实现收敛为共享模块（背景、内容、测试统一走 `XG.withTimeout`/`XG.sleep`），并新增 5 项 timeout 单元测试。
- content.js 生成流程首次纳入自动化测试（此前只有冒烟与 PING）：mock 基建增强（`HTMLElement`/`Element` 原型、`closest`/`querySelectorAll` 分发、`classList`、`execCommand`、`window.getSelection`、created 元素登记）后新增 3 条真实交互测试：无正文无图提示且不发送请求、自动模式回复框未打开时明确提示且不发送请求、自动模式成功回填（空回复框直接填入，校验 requestId 回显与状态文案）。探针验证：改坏“未检测到已打开的回复框”文案后测试 FAIL 1、退出码 1。
- **修复回答等待超时缺陷**：`findNewResponse` 原先只按“节点序号大于发送前基线”判定新回答；若 Gemini 流式回答复用最后一个节点（节点数不增），会永远等不到新节点直到 90 秒超时。已增加文本变化兜底：节点数未增但最后一个非用户节点文本与基线不同，同样视为新回答。新增 3 项测试覆盖复用节点文本变化、文本未变化不误报、末尾空用户节点兜底。
- 生成流程集成测试扩展至回填决策全分支：新增“回复框已有用户手写内容时不覆盖”（校验用户内容原样保留）与“回复框已有相同内容时不重复插入”两条；至此空框填入/用户内容不覆盖/相同跳过三个回填分支均被自动化覆盖。
- 测试运行器加固：vm 沙箱内残留的 toast/扫描/刷新定时器会阻止 Node 事件循环退出，`run_tests.js` 现于打印结果后显式 `process.exit()`，完整 142 项测试稳定在约 5.4 秒内完成，不再超时挂起。
- Gemini/ChatGPT 桥接的私有 `sleep` 收敛为共享 `XG.sleep`（`xg_timeout` 加入三个桥接的 manifest 注入列表），跨脚本超时/延时工具完全统一；`content.js` 的 `isVisible` 补齐 `visibility/display` 检查（与三个桥接一致），隐藏元素不再被误判为可见回复框。
- **真实浏览器工具栏渲染验证（新增）**：`browser_verify` 在真实 x.com 页面注入测试推文 DOM，验证 content script 的 MutationObserver 检测到推文后真实渲染工具栏。实测通过：面板 1 个、增速徽章 `6,171 浏览/小时`（12345÷2 小时，平均增速正确）、指标行含 `2 图`、按钮文案 `生成图文草稿（2图）`。
- **修复真实 bug（浏览器验证暴露）**：`getCachedMeta` 返回 `images` 为数字计数，但 `updateTweet` 按数组使用 `images.length`（数字无 `.length`），导致工具栏图片数显示 `undefined 图` 且按钮丢失“图文”前缀。已统一为数字语义并新增 vm 断言（metrics 含 `0 图`）。
- **浏览器验证再扩展**：注入推文后重新 PING 校验计数一致（`tweets:1, panels:1`）、触发 `DRAFTPULSE_RESCAN` 后面板数保持 1（防重复工具栏）、CDP 程序化布局检查（工具栏位于推文卡片内 `inBounds:true`、文字无溢出、子元素无重叠，面板与卡片同宽 1020px）、X 页面截图存档。
- `browser_verify` 最终判定收紧：`pingAfterTweet`（计数一致）与 `panelsAfterRescan`（防重复）纳入通过条件，此前仅报告不判定；`getDiagnostics` 的 `chrome.storage.local` 读取增加兜底，storage 异常时诊断仍可返回；popup 导出诊断按钮增加防重复点击与“正在导出…”加载态、失败时输出明确提示。
- 修复测试时序脆弱性：Gemini 成功路径的桥接 mock 增加 2ms 延迟，避免整个请求在同 1 毫秒内完成导致 `totalMs=0` 的偶发断言失败；连续 3 次运行 142/142 稳定通过。
- popup 交互测试补齐：新增“打开专用标签页”（发送 `OPEN_PROVIDER_TAB`）、”清除热度快照“（确认后发送 `CLEAR_VIEW_SNAPSHOTS`）、”导出脱敏诊断“（输出 JSON 含 version/provider、不含 tweetText、按钮恢复）三条；沙箱注入 `window.confirm`。
- content 生成流程新增半自动模式（ChatGPT）测试：切换模型选择器后点击生成，不要求回复框，校验请求发往 chatgpt 且状态显示“提示词已放入 ChatGPT”。
- content 生成流程新增待回填补填测试：模拟生成期间用户关闭回复框（延迟响应 mock），校验回答生成后进入待回填状态（“回答已生成，但回复框已关闭”）、再次点击直接补填且不发送新请求。`createArticleMock` 增加 time/status 链接结构以还原真实 tweetId 提取；新增 `waitForStatusText` 轮询 helper 消除计时器精度依赖。调试中发现 mock 延迟补丁曾匹配到错误测试，已修正为 async+150ms 延迟响应。
- `browser_verify.ps1` 增加自动重试（默认失败后重试 1 次，`-Retries N` 可调）：网络抖动、x.com 临时不可达等偶发失败不再直接判负，降低回归误报。
- 修复 `browser_verify.ps1` 退出码捕获缺陷：node 的 JSON 报告此前被函数返回值捕获，导致重试判断收到的是报告文本而非退出码；现报告透传到控制台、退出码存脚本级变量，重试逻辑按真实退出码工作。
- **修复真实缺陷：弹窗诊断耗时恒显示“暂无”**：`formatTimings` 的过滤器用 `[, key]` 解构，取到的是标签文本而非字段名（`timings['图片下载']` 恒为 undefined），分阶段耗时在真实浏览器中也从未显示。已将 `formatTimings`/`formatMs` 抽为共享模块 `shared/xg_diagnostics.js`（popup 引用），解构修正为 `[key]`，新增 4 项单元测试。
- 测试基建：`createChromeMock` 的运行时消息返回值 contextify 进 vm 沙箱 realm（修复跨 realm 对象 `Number(obj[key])` 失效问题）；`createDocumentMock` 补 `createTextNode`/`execCommand` 调用记录与可配置返回，`replaceChildren` 回写文本，支撑候选切换回退路径测试。
- 新增测试：候选切换（3 候选生成→切换写入候选 2，走 `execCommand` 失败回退路径）、popup 诊断分阶段耗时展示（lastRequest 带 timings）。
- `run_checks.ps1` 新增 PowerShell 语法解析检查（`tools/*.ps1`），防止脚本语法回归。
- content 侧消息与状态通道测试补齐：`DRAFTPULSE_CLEAR_SNAPSHOTS`（清除后持久化空快照）、`storageListener`（sync 中 selectedProvider 变化后新请求使用新提供商）；`recordLastRequest` 落盘断言（storage.local 写入 status/provider 字段）；popup 失败路径（打开标签页与重新注入失败时状态区显示错误文案）。mock 暴露 `storageListeners` 数组供测试触发。
- **修复 content 侧失败请求耗时丢失**：`generateReply` 失败分支先记录带 `timings` 的最近请求，随后 `throw` 进 catch 再以 `timings: null` 覆盖，导致失败请求的分阶段耗时丢失（background 已修同类问题，content 漏掉）。现统一由 catch 记录并透传 `error.timings`；新增测试断言失败请求的 `downloadMs/totalMs` 保留。另删除 `generateReply` 中未使用的 `startedAt` 死代码。
- 交互分支测试补齐四条：候选切换在回复框内容被修改时拒绝切换并还原选择（用户内容不被覆盖）；生成中点击取消发送 `CANCEL_PROVIDER_REQUEST` 且晚到的响应不回填（状态“请求已取消，已忽略已完成的回答”、按钮恢复）；待回填补填时回复框已有用户内容不覆盖；popup 保存设置写入失败提示“保存失败，请重试”并恢复按钮。测试基建修复：元素 mock 的 `dataset` 从每次返回新对象改为持久对象（此前取消按钮读不到 `activeRequestId`），`execCommandResult:false` 路径正确回写文本。
- 补充五个校验与状态测试：popup 刷新防重入（in-flight 期间连续触发 change 不叠加 `GET_DIAGNOSTICS` 请求）；popup 在 `xPage.state === 'no_x_tab'` 时显示“未注入”与提示文案；Gemini `ATTACH_GEMINI_IMAGE` 与 ChatGPT `PREPARE_CHATGPT_WEB` 在来源合法但图片数据 URL 非法时拒绝（`图片数据格式无效`）；DeepSeek `PREPARE_DEEPSEEK_WEB` 空提示词拒绝。同步修正 CHANGELOG 中浏览器验证暂停说明的测试计数（147 → 161）。
- 补充 background 状态路径测试：专用标签页存在但桥接消息失败时 `GET_DIAGNOSTICS` 返回 `providers.gemini.state === 'loading'`（消息“尚未就绪”）；`waitForBridge` 在 PING 首次失败后经轮询恢复（第二次成功）并走完 Gemini 自动成功路径（断言 PING 至少 2 次）。
- **修复清除快照竞态**：`DRAFTPULSE_CLEAR_SNAPSHOTS` 此前只清内存，此前排入的 1200ms 防抖落盘任务在延迟更新重建快照后仍会把旧快照写回（用户清除后浏览页面上未刷新的推文，清除可能被旧任务覆盖）。新增“快照世代号”：清除时 `snapshotEpoch+1`，落盘任务触发时校验世代不符即放弃；新快照正常落盘。
- **修复测试基建浅拷贝缺陷（偶发失败根因）**：`storage.local.set` 的 mock 用浅拷贝记录调用，快照对象后续原地加键会污染历史 `setCalls` 记录，导致“清除后应为空快照”断言偶发失败（真实 Chrome 的 storage 序列化无此问题）。改为 JSON 深拷贝后连续 4 次全量运行稳定通过。
- **性能与死代码清理**：`formatMetric`/`formatRate` 改为复用缓存的 `Intl.NumberFormat` 实例（此前每次调用新建，扫描高频路径有额外开销）；删除无消费者的 `clampNumber` 导出；`getCachedMeta` 去掉死字段 `fresh` 并减少一次 JSON 解析（写后不再读回）。
- **修复快照持久化饿死缺陷**：`schedulePersistSnapshots` 原为纯 1200ms 防抖，滚动/虚拟列表期间持续出现新推文会不断重置 timer，浏览增速快照可能长时间不落盘。现增加 5 秒最大延迟兜底：调度超过 5 秒仍被重置则立即落盘；新增真实时序测试（每 500ms 注入新推文，断言 3 秒防抖窗口内不落盘、超过 5 秒强制落盘）。
- **修复临时 Map LRU 语义**：`pendingReplies`/`filledCandidates` 对已存在 key 的 `set` 不更新 Map 迭代顺序，重复写入同一推文会被误判为“最旧”而被 `pruneEphemeralMaps` 删除；改为先 `delete` 再 `set`，让最近写入的 key 位于迭代末尾。
- **修复真实缺陷：无浏览量锚点的推文错误显示“⚡ 0 浏览/小时”**。`getViewGrowth` 重构时丢失了 `metrics.hasViews` 检查，浏览量链接延迟渲染或无浏览量的推文会用 `views=0` 计算平均增速并显示“⚡ 0 浏览/小时”，而非“增速待获取”。已恢复 `hasViews` 前置检查；新增“指标缓存：浏览量锚点延迟出现时不缓存 unavailable，出现后缓存生效”测试（首次断言“增速待获取”且不写缓存，锚点出现后断言增速与缓存写入）。
- 测试基建：`createArticleMock` 支持 `viewsLinkVisible`/`views` 与动态切换浏览量锚点；`createElementMock` 的 `closest` 支持外部注入 `__closestResult`，`insertAdjacentElement` 支持 `onInsertAdjacent` 回调——面板插入 article 后能通过 `findOwnPanel` 真正复用（此前 mock 每次扫描都新建面板，无法验证缓存复用路径）。
- 浏览器验证暂停：截至本版本，x.com 从本机网络持续不可达（外部网络状态），且用户暂停浏览器验证。`run_checks.ps1` 默认不执行浏览器验证；静态检查、179 项单元/集成测试、manifest 与 ZIP 完整性校验不受影响。恢复条件：网络恢复后运行 `.\tools\run_checks.ps1 -IncludeBrowserVerify` 即可复验（含自动重试）。
- **修复已打开标签页与已渲染工具栏被误报未就绪**：background 不再只依赖 `storage.session` 识别专用页；记录缺失时会从已打开标签页中认领最近使用的匹配页。Gemini/ChatGPT/DeepSeek 或 X 消息通道因扩展重载而失联时，诊断会按 manifest 的完整依赖顺序自动重注入并重试；“重新注入 X 页面脚本”同步改为注入全部共享依赖，不再单独执行会因 `DraftPulseShared` 缺失而失败的 `content.js`。三个提供商桥接改为可重复注入且只保留一个监听器，兼容旧布尔实例标记。新增 4 项 vm 集成回归与 1 项 manifest 顺序一致性校验，测试总数 184 项。
- **修复 Chrome 中失联消息解析为空响应时未触发自恢复**：部分 Chrome/MV3 环境在目标 content script 不存在时，`tabs.sendMessage()` 会 resolve `undefined` 而不是 reject。此前自动重注入只覆盖异常分支，导致弹窗稳定显示“Gemini 状态未知 / X 页面尚未加载增强脚本”。现在提供商与 X 的 PING 同时校验响应结构；空响应、非对象响应及 `success !== true` 均进入完整重注入并重试。回归测试改为复现真实的 resolved-undefined 行为。
- **修复本扩展 service worker 消息被内容脚本误判为非法来源**：部分 Chrome 版本在 `tabs.sendMessage()` 的接收端提供 `sender.url = chrome-extension://<本扩展 ID>/background.js`。旧校验只接受空 URL 或目标站点 URL，导致重注入成功后 X 与三个提供商仍拒绝后台 PING。新增统一 `isTrustedRuntimeSender`：严格要求相同扩展 ID，同时接受空 URL、相同扩展 origin 和对应目标站点，继续拒绝其他扩展与非目标网页。X/Gemini/ChatGPT/DeepSeek 均增加真实 service-worker sender URL 回归断言。
- 弹窗副标题增加现场构建标记 `v1.5.0-r3`，用于区分 Chrome 当前加载的是本轮握手修复源码还是仍缓存的旧 `v1.5.0`；manifest 发布版本保持 1.5.0。
- **修复 Gemini 已生成回答但 X 侧仍报“网页响应超时”**：后台不再用一条最长 105 秒的 `tabs.sendMessage` 持有等待通道，改为每 500ms 发起一次最长 5 秒的短轮询；Gemini 桥接同步返回 `pending/ready`，回答文本连续稳定 500ms（生成信号存在时 1.5s）即进入提取。这样不再依赖后台标签页长定时器或长消息端口，避免回答已渲染、跨标签页通道却迟迟不返回的误超时。
- Gemini 提交阶段新增真实确认：点击发送后必须观察到用户消息增加、编辑框内容变化、新回答出现或生成信号，才向后台报告 `submitted:true`；若提示词仍原样停在输入框，5 秒内直接返回“未确认提示词已发送”，不再进入两分钟无效等待。新增桥接级 `pending → ready → extract` 与后台多次短轮询回归测试；现场构建标记更新为 `v1.5.0-r4`。

### 其他
- 扫描改为 300ms 尾部防抖；新建工具栏才做延迟重复更新，降低高频 DOM 变更开销。
- 工具栏增加状态区（信息/成功/错误/警告）、取消按钮与错误重试入口；支持 X 浅色主题。
- 新增 `tests/`（184 项：单元测试含 diagnostics/timeout/指标格式化 + 浏览器脚本 vm 冒烟含 background 全链路与 X 维护动作/成功/失败/取消标记清理/标签页自动认领/桥接与 X 自动重注入/桥接状态与轮询恢复/图片下载路径、content 生成流程含半自动/待回填补填/取消/候选切换含拦截/失败耗时保留/消息与存储通道/快照持久化兜底/指标与元数据缓存边界/回填决策全分支、popup 交互诊断防重入与成功失败路径全覆盖、桥接 PING 与非法载荷拒绝/来源校验兼容分支含 twitter.com + 跨文件一致性含脱敏与自动修复注入顺序断言，含异步等待与 unhandledRejection 统计）与 manifest/PowerShell 静态校验；生成 `test.log`、`AUDIT_BEFORE.md`、`AUDIT_AFTER.md`。
- 版本号升级为 1.5.0（manifest、content script、popup 同步）。
