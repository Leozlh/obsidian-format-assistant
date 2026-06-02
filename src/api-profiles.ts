import type { FormatAssistantSettings, ProviderType } from "./settings";

export interface ApiProfile {
	id: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	model: string;
	maxTokens: number;
	temperature: number;
	providerType: ProviderType;
	timeoutSeconds: number;
}

export const MAX_API_PROFILES = 8;

export function createApiProfileFromSettings(
	settings: FormatAssistantSettings,
	name: string
): ApiProfile {
	return {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		name: toProfileName(name, settings),
		baseUrl: settings.baseUrl,
		apiKey: settings.apiKey,
		model: settings.model,
		maxTokens: settings.maxTokens,
		temperature: settings.temperature,
		providerType: settings.providerType,
		timeoutSeconds: settings.timeoutSeconds
	};
}

export function normalizeApiProfiles(value: unknown): ApiProfile[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((item): item is ApiProfile => {
			return Boolean(
				item &&
					typeof item.id === "string" &&
					typeof item.name === "string" &&
					typeof item.baseUrl === "string" &&
					typeof item.apiKey === "string" &&
					typeof item.model === "string" &&
					typeof item.maxTokens === "number" &&
					typeof item.temperature === "number" &&
					item.providerType === "openai-compatible" &&
					typeof item.timeoutSeconds === "number"
			);
		})
		.slice(0, MAX_API_PROFILES);
}

export function applyApiProfile(
	settings: FormatAssistantSettings,
	profile: ApiProfile
): void {
	settings.baseUrl = profile.baseUrl;
	settings.apiKey = profile.apiKey;
	settings.model = profile.model;
	settings.maxTokens = profile.maxTokens;
	settings.temperature = profile.temperature;
	settings.providerType = profile.providerType;
	settings.timeoutSeconds = profile.timeoutSeconds;
	settings.activeApiProfileId = profile.id;
}

function toProfileName(name: string, settings: FormatAssistantSettings): string {
	const normalized = name.trim();
	if (normalized) {
		return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
	}

	return settings.model.trim() || "API Profile";
}
