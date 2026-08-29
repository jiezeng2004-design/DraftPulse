# DraftPulse

[简体中文](README.md) | [English](README_EN.md)

> **看 X 的时候直接生成回复草稿，但最后发不发，永远由你决定。**
>
> DraftPulse 把 X 帖子上下文交给你已经登录的 Gemini、ChatGPT 或 DeepSeek 网页会话，生成可编辑回复草稿，同时记录浏览增速，帮你判断哪些讨论正在升温。

**AI analyzes → AI drafts → Human decides → Human posts**

DraftPulse 是一个 Chrome / Edge 扩展。它不自动发帖、不自动点赞、不自动关注、不自动转发，而是把最重复的“复制推文 → 打开 AI → 写提示词 → 复制答案 → 回 X”流程缩短成一个可审阅的草稿工作流。

## 为什么做这个

回复 X 时，最麻烦的往往不是“AI 会不会写”，而是：

```text
看到一条推文
   ↓
复制内容 / 上下文
   ↓
切到 AI 网页
   ↓
解释想要什么语气
   ↓
复制答案
   ↓
切回 X
   ↓
再改成像自己说的话
```

DraftPulse 把它变成：

```text
打开 X 回复框
   ↓
读取当前帖子 / Thread 上下文
   ↓
选择模型 + 风格
   ↓
生成草稿
   ↓
你审阅 / 修改
   ↓
你手动发布
```

## 你能得到什么

- **AI Draft** — 为当前 X 帖子生成回复候选；
- **Thread Context** — Smart / Single / Thread 三种上下文模式；
- **Persona System** — 内置多种回复风格，也支持自定义；
- **My Voice** — 保存你的写作风格描述、样本和禁用短语；
- **Image Understanding** — 在支持的模型流程中把帖子图片带入上下文；
- **Engagement Pulse** — 根据你本地观察到的浏览增速给出 Hot / Rising / Normal / Cooling 状态；
- **Per-Account Memory** — 按 X 账号保存本地偏好；
- **Human-in-the-loop** — 所有草稿都要经过你审阅，扩展不会替你点击发布。

## 最重要的边界

> **DraftPulse 只帮你分析和起草，不替你做公开账号动作。**

它不会：

- 自动发布回复；
- 自动点赞；
- 自动关注；
- 自动转发；
- 批量群发回复；
- 在你没有打开回复流程时自行替你操作账号。

这也是项目刻意保留 human-in-the-loop 的原因。

## 安装

1. 解压 DraftPulse 发布包；
2. 打开 `chrome://extensions/` 或 `edge://extensions/`；
3. 开启 **开发者模式**；
4. 点击 **加载已解压的扩展程序**；
5. 选择包含 `manifest.json` 的目录；
6. 刷新 X 页面和你准备使用的 AI 网页；
7. 在扩展中重新注入 X 页面脚本并确认状态正常。

系统要求：

```text
Chrome 102+ / Edge
Manifest V3
```

## 支持的 AI 网页流程

| 提供商 | 当前模式 | 工作方式 |
| --- | --- | --- |
| **Gemini** | 自动化程度最高 | 可自动准备上下文、处理支持的图片并把生成结果带回草稿流程 |
| **ChatGPT** | 半自动 | 准备提示词 / 上下文，部分步骤需要你在网页中确认或复制 |
| **DeepSeek** | 半自动 | 以文字上下文为主，保留人工发送 / 复制步骤 |

DraftPulse 复用你浏览器里已经登录的网页会话，而不是要求你把 API Key 填进扩展。

不同网页端的 DOM、权限和交互方式可能随平台更新而变化，因此自动化能力不是三个提供商完全一致。

## 第一次使用

1. 在 X 打开一条你想回复的帖子；
2. 点击 X 自己的 **回复** 按钮，打开回复框；
3. 在 DraftPulse 工具栏选择模型；
4. 选择你想要的 Persona / My Voice；
5. 选择 Single / Smart / Thread 上下文；
6. 生成草稿；
7. 检查事实、语气和是否真的值得回复；
8. 需要时手动修改；
9. 最后由你点击 X 的发布按钮。

扩展不会替你执行第 1 步和最后一步。

## Persona 与 My Voice

内置风格覆盖常见场景，例如：

- Professional
- Agreeable
- Humorous
- Questioning
- Counter
- Pithy
- Tech Creator
- Developer
- Researcher
- Casual
- Custom

如果你不想每次都得到“标准 AI 回复”，可以在 **My Voice** 中提供：

- 你的风格描述；
- 真实写作样本；
- 不想出现的短语或表达；
- 你常用的长度和语气偏好。

目标不是让模型“模仿一个虚构人格”，而是减少你每次手工改稿的成本。

## Thread Context

| 模式 | 适合场景 |
| --- | --- |
| **Single** | 只根据当前帖子起草 |
| **Smart** | 自动判断需要多少上下文 |
| **Thread** | 需要理解连续讨论 / 上下文时 |

上下文越多并不一定越好。普通短回复优先用 Single / Smart；只有真正依赖上下文时再用 Thread。

## Engagement Pulse

DraftPulse 会在本地记录你观察到的浏览量快照，并计算浏览增速，帮助你区分：

```text
Hot
Rising
Normal
Cooling
```

它是一个**本地观察指标**，不是 X 官方推荐分数，也不代表平台一定会继续分发这条帖子。

正确的用途是：

> “这条讨论现在是不是还在加速，值得我优先看一下？”

而不是：

> “这个分数能预测未来流量。”

## 图片上下文

在支持的模型流程中，DraftPulse 可以把帖子附带图片带入草稿上下文，减少“只读文字导致漏掉图片信息”的情况。

当前设计最多处理 4 张帖子图片。是否能自动上传、读取和返回结果取决于对应 AI 网页流程。

## 权限说明

扩展使用的主要权限包括：

- `storage` — 保存设置、账号偏好、浏览增速快照和诊断信息；
- `scripting` — 用于重新注入 X 页面脚本；
- host permissions — 限定在 X / Twitter、帖子图片域名以及支持的 AI 网页域名。

详细隐私边界见：

- [PRIVACY.md](PRIVACY.md)
- [SECURITY.md](SECURITY.md)

## 隐私与安全原则

- 不把“生成草稿”变成“自动公开发布”；
- 不把浏览增速当作官方算法分数；
- 不要求在扩展里保存 AI API Key；
- 不把任意网页开放为 host permission；
- AI 生成内容必须由用户审阅后再使用；
- 帖子本身可能包含提示注入式文本，因此模型输出不应被视为可信指令。

## 自动化验证

静态检查、单元测试和 manifest 校验：

```powershell
.\tools\run_checks.ps1
```

单独运行单元测试：

```bash
node tests/run_tests.js
```

## DraftPulse 不是什么

- 不是 X 自动回复机器人；
- 不是增长承诺工具；
- 不是 X 官方算法分析器；
- 不是批量账号运营工具；
- 不是用网页会话绕过用户审阅的自动发帖系统。

它只是把：

> **理解帖子 → 起草回复 → 按自己的声音修改**

这段工作流做得更快一点。

## License

Apache License 2.0. See [LICENSE](LICENSE).