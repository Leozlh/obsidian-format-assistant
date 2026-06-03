import {
	App,
	Editor,
	EditorPosition,
	MarkdownFileInfo,
	MarkdownView
} from "obsidian";

export type InputSource = "selection" | "manual" | "note";

export interface CapturedInput {
	source: Exclude<InputSource, "manual">;
	text: string;
	filePath: string | null;
	fileName: string | null;
	from: EditorPosition | null;
	to: EditorPosition | null;
	wordCount: number;
	characterCount: number;
}

export interface VerifiedSelectionState {
	editor: Editor;
	from: EditorPosition;
	to: EditorPosition;
}

export interface CaptureResult {
	input: CapturedInput | null;
	error: string | null;
}

export interface VerifySelectionResult {
	state: VerifiedSelectionState | null;
	error: string | null;
}

export class SelectionService {
	private app: App;
	private lastMarkdownInfo: MarkdownFileInfo | null = null;

	constructor(app: App) {
		this.app = app;
	}

	rememberMarkdownInfo(editor: Editor, info: MarkdownFileInfo | null): void {
		if (!info?.file) {
			return;
		}

		this.lastMarkdownInfo = {
			...info,
			editor
		};
	}

	getLastMarkdownInfo(): MarkdownFileInfo | null {
		return this.lastMarkdownInfo;
	}

	getActiveMarkdownInfo(): MarkdownFileInfo | null {
		const activeEditor = this.app.workspace.activeEditor;
		if (activeEditor?.editor) {
			return activeEditor;
		}

		return this.lastMarkdownInfo ?? this.getActiveMarkdownView();
	}

	getActiveSelectionPreview(info: MarkdownFileInfo | null = this.getActiveMarkdownInfo()): CapturedInput {
		const text = info?.editor?.getSelection() ?? "";
		return {
			source: "selection",
			fileName: info?.file?.basename ?? "No active Markdown file",
			filePath: info?.file?.path ?? null,
			text,
			wordCount: countWords(text),
			characterCount: text.length,
			from: info?.editor ? info.editor.getCursor("from") : null,
			to: info?.editor ? info.editor.getCursor("to") : null
		};
	}

	captureFromEditor(editor: Editor, view: MarkdownView | null): CapturedInput | null {
		const text = editor.getSelection();
		if (!text.trim()) {
			return null;
		}

		return {
			source: "selection",
			fileName: view?.file?.basename ?? null,
			filePath: view?.file?.path ?? null,
			text,
			wordCount: countWords(text),
			characterCount: text.length,
			from: editor.getCursor("from"),
			to: editor.getCursor("to")
		};
	}

	captureCurrentContext(allowNoteFallback: boolean): CaptureResult {
		const info = this.getActiveMarkdownInfo();
		if (!info?.editor) {
			return {
				input: null,
				error: "Switch to a Markdown editor first."
			};
		}

		const selection = this.getActiveSelectionPreview(info);
		if (selection.text.trim()) {
			return {
				input: selection,
				error: null
			};
		}

		if (!allowNoteFallback) {
			return {
				input: null,
				error: "No selection captured. Enable current note fallback in settings, or paste text into Manual Input."
			};
		}

		const noteText = cleanCurrentNoteBody(info.editor.getValue());
		if (!noteText.trim()) {
			return {
				input: null,
				error: "Select text first or open a note with body text."
			};
		}

		return {
			input: {
				source: "note",
				fileName: info.file?.basename ?? null,
				filePath: info.file?.path ?? null,
				text: noteText,
				wordCount: countWords(noteText),
				characterCount: noteText.length,
				from: null,
				to: null
			},
			error: null
		};
	}

	verifyCapturedSelection(input: CapturedInput | null): VerifySelectionResult {
		const info = this.getActiveMarkdownInfo();
		if (!info?.editor) {
			return {
				state: null,
				error: "No active Markdown editor."
			};
		}

		if (!input || input.source !== "selection" || !input.from || !input.to) {
			return {
				state: null,
				error: "Please capture a selection first."
			};
		}

		if (input.filePath && info.file?.path !== input.filePath) {
			return {
				state: null,
				error: "Active file changed. Please refresh selection."
			};
		}

		const currentSelection = info.editor.getSelection();
		const currentFrom = info.editor.getCursor("from");
		const currentTo = info.editor.getCursor("to");
		if (!currentSelection.trim()) {
			return {
				state: null,
				error: "Current editor has no selection. Please refresh selection."
			};
		}

		if (
			currentSelection !== input.text ||
			!positionsEqual(currentFrom, input.from) ||
			!positionsEqual(currentTo, input.to)
		) {
			return {
				state: null,
				error: "Selection changed. Please click Refresh selection before replacing."
			};
		}

		return {
			state: {
				editor: info.editor,
				from: currentFrom,
				to: currentTo
			},
			error: null
		};
	}

	private getActiveMarkdownView(): MarkdownView | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView);
	}
}

export function describeInput(text: string): string {
	return `${text.length} chars / ${countWords(text)} words`;
}

function cleanCurrentNoteBody(text: string): string {
	return stripLeadingHeading(stripFrontmatter(text)).trim();
}

function stripFrontmatter(text: string): string {
	return text.replace(/^\s*---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
}

function stripLeadingHeading(text: string): string {
	return text.replace(/^\s*# [^\r\n]*(?:\r?\n|$)/, "");
}

function countWords(text: string): number {
	return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function positionsEqual(left: EditorPosition, right: EditorPosition): boolean {
	return left.line === right.line && left.ch === right.ch;
}
