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
	type CapturedInput,
	type InputSource,
	type VerifiedSelectionState
} from "./selection-service";
import { pushRecentInstruction } from "./settings-types";

export const FORMAT_ASSISTANT_VIEW_TYPE = "format-assistant-sidebar";

const SIDEBAR_MODES: FormatMode[] = [
	"obsidian-markdown",
	"note-organize",
	"diary-organize"
];

const MODE_HINTS: Partial<Record<FormatMode, string>> = {
	"obsidian-markdown": "Light cleanup: tidy layout only, no restructuring.",
	"note-organize": "Structured: extract concepts / formulas / pitfalls, may add headings.",
	"diary-organize": "Diary: keep the original tone; preserve the timeline; pull out real to-dos."
};

interface GenerateInput {
	text: string;
	source: InputSource;
	currentFileName?: string;
	// True when the input box was empty and we auto-pulled a selection / note.
	autoCaptured?: boolean;
}

export class FormatAssistantSidebarView extends ItemView {
	private plugin: FormatAssistantPlugin;
	private mode: FormatMode;
	// The single editable input box. It doubles as the manual-input field and as
	// the (now editable) preview of a captured selection.
	private inputText = "";
	private customInstruction = "";
	// The captured selection anchor (with range), used so Replace / Insert can
	// target the original editor selection. Null when the input is manual.
	private currentContext: CapturedInput | null = null;
	private outputText = "";
	private statusText = "";
	private errorText = "";
	private loading = false;
	private completedMs: number | null = null;
	private lastGenerationSource: InputSource | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private instructionEl: HTMLTextAreaElement | null = null;
	private inputMetaEl: HTMLElement | null = null;

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
		this.render();
		// The editor fires no event on selection change, so the "editor selection"
		// hint can go stale. Refresh just the small meta line (never the textarea)
		// whenever the user turns to the sidebar.
		this.registerDomEvent(this.contentEl, "pointerenter", () => {
			this.renderInputMeta();
		});
		if (this.plugin.settings.autoUseSelectionOnSidebarOpen) {
			this.useCurrentSelection(false);
		}
	}

	async onClose() {
		this.contentEl.empty();
		this.inputEl = null;
		this.instructionEl = null;
		this.inputMetaEl = null;
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("format-assistant-sidebar");

		this.renderHeader(root);
		this.renderApiProfileSelector(root);
		this.renderInputSection(root);
		this.renderModeSelector(root);
		this.renderInstruction(root);
		this.renderActions(root);
		this.renderStatus(root);
	}

	// Lightweight: only updates the small meta line (file / source / counts), never
	// the textarea, so it is safe to call while the user is typing.
	refreshContextStatus(): void {
		this.renderInputMeta();
	}

	focusInput(): void {
		this.inputEl?.focus();
	}

	useCurrentSelection(showNotice = true): void {
		// Live selection wins and keeps Replace / Insert available.
		const sel = this.plugin.selectionService.captureCurrentContext(false);
		if (sel.input) {
			this.adoptCapturedInput(sel.input);
			this.statusText = `Captured ${describeInput(sel.input.text)}.`;
			this.render();
			if (showNotice) {
				new Notice("Selection sent to Format Assistant.");
			}
			return;
		}

		// No selection: if the note fallback is enabled, select the whole note
		// body in the editor. It becomes a real selection, so Replace / Insert
		// stay available.
		if (this.plugin.settings.includeFullCurrentNote) {
			const note = this.plugin.selectionService.captureNoteBodyAsSelection();
			if (note.input) {
				this.adoptCapturedInput(note.input);
				this.statusText = `No selection — pulled the whole note body: ${describeInput(note.input.text)}.`;
				this.render();
				if (showNotice) {
					new Notice("No selection found — pulled the whole note body.");
				}
				return;
			}
			this.statusText = note.error ?? "No selection and no note body.";
			this.errorText = "";
			this.renderInputMeta();
			if (showNotice) {
				new Notice(this.statusText);
			}
			return;
		}

		this.statusText = sel.error ?? "Select text first.";
		this.errorText = "";
		this.renderInputMeta();
		if (showNotice) {
			new Notice(this.statusText);
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

		this.adoptCapturedInput(context);
		this.statusText = `Captured ${describeInput(context.text)}.`;
		this.render();

		if (showNotice) {
			new Notice("Selection sent to Format Assistant.");
		}
	}

	// Fills the editable input from a captured selection and remembers the anchor.
	private adoptCapturedInput(input: CapturedInput): void {
		this.currentContext = input;
		this.inputText = input.text;
		this.errorText = "";
	}

	// Live selection first, then (if enabled) the whole note body as a real
	// selection. Used by Generate's auto-capture when the input box is empty.
	private captureSelectionOrNoteBody(): {
		input: CapturedInput | null;
		error: string | null;
	} {
		const sel = this.plugin.selectionService.captureCurrentContext(false);
		if (sel.input) {
			return sel;
		}
		if (this.plugin.settings.includeFullCurrentNote) {
			return this.plugin.selectionService.captureNoteBodyAsSelection();
		}
		return sel;
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
		// Nothing to choose with zero profiles — keep the sidebar compact.
		if (this.plugin.settings.apiProfiles.length === 0) {
			return;
		}

		const panel = root.createDiv({ cls: "format-assistant-panel format-assistant-api-profile" });
		const header = panel.createDiv({ cls: "format-assistant-section-header" });
		header.createEl("h3", { text: "API" });
		header.createSpan({ cls: "format-assistant-muted", text: "Select profile" });

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

	// The unified editable input: a captured selection lands here and can be
	// edited freely; typing / pasting here is the manual-input path.
	private renderInputSection(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel" });
		const header = panel.createDiv({ cls: "format-assistant-section-header" });
		header.createEl("h3", { text: "Input" });

		this.inputMetaEl = panel.createDiv({ cls: "format-assistant-context-meta" });
		this.renderInputMeta();

		this.inputEl = panel.createEl("textarea", {
			cls: "format-assistant-textarea format-assistant-input",
			attr: {
				placeholder:
					"Click \"Use selection\" to pull the editor selection here — or just type / paste. This text is what gets processed."
			}
		});
		this.inputEl.value = this.inputText;
		this.inputEl.addEventListener("input", () => {
			this.inputText = this.inputEl?.value ?? "";
			this.renderInputMeta();
		});
		// Cmd/Ctrl+Enter generates from the input box.
		this.inputEl.addEventListener("keydown", (event) => {
			if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
				event.preventDefault();
				void this.generate();
			}
		});

		const buttons = panel.createDiv({
			cls: "format-assistant-button-row format-assistant-button-row--compact"
		});

		const useButton = buttons.createEl("button", { text: "Use selection" });
		useButton.addEventListener("click", () => this.useCurrentSelection(true));

		const clearButton = buttons.createEl("button", { text: "Clear" });
		clearButton.disabled = !this.inputText;
		clearButton.addEventListener("click", () => {
			this.inputText = "";
			this.currentContext = null;
			this.statusText = "Input cleared.";
			this.errorText = "";
			this.completedMs = null;
			this.render();
		});

		// Inline surfacing of the whole-note fallback (also in settings).
		const fallbackLabel = panel.createEl("label", { cls: "format-assistant-checkbox format-assistant-muted" });
		const fallbackToggle = fallbackLabel.createEl("input", { attr: { type: "checkbox" } });
		fallbackToggle.checked = this.plugin.settings.includeFullCurrentNote;
		fallbackLabel.createSpan({ text: " Use the whole note when nothing is selected" });
		fallbackToggle.addEventListener("change", async () => {
			this.plugin.settings.includeFullCurrentNote = fallbackToggle.checked;
			await this.plugin.saveSettings();
			this.render();
		});
	}

	private renderInputMeta(): void {
		const el = this.inputMetaEl;
		if (!el) {
			return;
		}
		el.empty();

		const info = this.plugin.selectionService.getActiveMarkdownInfo();
		const fileName = this.currentContext?.fileName ?? info?.file?.basename ?? "None";
		el.createSpan({ text: `Current file: ${fileName}` });
		el.createSpan({ text: `Source: ${this.getInputSourceLabel()}` });

		const text = this.inputText;
		if (text.trim()) {
			el.createSpan({
				text: `${text.length} chars / ${countWords(text)} words / ${countLines(text)} lines`
			});
			return;
		}

		// Empty box: hint whether the editor has a selection ready to pull.
		const selection = info?.editor?.getSelection() ?? "";
		if (selection.trim()) {
			el.createSpan({
				cls: "format-assistant-muted",
				text: `Editor selection ready: ${selection.length} chars — click "Use selection"`
			});
		}
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
		});
	}

	private renderInstruction(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel" });
		panel.createEl("h3", { text: "Instruction" });

		// Lightweight quick-pick of recently used instructions.
		const recents = this.plugin.settings.recentInstructions;
		if (recents.length > 0) {
			const pick = panel.createEl("select", { cls: "format-assistant-select" });
			pick.createEl("option", { text: "Recent instructions…", value: "" });
			for (const r of recents) {
				pick.createEl("option", {
					text: r.length > 40 ? `${r.slice(0, 40)}…` : r,
					value: r
				});
			}
			pick.value = "";
			pick.addEventListener("change", () => {
				if (pick.value) {
					this.customInstruction = pick.value;
					if (this.instructionEl) {
						this.instructionEl.value = pick.value;
					}
				}
				pick.value = "";
			});
		}

		this.instructionEl = panel.createEl("textarea", {
			cls: "format-assistant-textarea",
			attr: {
				placeholder: "Add temporary instructions, for example: keep it concise, or preserve the original tone."
			}
		});
		this.instructionEl.value = this.customInstruction;
		this.instructionEl.addEventListener("input", () => {
			this.customInstruction = this.instructionEl?.value ?? "";
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
			text: "Replace",
			cls: "format-assistant-result-secondary"
		});
		replaceButton.setAttribute("aria-label", "Replace selection");
		replaceButton.disabled = !canWriteSelection;
		replaceButton.addEventListener("click", () => {
			this.confirmReplace();
		});

		const insertButton = resultButtons.createEl("button", {
			text: "Insert below",
			cls: "format-assistant-result-secondary"
		});
		insertButton.setAttribute("aria-label", "Insert below selection");
		insertButton.disabled = !canWriteSelection;
		insertButton.addEventListener("click", () => {
			this.confirmInsertBelow();
		});

		const sendToInputButton = resultButtons.createEl("button", {
			text: "→ Input",
			cls: "format-assistant-result-secondary"
		});
		sendToInputButton.setAttribute("aria-label", "Send result to the Input box for another pass");
		sendToInputButton.disabled = !canCopy;
		sendToInputButton.addEventListener("click", () => this.sendResultToInput());

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

		// Explain why Replace / Insert are unavailable, when applicable.
		if (canCopy && !canWriteSelection) {
			resultPanel.createDiv({
				cls: "format-assistant-muted format-assistant-hint",
				text: "Replace / Insert need an unedited captured selection. Use \"Use selection\" and generate without editing the input to enable them."
			});
		}
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
					? "No result yet. Click Generate to process the input, a captured selection, or the current note fallback."
					: "No result yet. Click Generate to process the input or a captured selection."
			});
			return;
		}

		// Editable result: tweaks here flow into Copy / Replace / Insert.
		const resultEl = parent.createEl("textarea", {
			cls: "format-assistant-output format-assistant-output-editable"
		});
		resultEl.value = this.outputText;
		resultEl.addEventListener("input", () => {
			this.outputText = resultEl.value;
		});
		parent.createDiv({
			cls: "format-assistant-muted format-assistant-hint",
			text: "You can edit the result above before Copy / Replace / Insert."
		});
	}

	private renderStatus(root: HTMLElement): void {
		if (!this.plugin.settings.includeFullCurrentNote) {
			return;
		}

		const panel = root.createDiv({ cls: "format-assistant-status" });
		panel.createDiv({
			cls: "format-assistant-warning",
			text: "Current note fallback is on. With an empty input and no selection, Generate may send the active note body. The vault is never scanned."
		});
	}

	private async generate(): Promise<void> {
		const input = this.resolveInputForGenerate();
		if (!input) {
			this.setError("No input text. Type/paste into the Input box, or select text in an editor and click Use selection.");
			new Notice("No input text. Type/paste into the Input box, or select text first.");
			return;
		}

		const validationError = this.plugin.validateApiSettings();
		if (validationError) {
			this.setError(validationError);
			new Notice(validationError);
			return;
		}

		// F1: make implicit auto-capture visible (nothing was in the box).
		if (input.autoCaptured) {
			new Notice(`Auto-used ${this.formatInputSource(input.source)} (${input.text.length} chars).`);
		}

		// F4: remember this instruction for quick re-pick next time.
		if (this.customInstruction.trim()) {
			this.plugin.settings.recentInstructions = pushRecentInstruction(
				this.plugin.settings.recentInstructions,
				this.customInstruction
			);
			void this.plugin.saveSettings();
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
			const result = await this.plugin.generateFromSelection(
				this.mode,
				input.text,
				this.customInstruction,
				input.currentFileName,
				input.source
			);
			this.outputText = result.content;
			this.completedMs = Math.round(performance.now() - startedAt);
			this.statusText = result.truncated
				? `⚠️ Output may be truncated (hit max tokens). Increase Max Tokens. Generated from: ${this.formatInputSource(input.source)} in ${this.completedMs} ms.`
				: `Generated from: ${this.formatInputSource(input.source)}. Completed in ${this.completedMs} ms.`;
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

	// F6: move the result into the Input box to run another pass on it.
	private sendResultToInput(): void {
		if (!this.outputText) {
			new Notice("No result to send.");
			return;
		}
		this.inputText = this.outputText;
		// The result is not a captured selection, so subsequent generation is
		// manual (Replace / Insert stay gated until a new selection is captured).
		this.currentContext = null;
		this.outputText = "";
		this.errorText = "";
		this.completedMs = null;
		this.lastGenerationSource = null;
		this.statusText = "Result moved to Input for another pass.";
		this.render();
		new Notice("Result moved to Input.");
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

	private resolveInputForGenerate(): GenerateInput | null {
		let text = this.inputText.trim();
		let autoCaptured = false;

		// Empty box: try to auto-capture a selection (or note body) to fill it.
		if (!text) {
			const result = this.captureSelectionOrNoteBody();
			if (result.input) {
				this.adoptCapturedInput(result.input);
				text = result.input.text.trim();
				autoCaptured = true;
			}
		}

		if (!text) {
			return null;
		}

		const activeFileName = this.plugin.selectionService.getActiveMarkdownInfo()?.file?.basename ?? undefined;

		// "selection" only when the box still equals an unedited captured selection;
		// any edit / typed text counts as manual (so Replace / Insert are gated off).
		const isSelection = Boolean(
			this.currentContext && this.inputText.trim() === this.currentContext.text.trim()
		);

		return {
			text,
			source: isSelection ? this.currentContext!.source : "manual",
			currentFileName: isSelection
				? (this.currentContext?.fileName ?? activeFileName)
				: activeFileName,
			autoCaptured
		};
	}

	private getInputSourceLabel(): string {
		if (!this.inputText.trim()) {
			return "None";
		}
		if (this.currentContext && this.inputText.trim() === this.currentContext.text.trim()) {
			return this.currentContext.source === "note" ? "Current note" : "Captured selection";
		}
		return "Manual / edited";
	}

	private formatInputSource(source: InputSource): string {
		if (source === "manual") {
			return "Manual / edited input";
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
}
