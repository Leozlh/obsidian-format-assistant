import { EditorPosition, MarkdownFileInfo } from "obsidian";

export interface ActiveSelectionPreview {
	fileName: string;
	filePath: string | null;
	text: string;
	wordCount: number;
	characterCount: number;
	from: EditorPosition | null;
	to: EditorPosition | null;
}

export function getActiveSelectionPreview(info: MarkdownFileInfo | null): ActiveSelectionPreview {
	const text = info?.editor?.getSelection() ?? "";
	return {
		fileName: info?.file?.basename ?? "No active Markdown file",
		filePath: info?.file?.path ?? null,
		text,
		wordCount: countWords(text),
		characterCount: text.length,
		from: info?.editor ? info.editor.getCursor("from") : null,
		to: info?.editor ? info.editor.getCursor("to") : null
	};
}

export function describeSelection(text: string): string {
	return `${text.length} chars / ${countWords(text)} words`;
}

function countWords(text: string): number {
	return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}
