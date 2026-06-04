import type { FormatAssistantSettings, ModeLimit, ProviderType } from "./settings-types";
import type { FormatMode } from "./prompts";

export interface ApiProfile {
	id: string;
	name: string;
	baseUrl: string;
	apiKeyRef: string;
	model: string;
	maxTokens: number;
	temperature: number;
	providerType: ProviderType;
	timeoutSeconds: number;
	omitTemperature: boolean;
	useMaxCompletionTokens: boolean;
	modeRuntime: Partial<Record<FormatMode, ModeLimit>>;
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
		apiKeyRef: settings.apiKeyRef,
		model: settings.model,
		maxTokens: settings.maxTokens,
		temperature: settings.temperature,
		providerType: settings.providerType,
		timeoutSeconds: settings.timeoutSeconds,
		omitTemperature: settings.omitTemperature,
		useMaxCompletionTokens: settings.useMaxCompletionTokens,
		modeRuntime: structuredClone(settings.modeRuntime)
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
					typeof item.apiKeyRef === "string" &&
					typeof item.model === "string" &&
					typeof item.maxTokens === "number" &&
					typeof item.temperature === "number" &&
					item.providerType === "openai-compatible" &&
					typeof item.timeoutSeconds === "number" &&
					typeof item.omitTemperature === "boolean" &&
					typeof item.useMaxCompletionTokens === "boolean" &&
					typeof item.modeRuntime === "object" && item.modeRuntime !== null
			);
		})
		.slice(0, MAX_API_PROFILES);
}

export function applyApiProfile(
	settings: FormatAssistantSettings,
	profile: ApiProfile
): void {
	settings.baseUrl = profile.baseUrl;
	settings.apiKeyRef = profile.apiKeyRef;
	settings.model = profile.model;
	settings.maxTokens = profile.maxTokens;
	settings.temperature = profile.temperature;
	settings.providerType = profile.providerType;
	settings.timeoutSeconds = profile.timeoutSeconds;
	settings.omitTemperature = profile.omitTemperature;
	settings.useMaxCompletionTokens = profile.useMaxCompletionTokens;
	settings.modeRuntime = structuredClone(profile.modeRuntime);
	settings.activeApiProfileId = profile.id;
}

function toProfileName(name: string, settings: FormatAssistantSettings): string {
	const normalized = name.trim();
	if (normalized) {
		return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
	}

	return settings.model.trim() || "API Profile";
}
