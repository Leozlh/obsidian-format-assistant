import { MarkdownView } from "obsidian";

export interface ActiveSelectionPreview {
	fileName: string;
	text: string;
	wordCount: number;
	characterCount: number;
}

export function getActiveSelectionPreview(view: MarkdownView | null): ActiveSelectionPreview {
	const text = view?.editor.getSelection() ?? "";
	return {
		fileName: view?.file?.basename ?? "No active Markdown file",
		text,
		wordCount: countWords(text),
		characterCount: text.length
	};
}

function countWords(text: string): number {
	return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}
