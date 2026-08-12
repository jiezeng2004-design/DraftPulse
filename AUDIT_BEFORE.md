# v1.5.0 修改前审计（AUDIT_BEFORE）

审计方式：完整阅读全部源码（manifest.json、background.js、content.js、gemini_bridge.js、chatgpt_bridge.js、deepseek_bridge.js、popup.html/popup.js/popup.css、styles.css、README.md、AUDIT.md），并对全部 JavaScript 执行 `node --check`，对代码执行 `eval`/`new Function`/远程脚本/`http://`/`console` 静态搜索。未信任 README/AUDIT.md 中的完成声明。

## 静态验证结果（真实执行）

- 6 个 JavaScript 文件全部通过 `node --check`（background.js、content.js、gemini_bridge.js、chatgpt_bridge.js、deepseek_bridge.js、popup.js，退出码均为 0）。
- manifest.json 为 Manifest V3，JSON 可解析；权限仅 `storage`、`scripting`；host_permissions 无 `<all_urls>`，全部为 https 白名单。
- 未发现 `eval`、`new Function`、`console.*`、`http://` 明文 URL、远程脚本。
- `content.js:367` 的 `providerSelect.innerHTML = [...]` 为静态字面量，无用户输入拼接，不构成注入风险。

## 确定存在的问题（按严重度）

### 高

1. **浏览量增速会显示瞬时虚假的“近次增速”**
   `content.js:224-232`：快照间隔不足 `SNAPSHOT_MIN_INTERVAL_MS`（2 分钟）时，仍用两次检查的瞬时差计算 `recentRate` 并直接显示为 `observed`。每次扫描的 4 个延迟更新（`content.js:12`、`content.js:582`）会反复触发该路径，例如 250ms 内浏览量 +1 会显示约 14400 浏览/小时。要求是“间隔达到最低阈值后”才显示近次增速，否则回退平均增速。

2. **快照存储结构与要求不符**
   `content.js:210-217` 保存 `{first, last, recentRate, updatedAt}`；要求只保存 `{tweetId, views, observedAt, publishedAt}`，且 600 条/14 天上限应作用于新结构。

3. **Gemini 回答可能在生成中途返回（半截/旧回答）**
   `gemini_bridge.js:440-445`：停止判断依赖 `isGenerating()` 的按钮选择器（`gemini_bridge.js:531-539`，仅 aria-label 几种）。一旦选择器失配，`isGenerating()` 恒为 false，首个文本块出现约 220ms 后就 `finish`，返回不完整回答。要求：多信号判断停止（停止按钮、进度条、spinner），并满足“停止生成且稳定 300~800ms”后才返回。

4. **“新回答”判定不可靠**
   `gemini_bridge.js:453` 以 `elements.length > baseline.count || text !== baseline.lastText` 判断新回答，没有记录“本次请求后新增的模型回答节点”。若新旧回答文本恰好相同，会漏读或误读旧回答。要求发送前记录回答节点基线，只读取本次请求新增节点。

5. **X 回填会覆盖用户手写内容**
   `content.js:557-573` 的 `fillXEditor` 无条件 `selectNodeContents` 后 `insertText`，无论回复框当前是否已有内容。要求：空框直接填入；已有相同内容不重复插入；已有用户手写内容不得覆盖。

6. **自动点击 X 的“回复”按钮**
   `content.js:505`（半自动模式）与 `content.js:518-521`（自动模式）自动 `nativeReplyButton.click()` 打开回复框。用户要求“不自动点击 X 的‘回复/发布’按钮”，需改为仅在回复框已打开时填入，否则明确提示用户先打开回复框。

### 中

7. **消息来源未全面校验**
   仅 `background.js:55` 对 `GENERATE_AI_REPLY_WEB` 校验了 sender；`background.js:70-105` 的 `GET_PROVIDER_STATUS`、`OPEN_PROVIDER_TAB`、`GET_ACTIVE_PROVIDER`、`GET_X_PAGE_STATUS`、`REPAIR_X_PAGE` 均不校验 sender。三个桥接脚本（`gemini_bridge.js:28`、`chatgpt_bridge.js:19`、`deepseek_bridge.js:15`）与 `content.js:35` 的 runtime 监听器也都不校验 sender。要求校验所有 onMessage 来源并限定站点。

8. **requestId 未全链路校验**
   `background.js:156-175` 向桥接发送 requestId 但不校验响应的 `response.requestId`；`content.js:511-515` 也不校验返回的 requestId。要求 X、background、桥接全链路校验。

9. **图片下载重定向校验不完整**
   `background.js:332-335` 只校验最终 URL 的 protocol 与 hostname，未校验 pathname 仍为 `/media/`。要求 protocol、hostname、pathname 和重定向后最终域名全部校验。

10. **GIF/视频缩略图/外链卡片被当普通图片**
    `content.js:276-280` 的 `img[src*="pbs.twimg.com/media/"]` 会命中视频缩略图、GIF 播放器封面和卡片预览图；无 `videoPlayer`、`/video/`、`card.wrapper` 排除。要求明确区分。

11. **Gemini 单图上传无显式重试与节流**
    `gemini_bridge.js:117-139` 对每张图片只按 input/paste/drop 三种策略各试一次，无“每张最多重试 2 次”、无上传间隔节流、无单图总预算。另 `gemini_bridge.js:314-330`：图片已确认附加但 30s 内未“稳定”时整体抛错，即使上传实际成功。

12. **设置项不完整**
    `popup.html:30-58` 只有 4 种预设风格 + 自定义、6 种语言 + 自定义；缺少“反方讨论”“简短锐评”、最大回复长度、Emoji、是否提问、是否允许不同意见、回复数量（1/3）、自定义补充要求。`popup.js:168-176` 的允许集相应缺失。

13. **无统一 prompt builder**
    `background.js:206-263` 的 `buildPrompt`/`getPersonaInstruction`/`getLanguageInstruction` 与后台逻辑耦合；要求统一模块，且推文正文、图片 alt 必须放在明确的不可信数据边界内，所有模型共用。

14. **无提供商适配器架构**
    后台调度（`background.js:110-204`）直接按 provider 分支，桥接契约（`PING_*`/`ASK_*`/`PREPARE_*`）散落；要求统一 `ProviderAdapter` 接口（ensureDedicatedTab/prepareRequest/attachImages/submitPrompt/waitForResponse/extractResponse/cancelRequest）与能力标记。

15. **无诊断功能**
    popup 无版本、X 注入状态、推文数、工具栏数、登录状态、最近请求状态、分阶段耗时、最近错误、导出脱敏诊断；无“重新注入/重新扫描/打开专用标签页/清除快照”按钮组。

16. **无分阶段耗时记录**
    要求记录图片下载、图片上传、提示词发送、模型生成、回答提取、X 回填各阶段耗时（仅时间，不记录内容），目前完全没有。

17. **无单元测试**
    项目无 `tests/`；AUDIT.md 声称的“静态验证”仅覆盖语法与 JSON。要求以 Node 内置 assert 覆盖解析、增速、图片、回答提取、回填、设置、manifest 等。

### 低

18. **选择器散落且部分过宽**
    `deepseek_bridge.js:7-12` 含裸 `textarea`、`div[contenteditable="true"]`；`chatgpt_bridge.js:11` 含 `form textarea`；`gemini_bridge.js:23` 的 `input[type="file"]` 无站点限定。要求集中管理选择器、多级 fallback 且 fallback 不得宽到全页。

19. **回复框查找只认 `[role="dialog"]`**
    `content.js:543-555` 只查 dialog 内编辑器；X 详情页的内联回复框（无 dialog）会找不到，需多级 fallback 且不能命中页面所有 contenteditable。

20. **工具栏样式只适配深色**
    `styles.css:65-77` 的 select/背景为固定深色值，浅色主题下观感差；要求浅色/深色双主题。

21. **生成中无取消入口**
    `content.js:494-499` 生成时仅禁用按钮；要求取消或超时恢复。

22. **错误只显示在 toast**
    `content.js:534-535` 错误只走 toast；要求优先显示在工具栏状态区域。

23. **高频扫描**
    `content.js:84-86` 全文档 `childList+subtree` 的 MutationObserver 每次变更都触发扫描，且每个 article 排 4 个延迟更新；要求节流/队列。

24. **service worker 重启后任务状态丢失**
    `background.js:49` 的请求队列、桥接 `busy` 均为内存态；worker 重启后进行中的请求会失败。需在错误文案与诊断中明确，并在 AUDIT_AFTER 中列为残余风险。

25. **旧快照结构无迁移**
    `content.js:245-253` 只做结构过滤，未把 v1.4.0 的 `{first,last,recentRate}` 迁移到新结构；升级用户会丢失已有快照基线。

## 潜在问题（未在真实页面复现）

- `content.js:178-190` 的 tweetId 提取优先取 time 元素最近的 `/status/` 链接，逻辑正确；但无 time 的广告/推广推文可能取到引用推文 ID，属低概率。
- `gemini_bridge.js:77` 的基线在附加图片前捕获；若用户在生成期间手动操作专用标签页，可能干扰基线，应在提示中说明。
- `content.js:105-127` 的 `parseMetric` 对 `1,234`、`1.2K`、`1.2万` 已验证正确；对极端混合格式（如 `1,234.5万`）未做专门处理，风险低。
- X 页面浏览量锚点的英文/中文 aria-label 差异由 `content.js:139` 的多条件选择器覆盖，未在真实页面复现确认。

## 未验证项

- 本环境没有用户已登录的 X/Gemini/ChatGPT/DeepSeek 会话，无法做真实账号下的端到端 DOM 点击与回填验证；所有 DOM 选择器结论均为静态推断，必须在新版本 AUDIT_AFTER 中如实标注“未验证”，并给出浏览器端验收步骤。
