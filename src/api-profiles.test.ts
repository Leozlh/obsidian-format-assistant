import { describe, expect, it } from "vitest";
import {
	applyApiProfile,
	createApiProfileFromSettings,
	normalizeApiProfiles
} from "./api-profiles";
import { DEFAULT_SETTINGS } from "./settings-types";

describe("API profiles", () => {
	it("round-trips compatibility flags, mode limits, and a secret reference", () => {
		const settings = {
			...DEFAULT_SETTINGS,
			apiKey: "runtime-only",
			apiKeyRef: "secret-ref",
			omitTemperature: true,
			useMaxCompletionTokens: true,
			modeRuntime: {
				...DEFAULT_SETTINGS.modeRuntime,
				"note-organize": { maxTokens: 4321, timeoutSeconds: 123 }
			}
		};
		const profile = createApiProfileFromSettings(settings, "Complete");
		const target = structuredClone(DEFAULT_SETTINGS);

		applyApiProfile(target, profile);

		expect(profile).not.toHaveProperty("apiKey");
		expect(target.apiKeyRef).toBe("secret-ref");
		expect(target.omitTemperature).toBe(true);
		expect(target.useMaxCompletionTokens).toBe(true);
		expect(target.modeRuntime["note-organize"]).toEqual({ maxTokens: 4321, timeoutSeconds: 123 });
	});

	it("rejects legacy or malformed profiles containing no secret reference", () => {
		expect(normalizeApiProfiles([{ id: "legacy", apiKey: "plaintext" }])).toEqual([]);
	});
});
