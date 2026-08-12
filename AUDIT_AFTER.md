# v1.5.0 修改后审查（AUDIT_AFTER）

## 安全审查结论

- **消息来源校验**：background 对所有 `chrome.runtime.onMessage` 先校验 `sender.id`，再按动作校验站点（X 请求只接受 `x.com/twitter.com`；弹窗动作只接受 `chrome-extension://`）。三个桥接分别限定 `gemini.google.com`、`chatgpt.com/chat.openai.com`、`chat.deepseek.com`；X content script 校验扩展来源与站点。
- **图片下载**：仅允许 `https://pbs.twimg.com/media/`；请求后校验最终 URL 的 protocol、hostname、pathname（重定向后仍必须是 `/media/`）、MIME 白名单、单张 8 MiB、总计 20 MiB、`content-length` 声明值。
- **无远程代码**：未使用 `eval`、`new Function`、远程脚本、内联脚本、明文 `http://`；CSP 未放开任何远程来源（MV3 默认策略）。
- **凭据与内容**：不读取/导出 Cookie、Token 等凭据；快照与诊断存储不含推文正文、图片、AI 回答、账号信息。
- **权限最小化**：仅 `storage`、`scripting`；host permissions 全部为明确 https 白名单，无 `<all_urls>`。
- **自动行为边界**：不自动点击 X 回复/发布按钮；Gemini 只自动发送提示词到 Gemini 页面并回填草稿；ChatGPT/DeepSeek 不自动发送、不自动读取回答。

## 可靠性审查结论

- **requestId 全链路**：X 生成 requestId，background 校验桥接返回的 requestId，桥接校验会话 requestId；过期/串线响应被拒绝。
- **并发控制**：background 全局队列串行；Gemini 桥接单飞守卫拒绝并发；X 生成按钮生成期间禁用并显示取消入口。
- **取消生效范围**：后台维护取消标记，排队中/下载中/逐张上传前/发送前各阶段均可取消，不再只对 Gemini 等待阶段生效。
- **回答读取**：发送前记录回答节点基线，只读新增节点；停止判断为多信号；稳定约 500ms 返回；180ms 轮询仅作兜底；90s 内部超时 + background 125s 总超时。
- **回填安全**：`decideFill` 决策（空框填入/相同跳过/用户内容不覆盖）；回复去重覆盖段落拼接与 DOM 嵌套重复；3 条候选的切换仅在回复框内容仍与已填入文本一致时执行，防止覆盖用户修改。
- **纯图推文**：无正文时任一图片上传失败会明确报错，不再静默跳过。
- **快照**：3 分钟最小间隔、下降/异常回退平均、刚发布不估算、600 条/14 天清理、旧结构自动迁移。
- **DOM 容错**：选择器集中管理且多级 fallback；扫描 300ms 防抖；重复注入通过实例销毁机制避免重复工具栏；推文 DOM 被 X 替换后重新扫描识别。

## 已验证

- 全部 JavaScript 通过 `node --check`。
- 测试框架对异步用例使用 `await` 真实等待（探针验证：注入必败用例得到 FAIL 1 与退出码 1）；弹窗状态刷新收敛为单次 `GET_DIAGNOSTICS` 往返。
- 179 项测试全部通过：单元测试（解析、增速、图片、X DOM 判定、适配器、回答提取与节点复用、回填、设置、prompt、回复规范化、timeout、diagnostics、指标格式化）+ vm 沙箱冒烟（content 生成流程含半自动、待回填补填、取消、候选切换含拦截、失败耗时保留、消息与存储通道、快照持久化兜底与清除竞态、指标与元数据缓存边界、回填决策全分支/三个桥接含 PING、非法载荷拒绝与来源校验兼容分支/popup 交互、诊断展示、刷新防重入与成功失败路径全覆盖/background 全链路、X 维护动作（打开标签页/重新注入/重新扫描/清除快照）、取消标记清理、桥接状态与轮询恢复路径、twitter.com 来源、unhandledRejection 统计、XG API/动作名/版本一致性、导出脱敏字段白名单）+ manifest 与 PowerShell 语法静态校验。探针验证过：破坏 `XG.*` 引用会被一致性测试捕获（FAIL 1、退出码 1）；破坏生成提示文案会被生成流程测试捕获（FAIL 1、退出码 1）。测试曾暴露并修复 `formatTimings` 解构取错字段、失败请求耗时丢失、快照持久化饿死、无浏览量推文误显示“0 浏览/小时”与清除快照被旧任务覆盖五个真实缺陷。
- 真实浏览器消息往返验证（background→content `DRAFTPULSE_PING`）发现并修复生产级缺陷：Chrome 的 `tabs.sendMessage`（SW→content/bridge）不填充 `sender.url`/`sender.tab`，旧来源校验会拒绝所有后台消息；修复后往返实测 `success:true, version:1.5.0`，生成链路（background→桥接）不再被误拒。
- 真实浏览器桥接验证（已完成）：gemini.google.com、chatgpt.com、chat.deepseek.com 三个页面均验证桥接隔离世界注入成功、background→桥接 PING 往返成功；未登录的 Gemini/DeepSeek 正确返回 `ready:false` 与登录提示，ChatGPT 返回 `ready:true`。三个桥接的注入、消息通道与状态判断在真实页面全部实证可用。
- 真实浏览器工具栏渲染验证（已完成）：在真实 x.com 页面注入测试推文 DOM，验证 content script 的 MutationObserver 检测并渲染工具栏；实测面板创建、图片数（`2 图`）、平均增速（`6,171 浏览/小时`）、互动指标、按钮文案（`生成图文草稿（2图）`）全部正确。该验证同时发现并修复了 `getCachedMeta` 数字/数组语义不一致导致图片数显示 `undefined 图` 的真实缺陷。
- 真实浏览器计数与防重复验证（已完成）：注入推文后 PING 返回 `tweets:1, panels:1`，`DRAFTPULSE_RESCAN` 后面板数保持 1；布局检查（不溢出、不重叠、不超出卡片）通过。这些指标现纳入 `browser_verify` 的通过判定。
- **真实浏览器验证（已完成）**：使用 Chrome for Testing 119 加载扩展，实测：扩展加载成功（版本 1.5.0）、service worker 启动、`https://x.com/` 页面 content script 隔离世界注入成功、`__DRAFTPULSE_CONTENT_INSTANCE__` 版本 1.5.0、页面零异常。该验证覆盖扩展安装与注入链路；x.com 当前为未登录首页，推文 DOM 交互与 Gemini/ChatGPT/DeepSeek 页面操作仍需登录会话（见下方未验证项）。
- manifest 静态校验：版本 1.5.0、权限最小化、无 `<all_urls>`、文件引用完整、无 eval/远程脚本、CSP 合规、共享模块加载顺序正确。
- ZIP 完整性与 SHA-256 校验通过（见 `test.log`）。

## 未验证（必须如实说明）

本环境没有用户已登录的 X/Gemini/ChatGPT/DeepSeek 会话，**无法进行真实账号下的端到端 DOM 点击、上传与回填验证**。以下内容为静态实现，未在真实页面复现：

- Gemini 页面当前的输入框、附件容器、发送/停止按钮、回答节点的实际 DOM 结构与选择器匹配。
- X 回复框（弹窗与内联）的实际结构，以及浅色/深色主题下的实际渲染。
- ChatGPT/DeepSeek 上传入口与输入框的实际选择器。
- 图片真实下载链路的 HTTP 行为（缓存、重定向、MIME 头）。

### 浏览器端验收步骤

1. 加载扩展并刷新 X，确认每条主推文下方出现一个工具栏，无重复；浅色/深色主题下均可见。
2. 打开一条带多图的推文，确认按钮显示 `（N图）`，且 N 不包含头像、引用推文、视频封面和卡片图。
3. 打开回复框后点击生成（Gemini）：确认 Gemini 页面逐张出现图片预览、发送后回答自动填入回复框且只填一次；生成期间点“取消”应停止。
4. 回复框内先手写文字再生成：确认扩展不覆盖手写内容。
5. 查看弹窗诊断：确认版本、注入状态、推文/工具栏数、登录状态、最近请求阶段耗时与错误显示正常；“导出脱敏诊断信息”不含正文与凭据。
6. 浏览量增速：首次显示“平均增速”；至少 3 分钟后刷新同一推文，显示“近次增速 · 间隔 N 分钟”。
