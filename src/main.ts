import {
	App,
	Editor,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting
} from "obsidian";

type ProviderType = "openai-compatible";

interface FormatAssistantSettings {
	baseUrl: string;
	apiKey: string;
	model: string;
	maxTokens: number;
	temperature: number;
	providerType: ProviderType;
	systemPrompt: string;
	previewBeforeReplace: boolean;
	timeoutSeconds: number;
}

interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
	error?: {
		message?: string;
		type?: string;
	};
}

interface FormatTask {
	id: string;
	name: string;
	taskPrompt: string;
}

const DEFAULT_SYSTEM_PROMPT = `你是 Obsidian Markdown 笔记整理助手。
规则：
1. 只输出整理后的 Markdown。
2. 不输出 bash、shell、终端命令。
3. 不解释过程。
4. 不输出长篇背景。
5. 保留原文含义，不乱扩写。
6. 保持 Obsidian wikilink、tag、callout、frontmatter 兼容。
7. 公式在 Markdown 中使用 $...$ 或 $$...$$。
8. 默认中文输出。
9. 如果输入内容明显不足，只做格式整理，不补造内容。`;

const DEFAULT_SETTINGS: FormatAssistantSettings = {
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "gpt-4o-mini",
	maxTokens: 1200,
	temperature: 0.2,
	providerType: "openai-compatible",
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	previewBeforeReplace: true,
	timeoutSeconds: 30
};

const FORMAT_TASKS: FormatTask[] = [
	{
		id: "format-selection-as-obsidian-markdown",
		name: "Format selection as Obsidian Markdown",
		taskPrompt:
			"请将输入文本整理为清晰、规范、适合 Obsidian 的 Markdown。保留原意、公式、条件、wikilink、tag、callout 和 frontmatter。"
	},
	{
		id: "format-selection-as-course-note",
		name: "Format selection as course note",
		taskPrompt: `请将输入文本整理为课程笔记，严格使用以下 Markdown 结构：
## 核心概念
## 公式与条件
## 典型题入口
## 易错点
## 待追问问题`
	},
	{
		id: "compress-selection-into-review-card",
		name: "Compress selection into review card",
		taskPrompt: `请将输入文本压缩为 Obsidian callout 复习卡片，严格使用以下结构：
> [!summary] 复习卡片
> - 核心结论：
> - 适用条件：
> - 典型题型：
> - 易错点：`
	},
	{
		id: "generate-wiki-candidates",
		name: "Generate Wiki candidates",
		taskPrompt: `请根据输入文本生成最多 10 条 Wiki 候选条目，严格输出 Markdown 表格：
| 类型 | 候选标题 | 来源依据 | 为什么值得沉淀 |
|---|---|---|---|

类型只能从以下选项中选择：
Concept, Formula, Method, Theorem, Problem, Comparison, Open Question`
	},
	{
		id: "make-selection-concise",
		name: "Make selection concise",
		taskPrompt:
			"请将输入文本精简为更短、更清楚的 Markdown，不丢失核心公式、适用条件、定义、限制和关键结论。"
	}
];

export default class FormatAssistantPlugin extends Plugin {
	settings: FormatAssistantSettings;

	async onload() {
		await this.loadSettings();

		for (const task of FORMAT_TASKS) {
			this.addCommand({
				id: task.id,
				name: task.name,
				editorCallback: (editor) => {
					void this.formatSelection(editor, task);
				}
			});
		}

		this.addSettingTab(new FormatAssistantSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async formatSelection(editor: Editor, task: FormatTask) {
		const selection = editor.getSelection();
		const selectionStart = editor.getCursor("from");
		const selectionEnd = editor.getCursor("to");

		if (!selection.trim()) {
			new Notice("Please select text before running Format Assistant.");
			return;
		}

		const validationError = this.validateSettings();
		if (validationError) {
			new Notice(validationError);
			return;
		}

		new Notice("Formatting selection...");

		try {
			const result = await this.callChatCompletions(task.taskPrompt, selection);
			new PreviewModal(this.app, {
				originalText: selection,
				resultText: result,
				showOriginal: this.settings.previewBeforeReplace,
				onReplace: () => {
					editor.replaceRange(result, selectionStart, selectionEnd);
					new Notice("Selection replaced.");
				}
			}).open();
		} catch (error) {
			new Notice(this.toUserError(error));
		}
	}

	private validateSettings(): string | null {
		if (!this.settings.baseUrl.trim()) {
			return "API Base URL is required.";
		}

		if (!this.settings.apiKey.trim()) {
			return "API key is required.";
		}

		if (!this.settings.model.trim()) {
			return "Model is required.";
		}

		if (this.settings.maxTokens < 1) {
			return "Max Tokens must be greater than 0.";
		}

		if (this.settings.timeoutSeconds < 1) {
			return "Timeout seconds must be greater than 0.";
		}

		return null;
	}

	async testConnection(): Promise<void> {
		const validationError = this.validateSettings();
		if (validationError) {
			throw new Error(validationError);
		}

		await this.callChatCompletions(
			"请只回复：OK",
			"连接测试。请只回复 OK。"
		);
	}

	private async callChatCompletions(taskPrompt: string, selection: string): Promise<string> {
		const controller = new AbortController();
		const timeout = window.setTimeout(
			() => controller.abort(),
			this.settings.timeoutSeconds * 1000
		);

		try {
			const response = await fetch(this.chatCompletionsUrl(), {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.settings.apiKey}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					model: this.settings.model,
					messages: [
						{
							role: "system",
							content: this.settings.systemPrompt
						},
						{
							role: "user",
							content: `${taskPrompt}\n\n输入文本：\n${selection}`
						}
					],
					temperature: this.settings.temperature,
					max_tokens: this.settings.maxTokens
				}),
				signal: controller.signal
			});

			const text = await response.text();
			const data = this.parseJsonResponse(text);

			if (!response.ok) {
				throw new Error(this.statusToMessage(response.status, data));
			}

			const content = data.choices?.[0]?.message?.content;
			if (!content || typeof content !== "string") {
				throw new Error("API returned an unexpected response format.");
			}

			return content.trim();
		} finally {
			window.clearTimeout(timeout);
		}
	}

	private chatCompletionsUrl(): string {
		return `${this.settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	}

	private parseJsonResponse(text: string): ChatCompletionResponse {
		if (!text.trim()) {
			return {};
		}

		try {
			return JSON.parse(text) as ChatCompletionResponse;
		} catch {
			throw new Error("API returned invalid JSON.");
		}
	}

	private statusToMessage(status: number, data: ChatCompletionResponse): string {
		const apiMessage = data.error?.message;

		if (status === 401 || status === 403) {
			return "API authentication failed. Check your API key and access permissions.";
		}

		if (status === 429) {
			return "API rate limit reached. Please wait and try again.";
		}

		if (status >= 500) {
			return "API server error. Please try again later.";
		}

		return apiMessage
			? `API request failed: ${apiMessage}`
			: `API request failed with status ${status}.`;
	}

	toUserError(error: unknown): string {
		if (error instanceof DOMException && error.name === "AbortError") {
			return "API request timed out.";
		}

		if (error instanceof Error) {
			return error.message;
		}

		return "Formatting failed.";
	}
}

class PreviewModal extends Modal {
	private originalText: string;
	private resultText: string;
	private showOriginal: boolean;
	private onReplace: () => void;

	constructor(
		app: App,
		options: {
			originalText: string;
			resultText: string;
			showOriginal: boolean;
			onReplace: () => void;
		}
	) {
		super(app);
		this.originalText = options.originalText;
		this.resultText = options.resultText;
		this.showOriginal = options.showOriginal;
		this.onReplace = options.onReplace;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("format-assistant-preview");

		contentEl.createEl("h2", { text: "Preview formatted Markdown" });

		const grid = contentEl.createDiv({ cls: "format-assistant-preview__grid" });

		if (this.showOriginal) {
			this.createTextPane(grid, "Original selection", this.originalText);
		}

		this.createTextPane(grid, "Formatted result", this.resultText);

		const actions = contentEl.createDiv({ cls: "format-assistant-preview__actions" });

		const replaceButton = actions.createEl("button", {
			text: "Replace selection",
			cls: "mod-cta"
		});
		replaceButton.addEventListener("click", () => {
			this.onReplace();
			this.close();
		});

		const copyButton = actions.createEl("button", { text: "Copy result" });
		copyButton.addEventListener("click", async () => {
			await navigator.clipboard.writeText(this.resultText);
			new Notice("Result copied.");
		});

		const cancelButton = actions.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}

	private createTextPane(parent: HTMLElement, title: string, text: string) {
		const pane = parent.createDiv({ cls: "format-assistant-preview__pane" });
		pane.createEl("h3", { text: title });
		pane.createDiv({
			cls: "format-assistant-preview__text",
			text
		});
	}
}

class FormatAssistantSettingTab extends PluginSettingTab {
	plugin: FormatAssistantPlugin;

	constructor(app: App, plugin: FormatAssistantPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Format Assistant" });

		new Setting(containerEl)
			.setName("API Base URL")
			.setDesc("OpenAI-compatible API base URL, without /chat/completions.")
			.addText((text) =>
				text
					.setPlaceholder("https://api.openai.com/v1")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API Key")
			.setDesc("Stored in Obsidian plugin data. The plugin never logs this value.")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Example: gpt-4o-mini.")
			.addText((text) =>
				text
					.setPlaceholder("gpt-4o-mini")
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max Tokens")
			.addText((text) =>
				text
					.setPlaceholder("1200")
					.setValue(String(this.plugin.settings.maxTokens))
					.onChange(async (value) => {
						this.plugin.settings.maxTokens = this.toNumber(value, 1200, 1);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Temperature")
			.addSlider((slider) =>
				slider
					.setLimits(0, 2, 0.1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.temperature)
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Provider Type")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("openai-compatible", "OpenAI-compatible")
					.setValue(this.plugin.settings.providerType)
					.onChange(async (value: ProviderType) => {
						this.plugin.settings.providerType = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("System Prompt")
			.setDesc("Global rules sent with each formatting request.")
			.addTextArea((text) => {
				text.inputEl.rows = 12;
				text.inputEl.cols = 60;
				text
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Preview before replace")
			.setDesc("When enabled, the preview shows both original and formatted text. Replacement still always requires confirmation.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.previewBeforeReplace)
					.onChange(async (value) => {
						this.plugin.settings.previewBeforeReplace = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Timeout seconds")
			.addText((text) =>
				text
					.setPlaceholder("30")
					.setValue(String(this.plugin.settings.timeoutSeconds))
					.onChange(async (value) => {
						this.plugin.settings.timeoutSeconds = this.toNumber(value, 30, 1);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Test API connection")
			.setDesc("Sends a minimal chat completion request using the current settings.")
			.addButton((button) =>
				button
					.setButtonText("Test")
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText("Testing...");

						try {
							await this.plugin.testConnection();
							new Notice("API connection succeeded.");
						} catch (error) {
							new Notice(this.plugin.toUserError(error));
						} finally {
							button.setDisabled(false);
							button.setButtonText("Test");
						}
					})
			);

		containerEl.createDiv({
			cls: "format-assistant-setting-warning",
			text: "Format Assistant only sends the selected text for the command you run. It does not scan your vault or batch-edit notes."
		});
	}

	private toNumber(value: string, fallback: number, min: number): number {
		const parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed < min) {
			return fallback;
		}

		return parsed;
	}
}
