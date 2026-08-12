# DraftPulse — AI-Assisted Reply Drafting & Engagement Insights

[简体中文](README.md) | [English](README_EN.md)

**AI analyzes → AI drafts → Human decides → Human posts**

DraftPulse is a Chrome extension that reuses your existing signed-in Gemini, ChatGPT, or DeepSeek web sessions to draft replies for X/Twitter posts and provide view-growth insights.

> **DraftPulse never automatically posts, likes, follows, or reposts content.** Every reply must be reviewed and posted manually by the user.

## Key Features

- **Engagement Pulse** — Tracks views per hour and assigns a Pulse Score rating (🔥 Hot / ↗ Rising / → Normal / ↓ Cooling)
- **AI Draft** — Generates reply candidates with style labels (Insightful / Casual / Short)
- **Persona System** — 11 built-in personas plus a custom style (Professional / Agreeable / Humorous / Questioning / Counter / Pithy / Tech Creator / Developer / Researcher / Casual / Custom)
- **My Voice** — A personal writing profile with a style description, writing samples, and blocked phrases
- **Thread Context** — Smart / Single / Thread modes for more context-aware replies
- **Image Understanding** — Lets the AI inspect and understand up to four images attached to a post
- **Gemini Web Session** — Reuses an existing Gemini browser session without requiring an API key
- **Human-in-the-loop** — Draft Panel mode lets you review and edit generated text before filling the reply box
- **Per-Account Memory** — Remembers preferences separately for each X account and switches settings with the active account

## Installation

1. Extract `draftpulse_v2.0.zip`
2. Open `chrome://extensions/` (or `edge://extensions/` in Edge)
3. Enable **Developer mode**
4. Click **Load unpacked** and select the folder containing `manifest.json`
5. Refresh the X page and the AI provider tab
6. Open the extension popup, click **重新注入 X 页面脚本** (**Re-inject X page scripts**), and confirm that the status shows **已启用** (**Enabled**)

**System requirements:** Chrome 102+ or Microsoft Edge with Manifest V3 support

## Supported AI Providers

| Provider | Mode | Description |
|----------|------|-------------|
| **Gemini** | Automatic | Uploads images, sends the prompt, reads the response, and fills the X reply box automatically |
| **ChatGPT** | Semi-automatic | Attempts to attach images and prepares the prompt; you manually send, copy, and paste the response |
| **DeepSeek** | Semi-automatic | Prepares a text-only prompt; you manually send, copy, and paste the response |

## Usage

1. Open a post on X and click **Reply** to open the reply box (the extension will not click it for you)
2. Select a provider in the toolbar and click the generate button
3. **Gemini:** After generation, the response is filled into the reply box automatically; review it and post manually
4. **ChatGPT / DeepSeek:** The extension opens a dedicated tab and prepares the prompt; send it manually, copy the response, then return to X and paste it
5. You can cancel while generation is in progress; errors appear in the toolbar status area

## Permissions

- `storage`: Stores settings in `chrome.storage.sync`, plus view-growth snapshots and diagnostics in `chrome.storage.local`
- `scripting`: Powers the **Re-inject X page scripts** action
- Host permissions are limited to `x.com`, `twitter.com`, `pbs.twimg.com`, `gemini.google.com`, `chatgpt.com`, `chat.openai.com`, and `chat.deepseek.com`

## Privacy and Security

- See [PRIVACY.md](PRIVACY.md) for data storage and transfer details
- See [SECURITY.md](SECURITY.md) for prompt-injection defenses and the security policy

## Automated Verification

```powershell
# Static checks, unit tests, and manifest validation
.\tools\run_checks.ps1

# Unit tests
node tests/run_tests.js
```

## License

This project is licensed under the [Apache License 2.0](LICENSE).
