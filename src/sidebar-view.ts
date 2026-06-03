import {
	Editor,
	ItemView,
	MarkdownView,
	Notice,
	WorkspaceLeaf
} from "obsidian";
import type FormatAssistantPlugin from "./main";
import { FORMAT_MODE_LABELS, type FormatMode } from "./prompts";
import { ConfirmModal } from "./preview-modal";
import {
	countLines,
	countWords,
	describeInput,
	getNoteBodyRange,
	type CapturedInput,
	type InputSource,
	type VerifiedSelectionState
} from "./selection-service";
import {
	createPromptPreset,
	MAX_PROMPT_PRESETS
} from "./sidebar-presets";

export const FORMAT_ASSISTANT_VIEW_TYPE = "format-assistant-sidebar";

const SIDEBAR_MODES: FormatMode[] = [
	"obsidian-markdown",
	"note-organize",
	"diary-organize"
];

const MODE_HINTS: Partial<Record<FormatMode, string>> = {
	"obsidian-markdown": "轻整理：只规整排版，不重构内容。",
	"note-organize": "结构化：提炼概念 / 公式 / 易错点，可加小标题。",
	"diary-organize": "日记：保留语气，记录与待办分离。"
};

interface GenerateInput {
	text: string;
	source: InputSource;
	currentFileName?: string;
}

export class FormatAssistantSidebarView extends ItemView {
	private plugin: FormatAssistantPlugin;
	private mode: FormatMode;
	private manualInput = "";
	private customInstruction = "";
	private currentContext: CapturedInput | null = null;
	private outputText = "";
	private statusText = "";
	private errorText = "";
	private loading = false;
	private completedMs: number | null = null;
	private lastGenerationSource: InputSource | null = null;
	private customInputEl: HTMLTextAreaElement | null = null;
	private manualInputEl: HTMLTextAreaElement | null = null;
	private contextPanelEl: HTMLElement | null = null;
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
		this.contextPanelEl = null;

		this.renderHeader(root);
		this.renderApiProfileSelector(root);
		this.renderContextPreview(root);
		this.renderModeSelector(root);
		this.renderInput(root);
		this.renderActions(root);
		this.renderManualInput(root);
		this.renderPromptPresets(root);
		this.renderStatus(root);
	}

	private createCollapsibleSection(root: HTMLElement, title: string, open: boolean): HTMLElement {
		const details = root.createEl("details", { cls: "format-assistant-collapsible" });
		details.open = open;
		details.createEl("summary", {
			cls: "format-assistant-collapsible-summary",
			text: title
		});
		return details.createDiv({ cls: "format-assistant-panel" });
	}

	refreshContextStatus(): void {
		const info = this.plugin.selectionService.getActiveMarkdownInfo();
		const selection = info?.editor?.getSelection() ?? "";
		const activeName = this.currentContext?.fileName
			?? info?.file?.basename
			?? "No active Markdown file";

		if (!this.currentContext) {
			this.statusText = selection.trim()
				? `Active file: ${activeName}. Current editor has a selection.`
				: this.plugin.settings.includeFullCurrentNote
					? `Active file: ${activeName}. Current note fallback is enabled.`
					: `Active file: ${activeName}. Select text or paste into Manual Input.`;
		}

		this.refreshContextPreview();
	}

	focusInput(): void {
		this.customInputEl?.focus();
	}

	useCurrentSelection(showNotice = true): void {
		if (!this.captureCurrentSelection(showNotice)) {
			return;
		}

		if (showNotice) {
			new Notice(
				this.currentContext?.source === "note"
					? "Current note body sent to Format Assistant."
					: "Selection sent to Format Assistant."
			);
		}
	}

	setContextFromEditor(editor: Editor, view: MarkdownView | null, showNotice: boolean): void {
		const context = this.plugin.selectionService.captureFromEditor(editor, view);
		if (!context) {
			this.setError("Please select text first.");
			if (showNotice) {
				new Notice("Please select text first.");
			}
			return;
		}

		this.currentContext = context;
		this.errorText = "";
		this.statusText = `Captured ${describeInput(context.text)}.`;
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
		this.contextPanelEl = panel;
		this.renderContextPreviewContent(panel);
	}

	private renderContextPreviewContent(panel: HTMLElement): void {
		const header = panel.createDiv({ cls: "format-assistant-section-header" });
		header.createEl("h3", { text: "Context Preview" });
		const preview = this.getDisplayedContextPreview();

		const fileName = preview.fileName === "No active Markdown file" ? "None" : preview.fileName;
		const hasContent = Boolean(preview.text.trim());
		const meta = panel.createDiv({ cls: "format-assistant-context-meta" });
		meta.createSpan({ text: `Current file: ${fileName}` });
		meta.createSpan({ text: `Source: ${this.getCurrentInputSourceLabel()}` });
		if (hasContent) {
			meta.createSpan({
				text: `${preview.characterCount} chars / ${preview.wordCount} words / ${countLines(preview.text)} lines`
			});
		}

		if (!hasContent) {
			panel.createDiv({
				cls: "format-assistant-empty format-assistant-context-preview",
				text: "No context captured. Select text, then Use / Refresh."
			});
			this.renderSelectionControls(panel);
			return;
		}

		panel.createEl("pre", {
			cls: "format-assistant-context-preview",
			text: preview.text
		});
		this.renderSelectionControls(panel);
	}

	refreshContextPreview(): void {
		if (!this.contextPanelEl) {
			this.render();
			return;
		}

		this.contextPanelEl.empty();
		this.renderContextPreviewContent(this.contextPanelEl);
	}

	private renderModeSelector(root: HTMLElement): void {
		const wrapper = root.createDiv({ cls: "format-assistant-mode-block" });
		const panel = wrapper.createDiv({ cls: "format-assistant-inline-field" });
		panel.createSpan({ text: "Mode:" });

		const select = panel.createEl("select", { cls: "format-assistant-select format-assistant-mode-select" });
		for (const mode of SIDEBAR_MODES) {
			select.createEl("option", {
				text: FORMAT_MODE_LABELS[mode],
				value: mode
			});
		}

		const hint = wrapper.createDiv({
			cls: "format-assistant-muted format-assistant-mode-hint",
			text: MODE_HINTS[this.mode] ?? ""
		});

		select.value = this.mode;
		select.addEventListener("change", () => {
			this.mode = select.value as FormatMode;
			this.plugin.settings.sidebarDefaultMode = this.mode;
			void this.plugin.saveSettings();
			hint.setText(MODE_HINTS[this.mode] ?? "");
			this.statusText = `Mode: ${FORMAT_MODE_LABELS[this.mode]}.`;
			this.errorText = "";
			this.render();
		});
	}

	private renderManualInput(root: HTMLElement): void {
		const panel = this.createCollapsibleSection(
			root,
			"Manual Input",
			Boolean(this.manualInput.trim())
		);
		const manualStats = panel.createDiv({
			cls: "format-assistant-muted",
			text: this.getManualInputStatsText()
		});

		this.manualInputEl = panel.createEl("textarea", {
			cls: "format-assistant-textarea format-assistant-manual-input",
			attr: {
				placeholder: "Paste text to process instead of the selection. Takes priority when non-empty."
			}
		});
		this.manualInputEl.value = this.manualInput;

		const buttons = panel.createDiv({ cls: "format-assistant-button-row format-assistant-button-row--compact" });
		const clearButton = buttons.createEl("button", { text: "Clear manual input" });
		clearButton.disabled = !this.manualInput;

		clearButton.addEventListener("click", () => {
			this.manualInput = "";
			this.statusText = "Manual input cleared.";
			this.render();
		});

		this.manualInputEl.addEventListener("input", () => {
			this.manualInput = this.manualInputEl?.value ?? "";
			manualStats.setText(this.getManualInputStatsText());
			clearButton.disabled = !this.manualInput;
			this.refreshContextPreview();
		});
	}

	private renderInput(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel" });
		panel.createEl("h3", { text: "Instruction" });

		this.customInputEl = panel.createEl("textarea", {
			cls: "format-assistant-textarea",
			attr: {
				placeholder: "Add temporary instructions, for example: keep it concise, preserve the original tone, or organize it as a clearer course note."
			}
		});
		this.customInputEl.value = this.customInstruction;
		this.customInputEl.addEventListener("input", () => {
			this.customInstruction = this.customInputEl?.value ?? "";
		});
	}

	private renderPromptPresets(root: HTMLElement): void {
		const panel = this.createCollapsibleSection(
			root,
			`Prompt Presets (${this.plugin.settings.promptPresets.length}/${MAX_PROMPT_PRESETS})`,
			false
		);

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

		const bodyButton = buttons.createEl("button", { text: "Note body" });
		bodyButton.setAttribute("aria-label", "Select note body");
		bodyButton.addEventListener("click", () => this.selectNoteBody());

		const clearButton = buttons.createEl("button", { text: "Clear" });
		clearButton.addEventListener("click", () => {
			this.currentContext = null;
			this.statusText = "Context cleared.";
			this.errorText = "";
			this.completedMs = null;
			this.render();
		});
	}

	private selectNoteBody(): void {
		const info = this.plugin.selectionService.getActiveMarkdownInfo();
		if (!info?.editor) {
			this.setError("Switch to a Markdown editor first.");
			new Notice("Switch to a Markdown editor first.");
			return;
		}

		const { from, to } = getNoteBodyRange(info.editor);
		const bodyText = info.editor.getRange(from, to);
		if (!bodyText.trim()) {
			this.setError("This note has no body text to select.");
			new Notice("This note has no body text to select.");
			return;
		}

		// Turn the note body into a real editor selection so the existing
		// verified selection path supports Replace / Insert.
		info.editor.setSelection(from, to);
		this.useCurrentSelection(true);
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
				text: this.plugin.settings.includeFullCurrentNote
					? "No result yet. Click Generate to process manual input, captured selection, or current note fallback."
					: "No result yet. Click Generate to process manual input or captured selection."
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
			text: "Current note fallback is on. With no selection, Generate may send the active note body only. The vault is never scanned."
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
			new Notice("Replace selection is only available for captured selection results.");
			return;
		}

		new ConfirmModal(this.app, {
			message: "Replace the current selection with the generated result?",
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
			new Notice("Insert below selection is only available for captured selection results.");
			return;
		}

		new ConfirmModal(this.app, {
			message: "Insert the generated result below the current selection?",
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

	private getVerifiedSelectionState(): VerifiedSelectionState | null {
		const result = this.plugin.selectionService.verifyCapturedSelection(this.currentContext);
		if (!result.state) {
			const message = result.error ?? "Please capture a selection first.";
			this.setError(message);
			new Notice(message);
			return null;
		}

		return result.state;
	}

	private captureCurrentSelection(showNotice: boolean): boolean {
		const result = this.plugin.selectionService.captureCurrentContext(
			this.plugin.settings.includeFullCurrentNote
		);
		if (!result.input) {
			this.currentContext = null;
			const message = result.error ?? "Select text first or open a note with body text.";
			this.statusText = message;
			this.errorText = "";
			this.render();
			if (showNotice) {
				new Notice(message);
			}
			return false;
		}

		this.currentContext = result.input;
		this.statusText = result.input.source === "note"
			? `Using current note fallback: ${describeInput(result.input.text)}.`
			: `Captured ${describeInput(result.input.text)}.`;
		this.errorText = "";
		this.render();
		return true;
	}

	private resolveInputForGenerate(): GenerateInput | null {
		const manualText = this.manualInput.trim();
		if (manualText) {
			return {
				text: manualText,
				source: "manual",
				currentFileName: this.plugin.selectionService.getActiveMarkdownInfo()?.file?.basename ?? undefined
			};
		}

		if (!this.currentContext?.text.trim()) {
			this.captureCurrentSelection(false);
		}

		if (this.currentContext?.text.trim()) {
			return {
				text: this.currentContext.text.trim(),
				source: this.currentContext.source,
				currentFileName: this.currentContext.fileName ?? undefined
			};
		}

		return null;
	}

	private getCurrentInputSourceLabel(): string {
		if (this.manualInput.trim()) {
			return "Manual input";
		}

		if (this.currentContext?.source === "selection" && this.currentContext.text.trim()) {
			return "Captured selection";
		}

		if (this.currentContext?.source === "note" && this.currentContext.text.trim()) {
			return "Current note fallback";
		}

		return "None";
	}

	private formatInputSource(source: InputSource): string {
		if (source === "manual") {
			return "Manual input";
		}

		if (source === "note") {
			return "Current note fallback";
		}

		return "Captured selection";
	}

	private setError(message: string): void {
		this.errorText = message;
		this.statusText = "";
		this.render();
	}

	private getDisplayedContextPreview(): CapturedInput {
		if (this.currentContext?.text.trim()) {
			return this.currentContext;
		}

		return this.plugin.selectionService.getActiveSelectionPreview();
	}

	private getManualInputStatsText(): string {
		return `Manual input: ${this.manualInput.length} chars / ${countWords(this.manualInput)} words / ${countLines(this.manualInput)} lines`;
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
