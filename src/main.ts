import {
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	Plugin,
	WorkspaceLeaf
} from "obsidian";
import { applyApiProfile, type ApiProfile } from "./api-profiles";
import { callChatCompletions, type ChatResult } from "./api";
import { FORMAT_TASKS, type FormatMode } from "./prompts";
import { PreviewModal } from "./preview-modal";
import { FormatAssistantSettingTab } from "./settings";
import {
	normalizeSettings,
	type FormatAssistantSettings,
	validateApiSettings
} from "./settings-types";
import {
	FORMAT_ASSISTANT_VIEW_TYPE,
	FormatAssistantSidebarView
} from "./sidebar-view";
import { SelectionService } from "./selection-service";

export default class FormatAssistantPlugin extends Plugin {
	settings: FormatAssistantSettings;
	selectionService: SelectionService;

	async onload() {
		this.selectionService = new SelectionService(this.app);
		await this.loadSettings();

		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) => {
				this.rememberMarkdownInfo(editor, info);
				this.refreshSidebarContextViews();
			})
		);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.rememberMarkdownInfo(leaf.view.editor, leaf.view);
					this.refreshSidebarContextViews();
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					this.rememberMarkdownInfo(view.editor, view);
					this.refreshSidebarContextViews();
				}
			})
		);

		this.registerView(
			FORMAT_ASSISTANT_VIEW_TYPE,
			(leaf) => new FormatAssistantSidebarView(leaf, this)
		);

		this.addRibbonIcon("sparkles", "Format Assistant", () => {
			void this.openSidebar();
		});

		this.addCommand({
			id: "open-format-assistant-sidebar",
			name: "Open Format Assistant sidebar",
			callback: () => {
				void this.openSidebar();
			}
		});

		this.addCommand({
			id: "focus-format-assistant-input",
			name: "Focus Format Assistant input",
			callback: () => {
				void this.focusSidebarInput();
			}
		});

		this.addCommand({
			id: "send-selected-text-to-format-assistant",
			name: "Send selected text to Format Assistant",
			editorCallback: (editor, view) => {
				void this.sendSelectionToSidebar(editor, view instanceof MarkdownView ? view : null);
			}
		});

		for (const task of FORMAT_TASKS) {
			this.addCommand({
				id: task.id,
				name: task.name,
				editorCallback: (editor, view) => {
					void this.formatSelection(
						editor,
						view instanceof MarkdownView ? view : null,
						task.mode
					);
				}
			});
		}

		this.addSettingTab(new FormatAssistantSettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(FORMAT_ASSISTANT_VIEW_TYPE);
	}

	async loadSettings() {
		const raw = await this.migrateSecrets(await this.loadData());
		this.settings = normalizeSettings(raw);
		this.settings.apiKey = this.settings.apiKeyRef
			? this.app.secretStorage.getSecret(this.settings.apiKeyRef) ?? ""
			: "";
	}

	async saveSettings() {
		await this.saveData({ ...this.settings, apiKey: "" });
	}

	async applyApiProfile(profile: ApiProfile): Promise<void> {
		applyApiProfile(this.settings, profile);
		this.settings.apiKey = profile.apiKeyRef
			? this.app.secretStorage.getSecret(profile.apiKeyRef) ?? ""
			: "";
		await this.saveSettings();
		this.refreshSidebarViews();
		new Notice(`API profile switched: ${profile.name}`);
	}

	async setApiKey(value: string): Promise<void> {
		const ref = this.settings.apiKeyRef || `${this.manifest.id}-current-api-key`;
		this.app.secretStorage.setSecret(ref, value);
		this.settings.apiKeyRef = ref;
		this.settings.apiKey = value;
		await this.saveSettings();
	}

	async secureApiProfile(profile: ApiProfile): Promise<void> {
		const ref = `${this.manifest.id}-profile-${profile.id}`;
		this.app.secretStorage.setSecret(ref, this.settings.apiKey);
		profile.apiKeyRef = ref;
	}

	private async migrateSecrets(data: unknown): Promise<unknown> {
		const raw = data && typeof data === "object" ? structuredClone(data) as Record<string, unknown> : {};
		const legacyKey = typeof raw.apiKey === "string" ? raw.apiKey : "";
		let currentRef = typeof raw.apiKeyRef === "string" ? raw.apiKeyRef : "";
		if (legacyKey) {
			currentRef ||= `${this.manifest.id}-current-api-key`;
			this.app.secretStorage.setSecret(currentRef, legacyKey);
		}
		raw.apiKey = "";
		raw.apiKeyRef = currentRef;
		if (Array.isArray(raw.apiProfiles)) {
			raw.apiProfiles = raw.apiProfiles.map((item) => {
				if (!item || typeof item !== "object") return item;
				const profile = { ...item } as Record<string, unknown>;
				const id = typeof profile.id === "string" ? profile.id : crypto.randomUUID();
				const key = typeof profile.apiKey === "string" ? profile.apiKey : "";
				let ref = typeof profile.apiKeyRef === "string" ? profile.apiKeyRef : "";
				if (key) {
					ref ||= `${this.manifest.id}-profile-${id}`;
					this.app.secretStorage.setSecret(ref, key);
				}
				delete profile.apiKey;
				profile.apiKeyRef = ref;
				profile.omitTemperature ??= false;
				profile.useMaxCompletionTokens ??= false;
				profile.modeRuntime ??= structuredClone(raw.modeRuntime ?? {});
				return profile;
			});
		}
		await this.saveData(raw);
		return raw;
	}

	async openSidebar(): Promise<FormatAssistantSidebarView | null> {
		const leaves = this.app.workspace.getLeavesOfType(FORMAT_ASSISTANT_VIEW_TYPE);
		let leaf: WorkspaceLeaf | null = leaves.length > 0 ? leaves[0] : null;

		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false);
			await leaf?.setViewState({
				type: FORMAT_ASSISTANT_VIEW_TYPE,
				active: true
			});
		}

		if (!leaf) {
			new Notice("Could not open Format Assistant sidebar.");
			return null;
		}

		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view instanceof FormatAssistantSidebarView ? leaf.view : null;
		view?.refreshContextStatus();

		if (this.settings.autoUseSelectionOnSidebarOpen) {
			view?.useCurrentSelection(false);
		}

		return view;
	}

	async focusSidebarInput(): Promise<void> {
		const view = await this.openSidebar();
		view?.focusInput();
	}

	async sendSelectionToSidebar(editor: Editor, view: MarkdownView | null): Promise<void> {
		this.rememberMarkdownInfo(editor, view);
		const sidebar = await this.openSidebar();
		if (!sidebar) {
			return;
		}

		const selection = editor.getSelection();
		if (!selection.trim()) {
			new Notice("Please select text before sending it to Format Assistant.");
			return;
		}

		sidebar.setContextFromEditor(editor, view, true);
	}

	refreshSidebarViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(FORMAT_ASSISTANT_VIEW_TYPE)) {
			if (leaf.view instanceof FormatAssistantSidebarView) {
				leaf.view.render();
			}
		}
	}

	refreshSidebarContextViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(FORMAT_ASSISTANT_VIEW_TYPE)) {
			if (leaf.view instanceof FormatAssistantSidebarView) {
				leaf.view.refreshContextStatus();
			}
		}
	}

	getLastMarkdownInfo(): MarkdownFileInfo | null {
		return this.selectionService.getLastMarkdownInfo();
	}

	validateApiSettings(): string | null {
		return validateApiSettings(this.settings);
	}

	async generateFromSelection(
		mode: FormatMode,
		selectedText: string,
		customInstruction: string,
		currentFileName?: string,
		inputSource: "selection" | "manual" | "note" = "selection"
	): Promise<ChatResult> {
		const validationError = this.validateApiSettings();
		if (validationError) {
			throw new Error(validationError);
		}

		return callChatCompletions(this.settings, {
			mode,
			selectedText,
			inputSource,
			customInstruction,
			currentFileName: this.settings.includeCurrentFileNameInPrompt
				? currentFileName
				: undefined
		});
	}

	async testConnection(): Promise<void> {
		const validationError = this.validateApiSettings();
		if (validationError) {
			throw new Error(validationError);
		}

		await callChatCompletions(this.settings, {
			mode: "custom",
			selectedText: "Connection test. Reply with OK only.",
			customInstruction: "Reply with OK only."
		});
	}

	toUserError(error: unknown): string {
		if (error instanceof DOMException && error.name === "AbortError") {
			return `API request timed out after ${this.settings.timeoutSeconds}s. Try a shorter selection, lower max tokens, or increase Timeout to 60-90 seconds in settings.`;
		}

		if (error instanceof Error) {
			return error.message;
		}

		return "Formatting failed.";
	}

	private async formatSelection(
		editor: Editor,
		view: MarkdownView | null,
		mode: FormatMode
	) {
		this.rememberMarkdownInfo(editor, view);
		const selection = editor.getSelection();
		const selectionStart = editor.getCursor("from");
		const selectionEnd = editor.getCursor("to");

		if (!selection.trim()) {
			new Notice("Please select text before running Format Assistant.");
			return;
		}

		const validationError = this.validateApiSettings();
		if (validationError) {
			new Notice(validationError);
			return;
		}

		new Notice("Formatting selection...");

		try {
			const result = await this.generateFromSelection(
				mode,
				selection,
				"",
				view?.file?.basename
			);

			if (result.truncated) {
				new Notice("Output may be truncated (hit max tokens). Increase Max Tokens in settings.");
			}

			const ensureSameSelection = (): boolean => {
				if (editor.getRange(selectionStart, selectionEnd) !== selection) {
					new Notice("Selection changed. Please select the text again.");
					return false;
				}
				return true;
			};

			new PreviewModal(this.app, {
				originalText: selection,
				resultText: result.content,
				showOriginal: this.settings.previewBeforeReplace,
				// Reformatting modes default to Replace; Insert below is offered too.
				primaryAction: "replace",
				onReplace: () => {
					if (!ensureSameSelection()) {
						return;
					}
					editor.replaceRange(result.content, selectionStart, selectionEnd);
					new Notice("Selection replaced.");
				},
				onInsertBelow: () => {
					if (!ensureSameSelection()) {
						return;
					}
					editor.replaceRange(`\n\n${result.content}`, selectionEnd);
					new Notice("Result inserted below selection.");
				}
			}).open();
		} catch (error) {
			new Notice(this.toUserError(error));
		}
	}

	private rememberMarkdownInfo(editor: Editor, info: MarkdownFileInfo | null): void {
		this.selectionService.rememberMarkdownInfo(editor, info);
	}
}
