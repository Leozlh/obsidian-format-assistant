import {
	Editor,
	EditorPosition,
	ItemView,
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
	private selectionContext: SelectionContext | null = null;
	private outputText = "";
	private statusText = "";
	private errorText = "";
	private loading = false;
	private customInputEl: HTMLTextAreaElement | null = null;

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
		this.renderContext(root);
		this.renderModeSelector(root);
		this.renderInput(root);
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
		const view = this.getActiveMarkdownView();
		if (!view) {
			this.setError("No active Markdown editor.");
			if (showNotice) {
				new Notice("No active Markdown editor.");
			}
			return;
		}

		this.setContextFromEditor(view.editor, view, showNotice);
	}

	setContextFromEditor(editor: Editor, view: MarkdownView | null, showNotice: boolean): void {
		const selectedText = editor.getSelection();
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

	private renderContext(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-panel" });
		panel.createEl("h3", { text: "Context" });

		const activeView = this.getActiveMarkdownView();
		const activeSelection = activeView?.editor.getSelection() ?? "";
		const rows = [
			["Current file", this.selectionContext?.fileName ?? activeView?.file?.basename ?? "None"],
			["Current editor selection", activeSelection.trim() ? "Yes" : "No"],
			["Captured selection", this.selectionContext ? this.describeText(this.selectionContext.text) : "None"],
			["Mode", FORMAT_MODE_LABELS[this.mode]]
		];

		const list = panel.createDiv({ cls: "format-assistant-context-list" });
		for (const [label, value] of rows) {
			const row = list.createDiv({ cls: "format-assistant-context-row" });
			row.createSpan({ text: label });
			row.createSpan({ text: value });
		}
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

	private renderSelectionControls(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-button-row" });

		const useButton = panel.createEl("button", { text: "Use current selection" });
		useButton.addEventListener("click", () => this.useCurrentSelection(true));

		const refreshButton = panel.createEl("button", { text: "Refresh selection" });
		refreshButton.addEventListener("click", () => this.useCurrentSelection(true));

		const clearButton = panel.createEl("button", { text: "Clear context" });
		clearButton.addEventListener("click", () => {
			this.selectionContext = null;
			this.statusText = "Context cleared.";
			this.errorText = "";
			this.render();
		});
	}

	private renderActions(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "format-assistant-button-row" });

		const generateButton = panel.createEl("button", {
			text: this.loading ? "Generating..." : "Generate",
			cls: "mod-cta"
		});
		generateButton.disabled = this.loading;
		generateButton.addEventListener("click", () => {
			void this.generate();
		});

		const copyButton = panel.createEl("button", { text: "Copy result" });
		copyButton.disabled = !this.outputText;
		copyButton.addEventListener("click", () => {
			void this.copyResult();
		});

		const replaceButton = panel.createEl("button", { text: "Replace selection" });
		replaceButton.disabled = !this.outputText;
		replaceButton.addEventListener("click", () => {
			this.confirmReplace();
		});

		const insertButton = panel.createEl("button", { text: "Insert below selection" });
		insertButton.disabled = !this.outputText;
		insertButton.addEventListener("click", () => {
			this.confirmInsertBelow();
		});

		const cancelButton = panel.createEl("button", { text: "Cancel / Clear" });
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
			this.setError("Please select text first.");
			new Notice("Please select text first.");
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
		const view = this.getActiveMarkdownView();
		if (!view) {
			this.setError("No active Markdown editor.");
			new Notice("No active Markdown editor.");
			return null;
		}

		if (!this.selectionContext) {
			this.setError("Please capture a selection first.");
			new Notice("Please capture a selection first.");
			return null;
		}

		if (this.selectionContext.filePath && view.file?.path !== this.selectionContext.filePath) {
			this.setError("Active file changed. Please refresh selection.");
			new Notice("Active file changed. Please refresh selection.");
			return null;
		}

		const currentSelection = view.editor.getSelection();
		const currentFrom = view.editor.getCursor("from");
		const currentTo = view.editor.getCursor("to");
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
			editor: view.editor,
			from: currentFrom,
			to: currentTo
		};
	}

	private getActiveMarkdownView(): MarkdownView | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView);
	}

	private setError(message: string): void {
		this.errorText = message;
		this.statusText = "";
		this.render();
	}

	private describeText(text: string): string {
		const chars = text.length;
		const words = text.trim()
			? text.trim().split(/\s+/).filter(Boolean).length
			: 0;
		return `${words} words / ${chars} chars`;
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
}

function positionsEqual(left: EditorPosition, right: EditorPosition): boolean {
	return left.line === right.line && left.ch === right.ch;
}
