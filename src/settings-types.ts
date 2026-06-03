import {
	normalizeApiProfiles,
	type ApiProfile
} from "./api-profiles";
import { BASE_SYSTEM_PROMPT, type FormatMode } from "./prompts";
import { normalizePromptPresets, type PromptPreset } from "./sidebar-presets";

export type ProviderType = "openai-compatible";

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
	sidebarDefaultMode: FormatMode;
	autoUseSelectionOnSidebarOpen: boolean;
	includeCurrentFileNameInPrompt: boolean;
	includeFullCurrentNote: boolean;
	promptPresets: PromptPreset[];
	apiProfiles: ApiProfile[];
	activeApiProfileId: string;
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
