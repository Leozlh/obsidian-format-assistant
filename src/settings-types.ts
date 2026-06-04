import {
	normalizeApiProfiles,
	type ApiProfile
} from "./api-profiles";
import { BASE_SYSTEM_PROMPT, type FormatMode } from "./prompts";
import { normalizePromptPresets, type PromptPreset } from "./sidebar-presets";

export type ProviderType = "openai-compatible";

export interface ModeLimit {
	maxTokens: number;
	timeoutSeconds: number;
}

// Modes whose per-mode token/timeout are user-editable in settings.
export const EDITABLE_RUNTIME_MODES: FormatMode[] = [
	"obsidian-markdown",
	"note-organize",
	"diary-organize"
];

const DEFAULT_MODE_RUNTIME: Record<string, ModeLimit> = {
	"obsidian-markdown": { maxTokens: 1200, timeoutSeconds: 30 },
	"note-organize": { maxTokens: 2000, timeoutSeconds: 60 },
	"diary-organize": { maxTokens: 900, timeoutSeconds: 30 }
};

export interface FormatAssistantSettings {
	baseUrl: string;
	apiKey: string;
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
	promptPresets: PromptPreset[];
	apiProfiles: ApiProfile[];
	activeApiProfileId: string;
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

export const DEFAULT_SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;

export const DEFAULT_SETTINGS: FormatAssistantSettings = {
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
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
		"diary-organize": { maxTokens: 900, timeoutSeconds: 30 }
	},
	sidebarDefaultMode: "obsidian-markdown",
	autoUseSelectionOnSidebarOpen: false,
	includeCurrentFileNameInPrompt: true,
	includeFullCurrentNote: false,
	promptPresets: [],
	apiProfiles: [],
	activeApiProfileId: ""
};

export function normalizeSettings(data: unknown): FormatAssistantSettings {
	const raw = typeof data === "object" && data !== null
		? data as Partial<FormatAssistantSettings>
		: {};

	return {
		...DEFAULT_SETTINGS,
		...raw,
		modeRuntime: normalizeModeRuntime(raw.modeRuntime),
		promptPresets: normalizePromptPresets(raw.promptPresets),
		apiProfiles: normalizeApiProfiles(raw.apiProfiles),
		activeApiProfileId: typeof raw.activeApiProfileId === "string"
			? raw.activeApiProfileId
			: ""
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
