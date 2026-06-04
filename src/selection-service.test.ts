import { describe, expect, it } from "vitest";
import type {
	App,
	Editor,
	EditorPosition,
	MarkdownFileInfo,
	MarkdownView
} from "obsidian";
import {
	countLines,
	countWords,
	describeInput,
	getNoteBodyRange,
	type CapturedInput,
	SelectionService
} from "./selection-service";

function createLineEditor(text: string): Editor {
	const lines = text.split("\n");
	return {
		lineCount: () => lines.length,
		getLine: (i: number) => lines[i] ?? ""
	} as unknown as Editor;
}

interface FakeEditorOptions {
	selection?: string;
	value?: string;
	from?: EditorPosition;
	to?: EditorPosition;
}

function createEditor(options: FakeEditorOptions = {}): Editor {
	const from = options.from ?? { line: 0, ch: 0 };
	const to = options.to ?? { line: 0, ch: options.selection?.length ?? 0 };

	return {
		getSelection: () => options.selection ?? "",
		getValue: () => options.value ?? "",
		getCursor: (which?: "from" | "to") => which === "to" ? to : from,
		replaceRange: () => undefined
	} as unknown as Editor;
}

function createMarkdownInfo(editor: Editor, path = "Notes/Test.md"): MarkdownFileInfo {
	return {
		editor,
		file: {
			path,
			basename: path.split("/").pop()?.replace(/\.md$/, "") ?? "Test"
		}
	} as unknown as MarkdownFileInfo;
}

function createService(info: MarkdownFileInfo | null): SelectionService {
	const app = {
		workspace: {
			activeEditor: info,
			getActiveViewOfType: () => null
		}
	} as unknown as App;

	return new SelectionService(app);
}

describe("SelectionService", () => {
	it("captures selected text before considering current note fallback", () => {
		const editor = createEditor({
			selection: "selected text",
			value: "# Title\n\nfull note body",
			from: { line: 2, ch: 0 },
			to: { line: 2, ch: 13 }
		});
		const service = createService(createMarkdownInfo(editor));

		const result = service.captureCurrentContext(false);

		expect(result.error).toBeNull();
		expect(result.input?.source).toBe("selection");
		expect(result.input?.text).toBe("selected text");
		expect(result.input?.from).toEqual({ line: 2, ch: 0 });
		expect(result.input?.to).toEqual({ line: 2, ch: 13 });
	});

	it("blocks current note fallback when the setting is disabled", () => {
		const editor = createEditor({
			value: "# Daily\n\nA useful note body."
		});
		const service = createService(createMarkdownInfo(editor));

		const result = service.captureCurrentContext(false);

		expect(result.input).toBeNull();
		expect(result.error).toBe(
			"No selection captured. Enable current note fallback in settings, or paste text into Manual Input."
		);
	});

	it("uses cleaned current note body when fallback is enabled", () => {
		const editor = createEditor({
			value: "---\ntags:\n  - daily\n---\n# Daily Note\n\nFirst line.\nSecond line."
		});
		const service = createService(createMarkdownInfo(editor, "Daily/Daily Note.md"));

		const result = service.captureCurrentContext(true);

		expect(result.error).toBeNull();
		expect(result.input?.source).toBe("note");
		expect(result.input?.fileName).toBe("Daily Note");
		expect(result.input?.text).toBe("First line.\nSecond line.");
		expect(result.input?.from).toBeNull();
		expect(result.input?.to).toBeNull();
	});

	it("handles CRLF frontmatter and leading heading cleanup", () => {
		const editor = createEditor({
			value: "---\r\ntitle: Test\r\n---\r\n# Heading\r\n\r\nBody"
		});
		const service = createService(createMarkdownInfo(editor));

		const result = service.captureCurrentContext(true);

		expect(result.input?.text).toBe("Body");
	});

	it("returns an error when fallback is enabled but the cleaned note is empty", () => {
		const editor = createEditor({
			value: "---\ntitle: Empty\n---\n# Empty"
		});
		const service = createService(createMarkdownInfo(editor));

		const result = service.captureCurrentContext(true);

		expect(result.input).toBeNull();
		expect(result.error).toBe("Select text first or open a note with body text.");
	});

	it("verifies that the current selection still matches the captured input", () => {
		const editor = createEditor({
			selection: "same text",
			from: { line: 1, ch: 0 },
			to: { line: 1, ch: 9 }
		});
		const service = createService(createMarkdownInfo(editor, "Notes/Same.md"));
		const captured: CapturedInput = {
			source: "selection",
			text: "same text",
			filePath: "Notes/Same.md",
			fileName: "Same",
			from: { line: 1, ch: 0 },
			to: { line: 1, ch: 9 },
			wordCount: 2,
			characterCount: 9
		};

		const result = service.verifyCapturedSelection(captured);

		expect(result.error).toBeNull();
		expect(result.state?.editor).toBe(editor);
		expect(result.state?.from).toEqual({ line: 1, ch: 0 });
		expect(result.state?.to).toEqual({ line: 1, ch: 9 });
	});

	it("uses active editor file details when capturing from editor without a view", () => {
		const editor = createEditor({
			selection: "selected",
			from: { line: 0, ch: 0 },
			to: { line: 0, ch: 8 }
		});
		const service = createService(createMarkdownInfo(editor, "Notes/Fallback.md"));

		const result = service.captureFromEditor(editor, null);

		expect(result?.filePath).toBe("Notes/Fallback.md");
		expect(result?.fileName).toBe("Fallback");
	});

	it("rejects replacement when the selected text changed", () => {
		const editor = createEditor({
			selection: "changed",
			from: { line: 1, ch: 0 },
			to: { line: 1, ch: 7 }
		});
		const service = createService(createMarkdownInfo(editor, "Notes/Same.md"));

		const result = service.verifyCapturedSelection({
			source: "selection",
			text: "original",
			filePath: "Notes/Same.md",
			fileName: "Same",
			from: { line: 1, ch: 0 },
			to: { line: 1, ch: 8 },
			wordCount: 1,
			characterCount: 8
		});

		expect(result.state).toBeNull();
		expect(result.error).toBe("Selection changed. Please click Refresh selection before replacing.");
	});

	it("rejects replacement when the active file changed", () => {
		const editor = createEditor({
			selection: "same text",
			from: { line: 1, ch: 0 },
			to: { line: 1, ch: 9 }
		});
		const service = createService(createMarkdownInfo(editor, "Notes/New.md"));

		const result = service.verifyCapturedSelection({
			source: "selection",
			text: "same text",
			filePath: "Notes/Old.md",
			fileName: "Old",
			from: { line: 1, ch: 0 },
			to: { line: 1, ch: 9 },
			wordCount: 2,
			characterCount: 9
		});

		expect(result.state).toBeNull();
		expect(result.error).toBe("Active file changed. Please refresh selection.");
	});

	it("describes input with character and word counts", () => {
		expect(describeInput("one two")).toBe("7 chars / 2 words");
	});

	it("exports shared text counters", () => {
		expect(countWords("one two")).toBe(2);
		expect(countLines("one\ntwo")).toBe(2);
		expect(countLines("")).toBe(0);
	});
});

describe("captureNoteBodyAsSelection", () => {
	function createBodyEditor(value: string): { editor: Editor; getSelected: () => { from: EditorPosition; to: EditorPosition } | null } {
		const lines = value.split("\n");
		let selected: { from: EditorPosition; to: EditorPosition } | null = null;
		const editor = {
			lineCount: () => lines.length,
			getLine: (i: number) => lines[i] ?? "",
			getRange: (from: EditorPosition, to: EditorPosition) => {
				if (from.line === to.line) {
					return lines[from.line].slice(from.ch, to.ch);
				}
				const parts = [lines[from.line].slice(from.ch)];
				for (let i = from.line + 1; i < to.line; i++) {
					parts.push(lines[i]);
				}
				parts.push(lines[to.line].slice(0, to.ch));
				return parts.join("\n");
			},
			setSelection: (from: EditorPosition, to: EditorPosition) => {
				selected = { from, to };
			}
		} as unknown as Editor;
		return { editor, getSelected: () => selected };
	}

	it("selects the whole note body as a real selection (Replace/Insert stay usable)", () => {
		const { editor, getSelected } = createBodyEditor(
			"---\ntitle: T\n---\n# Title\n\nFirst body line.\nSecond body line."
		);
		const service = createService(createMarkdownInfo(editor, "Notes/Body.md"));

		const result = service.captureNoteBodyAsSelection();

		expect(result.error).toBeNull();
		expect(result.input?.source).toBe("selection");
		expect(result.input?.text).toBe("First body line.\nSecond body line.");
		expect(result.input?.from).toEqual({ line: 5, ch: 0 });
		expect(result.input?.to).toEqual({ line: 6, ch: "Second body line.".length });
		// It must actually move the editor selection so write-back verifies.
		expect(getSelected()).toEqual({
			from: { line: 5, ch: 0 },
			to: { line: 6, ch: "Second body line.".length }
		});
	});

	it("errors when there is no body text", () => {
		const { editor } = createBodyEditor("---\ntitle: Empty\n---\n# Empty\n\n");
		const service = createService(createMarkdownInfo(editor));

		const result = service.captureNoteBodyAsSelection();

		expect(result.input).toBeNull();
		expect(result.error).toBe("This note has no body text to capture.");
	});
});

describe("getNoteBodyRange", () => {
	it("skips frontmatter and a leading heading", () => {
		const editor = createLineEditor(
			"---\ntags:\n  - daily\n---\n# Title\n\nFirst body line.\nSecond body line."
		);

		const range = getNoteBodyRange(editor);

		expect(range.from).toEqual({ line: 6, ch: 0 });
		expect(range.to).toEqual({ line: 7, ch: "Second body line.".length });
	});

	it("starts at line 0 when there is no frontmatter or heading", () => {
		const editor = createLineEditor("Just body.\nMore body.");

		const range = getNoteBodyRange(editor);

		expect(range.from).toEqual({ line: 0, ch: 0 });
		expect(range.to).toEqual({ line: 1, ch: "More body.".length });
	});

	it("skips a leading heading without frontmatter", () => {
		const editor = createLineEditor("# Heading\n\nBody starts here.");

		const range = getNoteBodyRange(editor);

		expect(range.from).toEqual({ line: 2, ch: 0 });
		expect(range.to).toEqual({ line: 2, ch: "Body starts here.".length });
	});
});
