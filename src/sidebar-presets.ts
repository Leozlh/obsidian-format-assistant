export interface PromptPreset {
	id: string;
	name: string;
	content: string;
}

export const MAX_PROMPT_PRESETS = 5;

export function createPromptPreset(content: string): PromptPreset {
	const normalized = content.trim();
	return {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		name: toPresetName(normalized),
		content: normalized
	};
}

export function normalizePromptPresets(value: unknown): PromptPreset[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((item): item is PromptPreset => {
			return Boolean(
				item &&
					typeof item.id === "string" &&
					typeof item.name === "string" &&
					typeof item.content === "string" &&
					item.content.trim()
			);
		})
		.slice(0, MAX_PROMPT_PRESETS);
}

function toPresetName(content: string): string {
	const firstLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "Prompt";
	return firstLine.length > 28 ? `${firstLine.slice(0, 28)}...` : firstLine;
}
