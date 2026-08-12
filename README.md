# DraftPulse — AI-Assisted Reply Drafting & Engagement Insights

**AI analyzes → AI drafts → Human decides → Human posts**

DraftPulse 是一款 Chrome 扩展，复用浏览器中已登录的 Gemini、ChatGPT 或 DeepSeek 网页会话，为 X/Twitter 推文生成回复草稿并提供浏览增速洞察。

> **DraftPulse 绝不自动发布、点赞、关注或转发内容。** 所有回复由用户审阅后手动发布。

## 核心功能

- **Engagement Pulse** — 浏览量/小时增速追踪，Pulse Score 热度评级（🔥 Hot / ↗ Rising / → Normal / ↓ Cooling）
- **AI Draft** — 生成回复候选，带风格标签（Insightful / Casual / Short）
- **Persona System** — 11 种内置风格人设 + 自定义风格（Professional / Agreeable / Humorous / Questioning / Counter / Pithy / Tech Creator / Developer / Researcher / Casual / Custom）
- **My Voice** — 个人写作风格档案：风格描述、写作样本、禁用短语
- **Thread Context** — Smart / Single / Thread 三种模式，理解对话上下文生成更精准的回复
- **Image Understanding** — AI 可查看并理解推文附带图片（最多 4 张）
- **Gemini Web Session** — 复用已有 Gemini 浏览器会话，无需 API Key
- **Human-in-the-loop** — Draft Panel 模式，生成后审阅/编辑再填入回复框
- **Per-Account Memory** — 按 X 账号记忆偏好设置，切换账号自动切换配置

## 安装

1. 解压 `draftpulse_v2.0.zip`
2. 打开 `chrome://extensions/`（或 Edge 的 `edge://extensions/`）
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"，选择包含 `manifest.json` 的文件夹
5. 刷新 X 页面和 AI 模型标签页
6. 在扩展弹窗点击"重新注入 X 页面脚本"，确认状态为"已启用"

**系统要求：** Chrome 102+ 或 Edge（Manifest V3）

## 支持的 AI 提供商

| 提供商 | 模式 | 说明 |
|--------|------|------|
| **Gemini** | 自动 | 自动上传图片、发送提示词、读取回答、填入 X 回复框 |
| **ChatGPT** | 半自动 | 尝试附加图片，自动准备提示词，手动发送/复制/粘贴 |
| **DeepSeek** | 半自动 | 仅文字提示词，手动发送/复制/粘贴 |

## 使用

1. 在 X 打开要回复的推文，点击"回复"打开回复框（扩展不会替你点击）
2. 在工具栏选择模型并点击生成
3. **Gemini**：回答生成后自动填入回复框，检查后手动发布
4. **ChatGPT / DeepSeek**：扩展打开专用标签页并放入提示词，手动发送、复制回答，返回 X 粘贴
5. 生成中可点"取消"；失败信息显示在工具栏状态区

## 权限说明

- `storage`：保存设置（`chrome.storage.sync`）、浏览增速快照与诊断（`chrome.storage.local`）
- `scripting`：用于"重新注入 X 页面脚本"按钮
- host permissions 仅限：`x.com`、`twitter.com`、`pbs.twimg.com`、`gemini.google.com`、`chatgpt.com`、`chat.openai.com`、`chat.deepseek.com`

## 隐私与安全

- 详见 [PRIVACY.md](PRIVACY.md) — 数据存储与传输说明
- 详见 [SECURITY.md](SECURITY.md) — 提示注入防护与安全策略

## 自动化验证

```powershell
# 静态检查 + 单元测试 + manifest 校验
.\tools\run_checks.ps1

# 单元测试
node tests/run_tests.js
```

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源许可证。
