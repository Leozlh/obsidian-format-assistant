# Obsidian Format Assistant

A lightweight, user-controlled Obsidian plugin that reformats selected text with your own OpenAI-compatible Chat Completions API.

It does **not** scan your vault and does **not** batch-edit notes. It only ever touches the text you act on, and it never writes to a note until you confirm.

## Modes

The sidebar offers three formatting modes:

- **Obsidian Markdown** — light cleanup: tidy layout only, no restructuring.
- **Note Organize** — structured study notes: extract concepts / formulas / pitfalls, may add headings.
- **Diary Organize** — keep the original tone, preserve the time-of-day timeline, and turn actionable items into `- [ ]` tasks (records stay plain text; nothing is auto-marked done).

## Sidebar workflow

1. Open the right-side **Format Assistant** panel (ribbon icon or the *Open Format Assistant sidebar* command).
2. Pick a **Mode**.
3. Fill the single editable **Input** box:
   - click **Use selection** to pull the current editor selection in (you can then edit it), or
   - just type / paste text directly (the manual path), or
   - leave it empty and tick **Use the whole note when nothing is selected** so Generate falls back to the note body (skips frontmatter and the leading `# ` heading).
4. Optionally add a one-off **Instruction** (recently used ones are offered in a quick-pick).
5. Click **Generate** (or press **Cmd/Ctrl+Enter** in the Input box). The result is **editable** before you act on it.
6. **Copy**, **Replace selection**, **Insert below selection**, or **→ Input** (move the result back into the Input box for another pass). Replace / Insert are available only when the Input still equals an **unedited captured selection**, and refuse if that selection or its file changed.

## Commands (palette)

Quick one-shot actions on the current selection (shown in a preview modal with Replace / Insert below / Copy):

- `Format selection as Obsidian Markdown`
- `Organize selection as note`
- `Organize selection as diary`

Plus: `Open Format Assistant sidebar`, `Focus Format Assistant input`, `Send selected text to Format Assistant`.

## API configuration

Open the plugin settings and fill in:

- **API Base URL** — the API root, e.g. `https://api.openai.com/v1` (do **not** include `/chat/completions`)
- **API Key** — stored in Obsidian SecretStorage; plugin data and profiles keep references only
- **Model** — e.g. `gpt-4o-mini`
- **Max Tokens** / **Temperature** / **Timeout seconds**
- **Provider Type**: `OpenAI-compatible`
- **System Prompt** (with *Reset to default*)
- **Omit temperature** / **Use max_completion_tokens** — compatibility toggles for stricter providers (e.g. OpenAI o-series)
- Behaviour toggles: *Preview before replace*, *Auto use selection on sidebar open*, *Include current file name in prompt*, *Allow current note fallback*
- **API Profiles** — save/switch between multiple API configurations

Per-mode runtime: Note Organize uses a larger token budget / longer timeout; Diary Organize uses a smaller one; other modes fall back to the global settings. If a response is cut off (`finish_reason: length`), the plugin warns that the output may be truncated.

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # type-check + production build
npm test         # run unit tests (vitest)
npm run verify   # test + build
```

## Manual install into a vault

1. `npm install` then `npm run build`.
2. Create `<Vault>/.obsidian/plugins/obsidian-format-assistant/`.
3. Copy only the built files into it:
   - `manifest.json`
   - `main.js`
   - `styles.css`
4. In Obsidian: enable Community plugins, then enable **Format Assistant**.

(Your `data.json` settings live in that folder too and are never tracked by this repo.)

## Rollback / uninstall

Disable the plugin in Obsidian, then remove:

```text
<Vault>/.obsidian/plugins/obsidian-format-assistant/
```

No note content changes unless you explicitly click **Replace selection** / **Insert below selection** (sidebar) or confirm in the preview modal (commands).
