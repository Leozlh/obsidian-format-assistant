import {
	normalizeApiProfiles,
	normalizeApiSettingsSnapshot,
	type ApiProfile,
	type ApiSettingsSnapshot
} from "./api-profiles";
import { BASE_SYSTEM_PROMPT, type FormatMode } from "./prompts";

export type ProviderType = "openai-compatible";

export interface ModeLimit {
	maxTokens: number;
	timeoutSeconds: number;
}

// Modes whose per-mode token/timeout are user-editable in settings.
export const EDITABLE_RUNTIME_MODES: FormatMode[] = [
	"obsidian-markdown",
	"note-organize",
	"diary-organize",
	"exam-quiz"
];

const DEFAULT_MODE_RUNTIME: Record<string, ModeLimit> = {
	"obsidian-markdown": { maxTokens: 1200, timeoutSeconds: 30 },
	"note-organize": { maxTokens: 2000, timeoutSeconds: 60 },
	"diary-organize": { maxTokens: 900, timeoutSeconds: 30 },
	"exam-quiz": { maxTokens: 2000, timeoutSeconds: 60 }
};

export interface FormatAssistantSettings {
	baseUrl: string;
	apiKey: string;
	apiKeyRef: string;
	model: string;
	maxTokens: number;
	temperature: number;
	providerType: ProviderType;
	systemPrompt: string;
	previewBeforeReplace: boolean;
	timeoutSeconds: number;
	// Compatibility toggles for stricter providers (e.g. OpenAI o-series):
	omitTemperature: boolean;
	useMaxCompletionTokens: boolean;
	// Per-mode token/timeout overrides (fall back to global maxTokens/timeout):
	modeRuntime: Partial<Record<FormatMode, ModeLimit>>;
	sidebarDefaultMode: FormatMode;
	autoUseSelectionOnSidebarOpen: boolean;
	includeCurrentFileNameInPrompt: boolean;
	includeFullCurrentNote: boolean;
	// Lightweight history of the last few Instruction texts (quick re-pick):
	recentInstructions: string[];
	apiProfiles: ApiProfile[];
	activeApiProfileId: string;
	manualApiSettings: ApiSettingsSnapshot | null;
}

function positiveInt(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export function normalizeModeRuntime(value: unknown): Partial<Record<FormatMode, ModeLimit>> {
	const raw = typeof value === "object" && value !== null
		? (value as Record<string, { maxTokens?: unknown; timeoutSeconds?: unknown }>)
		: {};
	const result: Partial<Record<FormatMode, ModeLimit>> = {};
	for (const mode of EDITABLE_RUNTIME_MODES) {
		const def = DEFAULT_MODE_RUNTIME[mode];
		const entry = raw[mode];
		result[mode] = {
			maxTokens: positiveInt(entry?.maxTokens, def.maxTokens),
			timeoutSeconds: positiveInt(entry?.timeoutSeconds, def.timeoutSeconds)
		};
	}
	return result;
}

export const MAX_RECENT_INSTRUCTIONS = 3;

export function normalizeRecentInstructions(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") {
			continue;
		}
		const text = item.trim();
		if (!text || seen.has(text)) {
			continue;
		}
		seen.add(text);
		result.push(text);
		if (result.length >= MAX_RECENT_INSTRUCTIONS) {
			break;
		}
	}
	return result;
}

// Returns a new list with `instruction` moved to the front, de-duplicated and
// capped at MAX_RECENT_INSTRUCTIONS.
export function pushRecentInstruction(list: string[], instruction: string): string[] {
	const text = instruction.trim();
	if (!text) {
		return list;
	}
	return [text, ...list.filter((item) => item !== text)].slice(0, MAX_RECENT_INSTRUCTIONS);
}

export const DEFAULT_SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;

export const DEFAULT_SETTINGS: FormatAssistantSettings = {
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	apiKeyRef: "",
	model: "gpt-4o-mini",
	maxTokens: 1200,
	temperature: 0.2,
	providerType: "openai-compatible",
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	previewBeforeReplace: true,
	timeoutSeconds: 30,
	omitTemperature: false,
	useMaxCompletionTokens: false,
	modeRuntime: {
		"obsidian-markdown": { maxTokens: 1200, timeoutSeconds: 30 },
		"note-organize": { maxTokens: 2000, timeoutSeconds: 60 },
		"diary-organize": { maxTokens: 900, timeoutSeconds: 30 },
		"exam-quiz": { maxTokens: 2000, timeoutSeconds: 60 }
	},
	sidebarDefaultMode: "obsidian-markdown",
	autoUseSelectionOnSidebarOpen: false,
	includeCurrentFileNameInPrompt: true,
	includeFullCurrentNote: false,
	recentInstructions: [],
	apiProfiles: [],
	activeApiProfileId: "",
	manualApiSettings: null
};

export function normalizeSettings(data: unknown): FormatAssistantSettings {
	const raw = typeof data === "object" && data !== null
		? data as Partial<FormatAssistantSettings>
		: {};

	return {
		...DEFAULT_SETTINGS,
		...raw,
		modeRuntime: normalizeModeRuntime(raw.modeRuntime),
		recentInstructions: normalizeRecentInstructions(raw.recentInstructions),
		apiProfiles: normalizeApiProfiles(raw.apiProfiles),
		activeApiProfileId: typeof raw.activeApiProfileId === "string"
			? raw.activeApiProfileId
			: "",
		manualApiSettings: normalizeApiSettingsSnapshot(raw.manualApiSettings)
	};
}

export function validateApiSettings(settings: FormatAssistantSettings): string | null {
	if (!settings.baseUrl.trim()) {
		return "API Base URL is required.";
	}

	if (settings.baseUrl.replace(/\/+$/, "").endsWith("/chat/completions")) {
		return "Base URL should not include /chat/completions. Use the API root such as https://example.com/v1.";
	}

	if (!settings.apiKey.trim()) {
		return "API key is required.";
	}

	if (!settings.model.trim()) {
		return "Model is required.";
	}

	if (settings.maxTokens < 1) {
		return "Max Tokens must be greater than 0.";
	}

	if (settings.timeoutSeconds < 1) {
		return "Timeout seconds must be greater than 0.";
	}

	return null;
}
