import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type FormatAssistantPlugin from "./main";
import {
	createApiProfileFromSettings,
	MAX_API_PROFILES,
	normalizeApiProfiles,
	type ApiProfile
} from "./api-profiles";
import type { FormatMode } from "./prompts";
import { normalizePromptPresets, type PromptPreset } from "./sidebar-presets";

export type ProviderType = "openai-compatible";

export interface FormatAssistantSettings {
	baseUrl: string;
	apiKey: string;
	model: string;
	maxTokens: number;
	temperature: number;
	providerType: ProviderType;
	systemPrompt: string;
	previewBeforeReplace: boolean;
	timeoutSeconds: number;
	sidebarDefaultMode: FormatMode;
	autoUseSelectionOnSidebarOpen: boolean;
	includeCurrentFileNameInPrompt: boolean;
	includeFullCurrentNote: boolean;
	promptPresets: PromptPreset[];
	apiProfiles: ApiProfile[];
	activeApiProfileId: string;
}

export const DEFAULT_SYSTEM_PROMPT = `你是一个 Obsidian 笔记整理助手。你的任务是把用户提供的原始文本整理成清晰、可复习、可继续编辑的 Obsidian Markdown。

基本原则：
1. 只整理，不臆造。
2. 保留原文含义、事实、公式、判断和逻辑顺序。
3. 不补充输入中没有出现的结论、例子、参考文献、背景信息或推导。
4. 不根据文件名、上下文或常识擅自补标题、日期、标签、frontmatter。
5. 不输出任何 frontmatter。
6. 不输出 bash、shell、终端命令。
7. 不用 \`\`\` 或 \`\`\`markdown 代码块包裹整体输出。
8. 不写前言、说明、总结或客套话。
9. 输出的第一个字符就是整理后正文的第一个字符。

输出要求：
1. 输出必须是 Obsidian 兼容 Markdown。
2. 可以使用标题、列表、表格、LaTeX 公式、Obsidian wikilink、callout、行内代码。
3. 不要生成无来源的 wikilink；只有输入中已经明确出现链接对象时，才可以保留或整理成 wikilink。
4. 不要把普通正文强行改成表格；只有并列比较、参数列表、公式总表、条件对照明显合适时才用表格。
5. 如果表格里会放复杂公式、Dirac 记号或大量竖线，优先改用列表，避免破坏公式渲染。
6. 保持中文表达自然、克制、可读，不要 AI 腔。

整理策略：
1. 如果输入很短，只做轻量整理：去重、断句、分段、必要时加很小的标题层级；不要扩写成完整模板。
2. 如果输入是课程知识点、讲义解析、论文阅读内容或公式说明，优先整理成适合复习的结构。
3. 只有当原文已经具备明显层次时，才升级为多层标题。
4. 如果原文是连续分析，优先保留其主线，不要打散成过多碎片。
5. 如果原文包含核心逻辑、推导、定义、应用、易错点、复习建议等内容，可以整理成模块，但必须以原文已有信息为基础。
6. 如果原文中有行动项、检查项或待办，保留为 \`- [ ]\`，但不要把纯叙述句误改成任务。
7. 不要自动添加“参考文献”“总结”“思考题”“扩展阅读”等输入中没有的板块。

推荐结构按需使用，不强制全套：
- 核心问题 / 本节主线
- 基本定义
- 关键公式
- 物理图像 / 直观理解
- 推导步骤
- 条件与适用范围
- 例子 / 应用
- 易错点
- 复习抓手

公式与技术内容：
1. 保留原公式，不随意改写符号。
2. 若原文公式零散，可整理为“公式 + 含义”的形式。
3. 若原文已有推导顺序，优先保留推导链条。
4. 不把复杂公式强行压成一句话。
5. 对变量、参数、条件可用短列表补清楚。
6. 输入里有中英文混排术语时，保留常用写法，不强行统一风格。

优先级：
先保留原意，再提升清晰度，最后才考虑美化结构。
只输出最终 Markdown。`;

export const DEFAULT_SETTINGS: FormatAssistantSettings = {
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "gpt-4o-mini",
	maxTokens: 1200,
	temperature: 0.2,
	providerType: "openai-compatible",
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	previewBeforeReplace: true,
	timeoutSeconds: 30,
	sidebarDefaultMode: "obsidian-markdown",
	autoUseSelectionOnSidebarOpen: false,
	includeCurrentFileNameInPrompt: true,
	includeFullCurrentNote: false,
	promptPresets: [],
	apiProfiles: [],
	activeApiProfileId: ""
};

export function normalizeSettings(data: unknown): FormatAssistantSettings {
	const raw = typeof data === "object" && data !== null
		? data as Partial<FormatAssistantSettings>
		: {};

	return {
		...DEFAULT_SETTINGS,
		...raw,
		promptPresets: normalizePromptPresets(raw.promptPresets),
		apiProfiles: normalizeApiProfiles(raw.apiProfiles),
		activeApiProfileId: typeof raw.activeApiProfileId === "string"
			? raw.activeApiProfileId
			: ""
	};
}

export function validateApiSettings(settings: FormatAssistantSettings): string | null {
	if (!settings.baseUrl.trim()) {
		return "API Base URL is required.";
	}

	if (settings.baseUrl.replace(/\/+$/, "").endsWith("/chat/completions")) {
		return "Base URL should not include /chat/completions. Use the API root such as https://example.com/v1.";
	}

	if (!settings.apiKey.trim()) {
		return "API key is required.";
	}

	if (!settings.model.trim()) {
		return "Model is required.";
	}

	if (settings.maxTokens < 1) {
		return "Max Tokens must be greater than 0.";
	}

	if (settings.timeoutSeconds < 1) {
		return "Timeout seconds must be greater than 0.";
	}

	return null;
}

export class FormatAssistantSettingTab extends PluginSettingTab {
	plugin: FormatAssistantPlugin;

	constructor(app: App, plugin: FormatAssistantPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Format Assistant" });
		this.displayApiProfiles(containerEl);

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
						this.plugin.refreshSidebarViews();
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
				text.inputEl.addClass("format-assistant-system-prompt-input");
				text
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					});
			})
			.addButton((button) =>
				button
					.setButtonText("Reset to default")
					.onClick(async () => {
						this.plugin.settings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
						await this.plugin.saveSettings();
						const input = containerEl.querySelector<HTMLTextAreaElement>(
							".format-assistant-system-prompt-input"
						);
						if (input) {
							input.value = DEFAULT_SYSTEM_PROMPT;
						}
						new Notice("System prompt reset to default.");
					})
			);

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
			.setName("Auto use selection on sidebar open")
			.setDesc("When enabled, the sidebar reads the current editor selection as temporary context when opened.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoUseSelectionOnSidebarOpen)
					.onChange(async (value) => {
						this.plugin.settings.autoUseSelectionOnSidebarOpen = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Include current file name in prompt")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeCurrentFileNameInPrompt)
					.onChange(async (value) => {
						this.plugin.settings.includeCurrentFileNameInPrompt = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Include full current note")
			.setDesc("Not yet implemented. Currently only the captured selection is sent.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeFullCurrentNote)
					.onChange(async (value) => {
						this.plugin.settings.includeFullCurrentNote = value;
						await this.plugin.saveSettings();
						if (value) {
							new Notice("Full-note context is not implemented yet. Only the captured selection will be sent.");
						}
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
			text: "Format Assistant only sends selected text for the command or sidebar action you run. It does not scan your vault or batch-edit notes."
		});
	}

	private displayApiProfiles(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "API Profiles" });

		new Setting(containerEl)
			.setName("Active API profile")
			.setDesc("Switch between saved API settings. API keys are stored in Obsidian plugin data with the profile settings and never logged.")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "Manual current settings");
				for (const profile of this.plugin.settings.apiProfiles) {
					dropdown.addOption(profile.id, profile.name);
				}

				dropdown
					.setValue(this.plugin.settings.activeApiProfileId)
					.onChange(async (value) => {
						if (!value) {
							this.plugin.settings.activeApiProfileId = "";
							await this.plugin.saveSettings();
							this.plugin.refreshSidebarViews();
							return;
						}

						const profile = this.plugin.settings.apiProfiles.find((item) => item.id === value);
						if (!profile) {
							new Notice("API profile not found.");
							return;
						}

						await this.plugin.applyApiProfile(profile);
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Save current API settings")
			.setDesc(`${this.plugin.settings.apiProfiles.length}/${MAX_API_PROFILES} saved profiles. API keys are stored in Obsidian plugin data with the profile settings.`)
			.addText((text) => {
				text.setPlaceholder("Profile name");
				text.inputEl.addClass("format-assistant-profile-name-input");
			})
			.addButton((button) =>
				button
					.setButtonText("Save")
					.onClick(async () => {
						const input = containerEl.querySelector<HTMLInputElement>(
							".format-assistant-profile-name-input"
						);
						const profileName = input?.value ?? "";

						if (this.plugin.settings.apiProfiles.length >= MAX_API_PROFILES) {
							new Notice(`API profiles are limited to ${MAX_API_PROFILES}.`);
							return;
						}

						const profile = createApiProfileFromSettings(
							this.plugin.settings,
							profileName
						);
						this.plugin.settings.apiProfiles = [
							...this.plugin.settings.apiProfiles,
							profile
						];
						this.plugin.settings.activeApiProfileId = profile.id;
						await this.plugin.saveSettings();
						this.plugin.refreshSidebarViews();
						new Notice("API profile saved.");
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Remove active API profile")
			.setDesc("Removes the saved profile only. Current API fields stay unchanged.")
			.addButton((button) =>
				button
					.setButtonText("Remove")
					.setDisabled(!this.plugin.settings.activeApiProfileId)
					.onClick(async () => {
						const id = this.plugin.settings.activeApiProfileId;
						if (!id) {
							return;
						}

						this.plugin.settings.apiProfiles = this.plugin.settings.apiProfiles.filter(
							(profile) => profile.id !== id
						);
						this.plugin.settings.activeApiProfileId = "";
						await this.plugin.saveSettings();
						this.plugin.refreshSidebarViews();
						new Notice("API profile removed.");
						this.display();
					})
			);
	}

	private toNumber(value: string, fallback: number, min: number): number {
		const parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed < min) {
			return fallback;
		}

		return parsed;
	}
}
