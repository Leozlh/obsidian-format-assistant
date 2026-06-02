import {
	Editor,
	EditorPosition,
	ItemView,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	WorkspaceLeaf
} from "obsidian";
import type FormatAssistantPlugin from "./main";
import {
	FORMAT_MODE_LABELS,
	FORMAT_MODES,
	type FormatMode
} from "./prompts";
import { ConfirmModal } from "./preview-modal";
import {
	describeSelection,
	getActiveSelectionPreview,
	type ActiveSelectionPreview
} from "./sidebar-context";
import {
	createPromptPreset,
	MAX_PROMPT_PRESETS
} from "./sidebar-presets";

export const FORMAT_ASSISTANT_VIEW_TYPE = "format-assistant-sidebar";

interface SelectionContext {
	text: string;
	filePath: string | null;
	fileName: string | null;
	from: EditorPosition;
	to: EditorPosition;
}

export class FormatAssistantSidebarView extends ItemView {
	private plugin: FormatAssistantPlugin;
	private mode: FormatMode;
	private customInstruction = "";
	private currentSelection: ActiveSelectionPreview | null = null;
	private selectionContext: SelectionContext | null = null;
	private outputText = "";
	private statusText = "";
	private errorText = "";
	private loading = false;
	private customInputEl: HTMLTextAreaElement | null = null;
	private selectedPresetId = "";

	constructor(leaf: WorkspaceLeaf, plugin: FormatAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.mode = plugin.settings.sidebarDefaultMode;
	}

	getViewType(): string {
		return FORMAT_ASSISTANT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Format Assistant";
	}

	getIcon(): string {
		return "sparkles";
	}

	async onOpen() {
		this.captureCurrentSelection(false);
		this.render();
		this.refreshContextStatus();
		if (this.plugin.settings.autoUseSelectionOnSidebarOpen) {
			this.useCurrentSelection(false);
		}
	}

	async onClose() {
		this.contentEl.empty();
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("format-assistant-sidebar");

		this.renderHeader(root);
		this.renderContextPreview(root);
		this.renderModeSelector(root);
		this.renderInput(root);
		this.renderPromptPresets(root);
		this.renderSelectionControls(root);
		this.renderActions(root);
		this.renderOutput(root);
		this.renderStatus(root);
	}

	refreshContextStatus(): void {
		const view = this.getActiveMarkdownView();
		const selection = view?.editor.getSelection() ?? "";
		const activeName = view?.file?.basename ?? "No active Markdown file";

		if (!this.selectionContext) {
			this.statusText = selection.trim()
				? `Active file: ${activeName}. Current editor has a selection.`
				: `Active file: ${activeName}. No selection captured.`;
		}

		this.render();
	}

	focusInput(): void {
		this.customInputEl?.focus();
	}

	useCurrentSelection(showNotice = true): void {
		if (!this.captureCurrentSelection(showNotice)) {
			return;
		}

		if (showNotice) {
			new Notice("Selection sent to Format Assistant.");
		}
	}

	setContextFromEditor(editor: Editor, view: MarkdownView | null, showNotice: boolean): void {
		const selectedText = editor.getSelection();
		this.currentSelection = getActiveSelectionPreview(view ?? this.app.workspace.activeEditor);
		if (!selectedText.trim()) {
			this.setError("Please select text first.");
			if (showNotice) {
				new Notice("Please select text first.");
			}
			return;
		}

		this.selectionContext = {
			text: selectedText,
			filePath: view?.file?.path ?? null,
			fileName: view?.file?.basename ?? null,
			from: editor.getCursor("from"),
			to: editor.getCursor("to")
		};
		this.errorText = "";
		this.statusText = `Captured ${this.describeText(selectedText)}.`;
		this.render();

		if (showNotice) {
			new Notice("Selection sent to Format Assistant.");
		}
	}

	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "format-assistant-header" });
		const titleBlock = header.createDiv();
		titleBlock.createEl("h2", { text: "Format Assistant" });
		titleBlock.createDiv({
			cls: "format-assistant-model",
			text: this.plugin.settings.model || "No model configured"
		});

		const settingsButton = header.createEl("button", {
			text: "Open settings",
			cls: "format-assistant-small-button"
		});
		settingsButton.addEventListener("click", () => this.openSettings());
	}

	private renderContextPreview(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel" });
		const header = panel.createDiv({ cls: "format-assistant-section-header" });
		header.createEl("h3", { text: "Context Preview" });
		const preview = this.currentSelection ?? getActiveSelectionPreview(this.getActiveMarkdownInfo());
		header.createSpan({
			cls: "format-assistant-muted",
			text: `当前选区：${preview.characterCount} chars / ${preview.wordCount} words`
		});

		panel.createDiv({
			cls: "format-assistant-muted",
			text: "打开侧栏后请点击 Use current selection 或 Refresh selection 捕获最新选区。"
		});

		if (!preview.text.trim()) {
			panel.createDiv({
				cls: "format-assistant-empty format-assistant-context-preview",
				text: "请先选择文本"
			});
			return;
		}

		panel.createEl("pre", {
			cls: "format-assistant-context-preview",
			text: preview.text
		});
	}

	private renderModeSelector(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel" });
		panel.createEl("h3", { text: "Mode" });

		const select = panel.createEl("select", { cls: "format-assistant-select" });
		for (const mode of FORMAT_MODES) {
			const option = select.createEl("option", {
				text: FORMAT_MODE_LABELS[mode],
				value: mode
			});
			option.selected = mode === this.mode;
		}

		select.addEventListener("change", () => {
			this.mode = select.value as FormatMode;
			this.statusText = `Mode set to ${FORMAT_MODE_LABELS[this.mode]}.`;
			this.render();
		});
	}

	private renderInput(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel" });
		panel.createEl("h3", { text: "Instruction" });

		this.customInputEl = panel.createEl("textarea", {
			cls: "format-assistant-textarea",
			attr: {
				placeholder: "输入你希望如何整理当前选中文本，例如：整理为更清楚的课程笔记，不要扩写。"
			}
		});
		this.customInputEl.value = this.customInstruction;
		this.customInputEl.addEventListener("input", () => {
			this.customInstruction = this.customInputEl?.value ?? "";
		});
	}

	private renderPromptPresets(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel" });
		const header = panel.createDiv({ cls: "format-assistant-section-header" });
		header.createEl("h3", { text: "Prompt Presets" });
		header.createSpan({
			cls: "format-assistant-muted",
			text: `${this.plugin.settings.promptPresets.length}/${MAX_PROMPT_PRESETS}`
		});

		const select = panel.createEl("select", { cls: "format-assistant-select" });
		select.createEl("option", {
			text: this.plugin.settings.promptPresets.length ? "Select a preset" : "No presets saved",
			value: ""
		});

		for (const preset of this.plugin.settings.promptPresets) {
			const option = select.createEl("option", {
				text: preset.name,
				value: preset.id
			});
			option.title = preset.content;
			option.selected = preset.id === this.selectedPresetId;
		}

		select.addEventListener("change", () => {
			this.selectedPresetId = select.value;
		});

		const buttons = panel.createDiv({ cls: "format-assistant-button-row format-assistant-button-row--compact" });

		const addButton = buttons.createEl("button", { text: "Add current input as preset" });
		addButton.addEventListener("click", () => {
			void this.addCurrentInputAsPreset();
		});

		const selectButton = buttons.createEl("button", { text: "Select preset" });
		selectButton.disabled = !this.plugin.settings.promptPresets.length;
		selectButton.addEventListener("click", () => this.applySelectedPreset());

		const removeButton = buttons.createEl("button", { text: "Remove preset" });
		removeButton.disabled = !this.plugin.settings.promptPresets.length;
		removeButton.addEventListener("click", () => {
			void this.removeSelectedPreset();
		});
	}

	private renderSelectionControls(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-action-group" });
		panel.createEl("h3", { text: "Selection" });
		const buttons = panel.createDiv({ cls: "format-assistant-button-row format-assistant-button-row--compact" });

		const useButton = buttons.createEl("button", { text: "Use selection" });
		useButton.addEventListener("click", () => this.useCurrentSelection(true));

		const refreshButton = buttons.createEl("button", { text: "Refresh" });
		refreshButton.addEventListener("click", () => this.useCurrentSelection(true));

		const clearButton = buttons.createEl("button", { text: "Clear" });
		clearButton.addEventListener("click", () => {
			this.currentSelection = null;
			this.selectionContext = null;
			this.statusText = "Context cleared.";
			this.errorText = "";
			this.render();
		});
	}

	private renderActions(root: HTMLElement): void {
		const generatePanel = root.createDiv({ cls: "format-assistant-action-group" });
		generatePanel.createEl("h3", { text: "Generate" });

		const generateButton = generatePanel.createEl("button", {
			text: this.loading ? "Generating..." : "Generate",
			cls: "mod-cta format-assistant-full-button"
		});
		generateButton.disabled = this.loading;
		generateButton.addEventListener("click", () => {
			void this.generate();
		});

		const resultPanel = root.createDiv({ cls: "format-assistant-action-group" });
		resultPanel.createEl("h3", { text: "Result" });
		const resultButtons = resultPanel.createDiv({ cls: "format-assistant-button-row" });

		const copyButton = resultButtons.createEl("button", { text: "Copy" });
		copyButton.disabled = !this.outputText;
		copyButton.addEventListener("click", () => {
			void this.copyResult();
		});

		const replaceButton = resultButtons.createEl("button", { text: "Replace" });
		replaceButton.disabled = !this.outputText;
		replaceButton.addEventListener("click", () => {
			this.confirmReplace();
		});

		const insertButton = resultButtons.createEl("button", { text: "Insert below" });
		insertButton.disabled = !this.outputText;
		insertButton.addEventListener("click", () => {
			this.confirmInsertBelow();
		});

		const cancelButton = resultButtons.createEl("button", { text: "Clear output" });
		cancelButton.addEventListener("click", () => {
			this.outputText = "";
			this.errorText = "";
			this.statusText = "Output cleared.";
			this.loading = false;
			this.render();
		});
	}

	private renderOutput(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel format-assistant-output-panel" });
		panel.createEl("h3", { text: "Output" });

		if (!this.outputText) {
			panel.createDiv({
				cls: "format-assistant-empty",
				text: "No result yet. Capture a selection, choose a mode, then Generate."
			});
			return;
		}

		panel.createEl("pre", {
			cls: "format-assistant-output",
			text: this.outputText
		});
	}

	private renderStatus(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-status" });

		if (this.loading) {
			panel.createDiv({ text: "Loading..." });
		}

		if (this.errorText) {
			panel.createDiv({
				cls: "format-assistant-error",
				text: this.errorText
			});
		}

		if (this.statusText) {
			panel.createDiv({ text: this.statusText });
		}

		if (this.selectionContext) {
			panel.createDiv({
				cls: "format-assistant-muted",
				text: `Prompt context: ${this.describeText(this.selectionContext.text)}.`
			});
		}

		if (this.plugin.settings.includeFullCurrentNote) {
			panel.createDiv({
				cls: "format-assistant-warning",
				text: "Full-note setting is on, but this version still sends only captured selection text."
			});
		}
	}

	private async generate(): Promise<void> {
		if (!this.selectionContext?.text.trim()) {
			this.captureCurrentSelection(false);
			if (this.currentSelection?.text.trim()) {
				this.setSelectionContextFromPreview(this.currentSelection);
			}
		}

		if (!this.selectionContext?.text.trim()) {
			this.setError("请先选中文本");
			new Notice("请先选中文本");
			return;
		}

		const validationError = this.plugin.validateApiSettings();
		if (validationError) {
			this.setError(validationError);
			new Notice(validationError);
			return;
		}

		this.loading = true;
		this.errorText = "";
		this.statusText = "Generating...";
		this.render();

		try {
			this.outputText = await this.plugin.generateFromSelection(
				this.mode,
				this.selectionContext.text,
				this.customInstruction,
				this.selectionContext.fileName ?? undefined
			);
			this.statusText = `Generated ${this.describeText(this.outputText)}.`;
		} catch (error) {
			this.errorText = this.plugin.toUserError(error);
			this.statusText = "";
			new Notice(this.errorText);
		} finally {
			this.loading = false;
			this.render();
		}
	}

	private async copyResult(): Promise<void> {
		if (!this.outputText) {
			new Notice("No result to copy.");
			return;
		}

		await navigator.clipboard.writeText(this.outputText);
		this.statusText = "Result copied.";
		this.render();
		new Notice("Result copied.");
	}

	private confirmReplace(): void {
		if (!this.outputText) {
			new Notice("No result to replace with.");
			return;
		}

		new ConfirmModal(this.app, {
			message: "确认用生成结果替换当前选区吗？",
			confirmText: "Replace selection",
			onConfirm: () => this.replaceSelection()
		}).open();
	}

	private confirmInsertBelow(): void {
		if (!this.outputText) {
			new Notice("No result to insert.");
			return;
		}

		new ConfirmModal(this.app, {
			message: "确认将生成结果插入到当前选区之后吗？",
			confirmText: "Insert below selection",
			onConfirm: () => this.insertBelowSelection()
		}).open();
	}

	private replaceSelection(): void {
		const selectionState = this.getVerifiedSelectionState();
		if (!selectionState) {
			return;
		}

		selectionState.editor.replaceRange(
			this.outputText,
			selectionState.from,
			selectionState.to
		);
		this.statusText = "Selection replaced.";
		this.render();
		new Notice("Selection replaced.");
	}

	private insertBelowSelection(): void {
		const selectionState = this.getVerifiedSelectionState();
		if (!selectionState) {
			return;
		}

		selectionState.editor.replaceRange(
			`\n\n${this.outputText}`,
			selectionState.to
		);
		this.statusText = "Result inserted below selection.";
		this.render();
		new Notice("Result inserted below selection.");
	}

	private getVerifiedSelectionState(): {
		editor: Editor;
		from: EditorPosition;
		to: EditorPosition;
	} | null {
		const info = this.getActiveMarkdownInfo();
		if (!info?.editor) {
			this.setError("No active Markdown editor.");
			new Notice("No active Markdown editor.");
			return null;
		}

		if (!this.selectionContext) {
			this.setError("Please capture a selection first.");
			new Notice("Please capture a selection first.");
			return null;
		}

		if (this.selectionContext.filePath && info.file?.path !== this.selectionContext.filePath) {
			this.setError("Active file changed. Please refresh selection.");
			new Notice("Active file changed. Please refresh selection.");
			return null;
		}

		const currentSelection = info.editor.getSelection();
		const currentFrom = info.editor.getCursor("from");
		const currentTo = info.editor.getCursor("to");
		if (!currentSelection.trim()) {
			this.setError("Current editor has no selection. Please refresh selection.");
			new Notice("Current editor has no selection. Please refresh selection.");
			return null;
		}

		if (
			currentSelection !== this.selectionContext.text ||
			!positionsEqual(currentFrom, this.selectionContext.from) ||
			!positionsEqual(currentTo, this.selectionContext.to)
		) {
			this.setError("Selection changed. Please click Refresh selection before replacing.");
			new Notice("Selection changed. Please click Refresh selection before replacing.");
			return null;
		}

		return {
			editor: info.editor,
			from: currentFrom,
			to: currentTo
		};
	}

	private getActiveMarkdownView(): MarkdownView | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView);
	}

	private captureCurrentSelection(showNotice: boolean): boolean {
		const info = this.getActiveMarkdownInfo();
		if (!info?.editor) {
			this.currentSelection = null;
			this.selectionContext = null;
			this.setError("请先切换到 Markdown 编辑器");
			if (showNotice) {
				new Notice("请先切换到 Markdown 编辑器");
			}
			return false;
		}

		const preview = getActiveSelectionPreview(info);
		this.currentSelection = preview;

		if (!preview.text.trim()) {
			this.selectionContext = null;
			this.statusText = "请先选择文本";
			this.errorText = "";
			this.render();
			if (showNotice) {
				new Notice("请先选中文本");
			}
			return false;
		}

		this.setSelectionContextFromPreview(preview);
		this.statusText = `Captured ${describeSelection(preview.text)}.`;
		this.errorText = "";
		this.render();
		return true;
	}

	private getActiveMarkdownInfo(): MarkdownFileInfo | null {
		const activeEditor = this.app.workspace.activeEditor;
		if (activeEditor?.editor) {
			return activeEditor;
		}

		return this.plugin.getLastMarkdownInfo() ?? this.getActiveMarkdownView();
	}

	private setSelectionContextFromPreview(preview: ActiveSelectionPreview): void {
		if (!preview.from || !preview.to) {
			this.selectionContext = null;
			return;
		}

		this.selectionContext = {
			text: preview.text,
			filePath: preview.filePath,
			fileName: preview.fileName,
			from: preview.from,
			to: preview.to
		};
	}

	private setError(message: string): void {
		this.errorText = message;
		this.statusText = "";
		this.render();
	}

	private describeText(text: string): string {
		return describeSelection(text);
	}

	private openSettings(): void {
		const appWithSettings = this.app as typeof this.app & {
			setting?: {
				open: () => void;
				openTabById: (id: string) => void;
			};
		};

		appWithSettings.setting?.open();
		appWithSettings.setting?.openTabById(this.plugin.manifest.id);
	}

	private async addCurrentInputAsPreset(): Promise<void> {
		const content = this.customInstruction.trim();
		if (!content) {
			this.setError("Enter an instruction before saving a preset.");
			new Notice("Enter an instruction before saving a preset.");
			return;
		}

		if (this.plugin.settings.promptPresets.length >= MAX_PROMPT_PRESETS) {
			this.setError(`Prompt presets are limited to ${MAX_PROMPT_PRESETS}.`);
			new Notice(`Prompt presets are limited to ${MAX_PROMPT_PRESETS}.`);
			return;
		}

		const preset = createPromptPreset(content);
		this.plugin.settings.promptPresets = [
			...this.plugin.settings.promptPresets,
			preset
		];
		this.selectedPresetId = preset.id;
		await this.plugin.saveSettings();
		this.statusText = "Prompt preset saved.";
		this.errorText = "";
		this.render();
		new Notice("Prompt preset saved.");
	}

	private applySelectedPreset(): void {
		const preset = this.getSelectedPreset();
		if (!preset) {
			this.setError("Select a prompt preset first.");
			new Notice("Select a prompt preset first.");
			return;
		}

		this.customInstruction = preset.content;
		this.statusText = "Prompt preset loaded into input.";
		this.errorText = "";
		this.render();
		this.focusInput();
	}

	private async removeSelectedPreset(): Promise<void> {
		const preset = this.getSelectedPreset();
		if (!preset) {
			this.setError("Select a prompt preset first.");
			new Notice("Select a prompt preset first.");
			return;
		}

		this.plugin.settings.promptPresets = this.plugin.settings.promptPresets.filter(
			(item) => item.id !== preset.id
		);
		this.selectedPresetId = "";
		await this.plugin.saveSettings();
		this.statusText = "Prompt preset removed.";
		this.errorText = "";
		this.render();
		new Notice("Prompt preset removed.");
	}

	private getSelectedPreset() {
		return this.plugin.settings.promptPresets.find(
			(preset) => preset.id === this.selectedPresetId
		);
	}
}

function positionsEqual(left: EditorPosition, right: EditorPosition): boolean {
	return left.line === right.line && left.ch === right.ch;
}
