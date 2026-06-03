import {
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	Plugin,
	WorkspaceLeaf
} from "obsidian";
import { applyApiProfile, type ApiProfile } from "./api-profiles";
import { callChatCompletions } from "./api";
import { FORMAT_TASKS, type FormatMode } from "./prompts";
import { PreviewModal } from "./preview-modal";
import {
	FormatAssistantSettingTab,
	normalizeSettings,
	type FormatAssistantSettings,
	validateApiSettings
} from "./settings";
import {
	FORMAT_ASSISTANT_VIEW_TYPE,
	FormatAssistantSidebarView
} from "./sidebar-view";

export default class FormatAssistantPlugin extends Plugin {
	settings: FormatAssistantSettings;
	private lastMarkdownInfo: MarkdownFileInfo | null = null;

	async onload() {
		await this.loadSettings();

		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) => {
				this.rememberMarkdownInfo(editor, info);
				this.refreshSidebarViews();
			})
		);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.rememberMarkdownInfo(leaf.view.editor, leaf.view);
					this.refreshSidebarViews();
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					this.rememberMarkdownInfo(view.editor, view);
					this.refreshSidebarViews();
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
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async applyApiProfile(profile: ApiProfile): Promise<void> {
		applyApiProfile(this.settings, profile);
		await this.saveSettings();
		this.refreshSidebarViews();
		new Notice(`API profile switched: ${profile.name}`);
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

	getLastMarkdownInfo(): MarkdownFileInfo | null {
		return this.lastMarkdownInfo;
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
	): Promise<string> {
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
			new PreviewModal(this.app, {
				originalText: selection,
				resultText: result,
				showOriginal: this.settings.previewBeforeReplace,
				onReplace: () => {
					const currentRange = editor.getRange(selectionStart, selectionEnd);
					if (currentRange !== selection) {
						new Notice("Selection changed. Please select the text again.");
						return;
					}

					editor.replaceRange(result, selectionStart, selectionEnd);
					new Notice("Selection replaced.");
				}
			}).open();
		} catch (error) {
			new Notice(this.toUserError(error));
		}
	}

	private rememberMarkdownInfo(editor: Editor, info: MarkdownFileInfo | null): void {
		if (!info?.file) {
			return;
		}

		this.lastMarkdownInfo = {
			...info,
			editor
		};
	}
}
