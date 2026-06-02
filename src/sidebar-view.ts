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
import { FORMAT_MODE_LABELS, type FormatMode } from "./prompts";
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

type SidebarInputSource = "selection" | "manual";

const SIDEBAR_MODES: FormatMode[] = [
	"obsidian-markdown",
	"note-organize",
	"diary-organize",
	"custom"
];

interface GenerateInput {
	text: string;
	source: SidebarInputSource;
	currentFileName?: string;
}

export class FormatAssistantSidebarView extends ItemView {
	private plugin: FormatAssistantPlugin;
	private mode: FormatMode;
	private manualInput = "";
	private customInstruction = "";
	private currentSelection: ActiveSelectionPreview | null = null;
	private selectionContext: SelectionContext | null = null;
	private outputText = "";
	private statusText = "";
	private errorText = "";
	private loading = false;
	private completedMs: number | null = null;
	private lastGenerationSource: SidebarInputSource | null = null;
	private lastInputLength = 0;
	private customInputEl: HTMLTextAreaElement | null = null;
	private manualInputEl: HTMLTextAreaElement | null = null;
	private selectedPresetId = "";

	constructor(leaf: WorkspaceLeaf, plugin: FormatAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.mode = SIDEBAR_MODES.includes(plugin.settings.sidebarDefaultMode)
			? plugin.settings.sidebarDefaultMode
			: "obsidian-markdown";
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
		this.renderApiProfileSelector(root);
		this.renderContextPreview(root);
		this.renderModeSelector(root);
		this.renderManualInput(root);
		this.renderInput(root);
		this.renderPromptPresets(root);
		this.renderActions(root);
		this.renderStatus(root);
	}

	refreshContextStatus(): void {
		const info = this.getActiveMarkdownInfo();
		const selection = info?.editor?.getSelection() ?? this.selectionContext?.text ?? "";
		const activeName = this.selectionContext?.fileName ?? info?.file?.basename ?? "No active Markdown file";

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

	private renderApiProfileSelector(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel format-assistant-api-profile" });
		const header = panel.createDiv({ cls: "format-assistant-section-header" });
		header.createEl("h3", { text: "API" });
		header.createSpan({
			cls: "format-assistant-muted",
			text: this.plugin.settings.apiProfiles.length
				? "Select profile"
				: "No profiles"
		});

		const select = panel.createEl("select", { cls: "format-assistant-select" });
		select.createEl("option", {
			text: "Manual current settings",
			value: ""
		});

		for (const profile of this.plugin.settings.apiProfiles) {
			const option = select.createEl("option", {
				text: profile.name,
				value: profile.id
			});
			option.selected = profile.id === this.plugin.settings.activeApiProfileId;
		}

		select.value = this.plugin.settings.activeApiProfileId;
		select.addEventListener("change", () => {
			void this.switchApiProfile(select.value);
		});
	}

	private renderContextPreview(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel" });
		const header = panel.createDiv({ cls: "format-assistant-section-header" });
		header.createEl("h3", { text: "Context Preview" });
		const preview = this.currentSelection ?? getActiveSelectionPreview(this.getActiveMarkdownInfo());

		const fileName = preview.fileName === "No active Markdown file" ? "None" : preview.fileName;
		const meta = panel.createDiv({ cls: "format-assistant-context-meta" });
		meta.createSpan({ text: `Current file: ${fileName}` });
		meta.createSpan({
			text: `Captured: ${preview.characterCount} chars / ${preview.wordCount} words / ${this.countLines(preview.text)} lines`
		});


		if (!preview.text.trim()) {
			panel.createDiv({
				cls: "format-assistant-empty format-assistant-context-preview",
				text: "No selection captured. Select text in an editor, then click Refresh."
			});
			panel.createDiv({
				cls: "format-assistant-muted format-assistant-hint",
				text: "Use Refresh or Use to capture the latest editor selection."
			});
			this.renderSelectionControls(panel);
			return;
		}

		panel.createEl("pre", {
			cls: "format-assistant-context-preview",
			text: preview.text
		});
		panel.createDiv({
			cls: "format-assistant-muted format-assistant-hint",
			text: "Use Refresh or Use to capture the latest editor selection."
		});
		this.renderSelectionControls(panel);
	}

	private renderModeSelector(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-inline-field" });
		panel.createSpan({ text: "Mode:" });

		const select = panel.createEl("select", { cls: "format-assistant-select format-assistant-mode-select" });
		for (const mode of SIDEBAR_MODES) {
			select.createEl("option", {
				text: FORMAT_MODE_LABELS[mode],
				value: mode
			});
		}

		select.value = this.mode;
		select.addEventListener("change", () => {
			this.mode = select.value as FormatMode;
			this.plugin.settings.sidebarDefaultMode = this.mode;
			void this.plugin.saveSettings();
			this.statusText = `Mode: ${FORMAT_MODE_LABELS[this.mode]}.`;
			this.errorText = "";
			this.render();
		});
	}

	private renderManualInput(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel" });
		const header = panel.createDiv({ cls: "format-assistant-section-header" });
		header.createEl("h3", { text: "Manual Input" });
		const manualStats = header.createSpan({
			cls: "format-assistant-muted",
			text: `Manual input: ${this.manualInput.length} chars / ${this.countWords(this.manualInput)} words / ${this.countLines(this.manualInput)} lines`
		});

		this.manualInputEl = panel.createEl("textarea", {
			cls: "format-assistant-textarea format-assistant-manual-input",
			attr: {
				placeholder: "Paste text here if you want to process manual input instead of the current selection."
			}
		});
		this.manualInputEl.value = this.manualInput;
		this.manualInputEl.addEventListener("input", () => {
			this.manualInput = this.manualInputEl?.value ?? "";
			manualStats.setText(
				`Manual input: ${this.manualInput.length} chars / ${this.countWords(this.manualInput)} words / ${this.countLines(this.manualInput)} lines`
			);
		});

		panel.createDiv({
			cls: "format-assistant-muted format-assistant-hint",
			text: "Manual input takes priority over captured selection when non-empty."
		});

		const sourceStatus = panel.createDiv({
			cls: "format-assistant-input-source",
			text: `Input source: ${this.getCurrentInputSourceLabel()}`
		});

		const buttons = panel.createDiv({ cls: "format-assistant-button-row format-assistant-button-row--compact" });
		const useButton = buttons.createEl("button", { text: "Use manual input" });
		useButton.disabled = !this.manualInput.trim();
		const clearButton = buttons.createEl("button", { text: "Clear manual input" });
		clearButton.disabled = !this.manualInput;

		useButton.addEventListener("click", () => {
			if (!this.manualInput.trim()) {
				new Notice("Manual input is empty.");
				return;
			}

			this.statusText = "Input source: Manual input.";
			this.errorText = "";
			this.render();
			new Notice("Manual input will be used for Generate.");
		});

		clearButton.addEventListener("click", () => {
			this.manualInput = "";
			this.statusText = "Manual input cleared.";
			this.render();
		});

		this.manualInputEl.addEventListener("input", () => {
			sourceStatus.setText(`Input source: ${this.getCurrentInputSourceLabel()}`);
			useButton.disabled = !this.manualInput.trim();
			clearButton.disabled = !this.manualInput;
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

		const addButton = buttons.createEl("button", { text: "+ Save" });
		addButton.addEventListener("click", () => {
			void this.addCurrentInputAsPreset();
		});

		const selectButton = buttons.createEl("button", { text: "Use" });
		selectButton.disabled = !this.plugin.settings.promptPresets.length;
		selectButton.addEventListener("click", () => this.applySelectedPreset());

		const removeButton = buttons.createEl("button", { text: "Delete" });
		removeButton.disabled = !this.plugin.settings.promptPresets.length;
		removeButton.addEventListener("click", () => {
			void this.removeSelectedPreset();
		});
	}

	private renderSelectionControls(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: "format-assistant-selection-controls" });
		panel.createEl("h3", { text: "Selection" });
		const buttons = panel.createDiv({ cls: "format-assistant-button-row format-assistant-button-row--compact" });

		const useButton = buttons.createEl("button", { text: "Use" });
		useButton.addEventListener("click", () => this.useCurrentSelection(true));

		const refreshButton = buttons.createEl("button", { text: "Refresh" });
		refreshButton.addEventListener("click", () => this.useCurrentSelection(true));

		const clearButton = buttons.createEl("button", { text: "Clear" });
		clearButton.addEventListener("click", () => {
			this.currentSelection = null;
			this.selectionContext = null;
			this.statusText = "Context cleared.";
			this.errorText = "";
			this.completedMs = null;
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
		const canCopy = Boolean(this.outputText) && !this.loading && !this.errorText;
		const canWriteSelection = canCopy && this.lastGenerationSource === "selection";
		const canClearOutput = Boolean(this.outputText) && !this.loading;

		this.renderResultOutput(resultPanel);

		const resultButtons = resultPanel.createDiv({ cls: "format-assistant-result-buttons" });

		const copyButton = resultButtons.createEl("button", {
			text: "Copy",
			cls: "format-assistant-result-copy"
		});
		copyButton.disabled = !canCopy;
		copyButton.addEventListener("click", () => {
			void this.copyResult();
		});

		const replaceButton = resultButtons.createEl("button", {
			text: "Replace selection",
			cls: "format-assistant-result-secondary"
		});
		replaceButton.disabled = !canWriteSelection;
		replaceButton.addEventListener("click", () => {
			this.confirmReplace();
		});

		const insertButton = resultButtons.createEl("button", {
			text: "Insert below selection",
			cls: "format-assistant-result-secondary"
		});
		insertButton.disabled = !canWriteSelection;
		insertButton.addEventListener("click", () => {
			this.confirmInsertBelow();
		});

		const cancelButton = resultButtons.createEl("button", {
			text: "Clear output",
			cls: "format-assistant-result-clear"
		});
		cancelButton.disabled = !canClearOutput;
		cancelButton.addEventListener("click", () => {
			this.outputText = "";
			this.errorText = "";
			this.statusText = "Output cleared.";
			this.loading = false;
			this.completedMs = null;
			this.render();
		});
	}

	private renderResultOutput(parent: HTMLElement): void {
		if (this.completedMs !== null && this.lastGenerationSource) {
			const state = this.errorText ? "Failed from" : "Generated from";
			parent.createDiv({
				cls: "format-assistant-result-status",
				text: `Status: ${state} ${this.formatInputSource(this.lastGenerationSource)} · Completed in ${this.completedMs} ms`
			});
		}

		if (this.loading) {
			parent.createDiv({
				cls: "format-assistant-output format-assistant-output-state",
				text: "Generating..."
			});
			return;
		}

		if (this.errorText) {
			parent.createDiv({
				cls: "format-assistant-output format-assistant-output-state format-assistant-error",
				text: this.errorText
			});
			return;
		}

		if (!this.outputText) {
			parent.createDiv({
				cls: "format-assistant-empty format-assistant-output format-assistant-output-state",
				text: "No result yet. Click Generate to process captured selection."
			});
			return;
		}

		parent.createEl("pre", {
			cls: "format-assistant-output",
			text: this.outputText
		});
	}

	private renderStatus(root: HTMLElement): void {
		if (!this.plugin.settings.includeFullCurrentNote) {
			return;
		}

		const panel = root.createDiv({ cls: "format-assistant-status" });

		panel.createDiv({
			cls: "format-assistant-warning",
			text: "Full-note setting is on, but this version still sends only captured selection text."
		});
	}

	private async generate(): Promise<void> {
		const input = this.resolveInputForGenerate();
		if (!input) {
			this.setError("No input text. Select text in an editor or paste text into Manual Input.");
			new Notice("No input text. Select text in an editor or paste text into Manual Input.");
			return;
		}

		const validationError = this.plugin.validateApiSettings();
		if (validationError) {
			this.setError(validationError);
			new Notice(validationError);
			return;
		}

		this.loading = true;
		this.outputText = "";
		this.errorText = "";
		this.statusText = "Generating...";
		this.completedMs = null;
		this.lastGenerationSource = input.source;
		this.lastInputLength = input.text.length;
		this.render();

		const startedAt = performance.now();
		try {
			this.outputText = await this.plugin.generateFromSelection(
				this.mode,
				input.text,
				this.customInstruction,
				input.currentFileName,
				input.source
			);
			this.completedMs = Math.round(performance.now() - startedAt);
			this.statusText = `Generated from: ${this.formatInputSource(input.source)}. Completed in ${this.completedMs} ms.`;
		} catch (error) {
			this.completedMs = Math.round(performance.now() - startedAt);
			this.errorText = this.plugin.toUserError(error);
			this.statusText = `Failed after ${this.completedMs} ms. Input source: ${this.formatInputSource(input.source)}. Input length: ${input.text.length} chars.`;
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

		if (this.lastGenerationSource !== "selection") {
			new Notice("Replace selection is only available when the input comes from a captured editor selection.");
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

		if (this.lastGenerationSource !== "selection") {
			new Notice("Insert below selection is only available when the input comes from a captured editor selection.");
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

	private resolveInputForGenerate(): GenerateInput | null {
		const manualText = this.manualInput.trim();
		if (manualText) {
			return {
				text: manualText,
				source: "manual",
				currentFileName: this.getActiveMarkdownInfo()?.file?.basename ?? undefined
			};
		}

		if (!this.selectionContext?.text.trim()) {
			this.captureCurrentSelection(false);
			if (this.currentSelection?.text.trim()) {
				this.setSelectionContextFromPreview(this.currentSelection);
			}
		}

		if (!this.selectionContext?.text.trim()) {
			return null;
		}

		return {
			text: this.selectionContext.text.trim(),
			source: "selection",
			currentFileName: this.selectionContext.fileName ?? undefined
		};
	}

	private getCurrentInputSourceLabel(): string {
		if (this.manualInput.trim()) {
			return "Manual input";
		}

		if (this.selectionContext?.text.trim()) {
			return "Captured selection";
		}

		return "None";
	}

	private formatInputSource(source: SidebarInputSource): string {
		return source === "manual" ? "Manual input" : "Captured selection";
	}

	private countWords(text: string): number {
		return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
	}

	private countLines(text: string): number {
		return text.trim() ? text.split(/\r?\n/).length : 0;
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

	private async switchApiProfile(profileId: string): Promise<void> {
		if (!profileId) {
			this.plugin.settings.activeApiProfileId = "";
			await this.plugin.saveSettings();
			this.plugin.refreshSidebarViews();
			new Notice("Using manual API settings.");
			return;
		}

		const profile = this.plugin.settings.apiProfiles.find((item) => item.id === profileId);
		if (!profile) {
			this.setError("API profile not found.");
			new Notice("API profile not found.");
			return;
		}

		await this.plugin.applyApiProfile(profile);
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
