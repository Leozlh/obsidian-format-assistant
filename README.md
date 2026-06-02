# Obsidian Format Assistant

A lightweight, user-controlled Obsidian plugin for formatting selected text with an OpenAI-compatible Chat Completions API.

It does not scan your vault, does not batch-edit notes, and does not replace text until you confirm the preview modal.

## Commands

- `Format selection as Obsidian Markdown`
- `Format selection as course note`
- `Compress selection into review card`
- `Generate Wiki candidates`
- `Make selection concise`

## Development

```bash
npm install
npm run dev
npm run build
```

## Manual Test Install

1. Run `npm install` and `npm run build`.
2. Create this folder in a test vault: `<Vault>/.obsidian/plugins/obsidian-format-assistant/`.
3. Copy only these built plugin files into that folder:
   - `manifest.json`
   - `main.js`
   - `styles.css`
4. Open Obsidian settings, enable Community plugins, then enable `Format Assistant`.

This project is intentionally not installed into any vault automatically.

## API Configuration

Open the plugin settings and fill in:

- API Base URL, for example `https://api.openai.com/v1`
- API Key
- Model, for example `gpt-4o-mini`
- Max Tokens
- Temperature
- Provider Type: `OpenAI-compatible`
- System Prompt
- Preview before replace
- Timeout seconds

The API key is saved through Obsidian plugin settings. It is not hardcoded and is not printed to logs.

## Rollback Or Uninstall

To uninstall from a test vault, disable the plugin in Obsidian, then remove:

```text
<Vault>/.obsidian/plugins/obsidian-format-assistant/
```

No note content is changed unless you explicitly click `Replace selection` in the preview modal.
