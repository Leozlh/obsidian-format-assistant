import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type FormatAssistantPlugin from "./main";
import {
	createApiProfileFromSettings,
	MAX_API_PROFILES
} from "./api-profiles";
import {
	DEFAULT_SYSTEM_PROMPT,
	type ProviderType
} from "./settings-types";

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
			.setDesc("When enabled, show a reminder that only the active note can be used as fallback. The plugin never scans the vault.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeFullCurrentNote)
					.onChange(async (value) => {
						this.plugin.settings.includeFullCurrentNote = value;
						await this.plugin.saveSettings();
						if (value) {
							new Notice("Current note fallback only uses the active note. The vault is never scanned.");
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
