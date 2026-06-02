import { buildMessages, type PromptOptions, type ChatMessage } from "./prompts";
import type { FormatAssistantSettings } from "./settings";

interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
	error?: {
		message?: string;
		type?: string;
	};
}

export async function callChatCompletions(
	settings: FormatAssistantSettings,
	promptOptions: PromptOptions
): Promise<string> {
	const controller = new AbortController();
	const timeout = window.setTimeout(
		() => controller.abort(),
		settings.timeoutSeconds * 1000
	);

	try {
		const response = await fetch(chatCompletionsUrl(settings.baseUrl), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${settings.apiKey}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				model: settings.model,
				messages: buildMessages(settings.systemPrompt, promptOptions) satisfies ChatMessage[],
				temperature: settings.temperature,
				max_tokens: settings.maxTokens
			}),
			signal: controller.signal
		});

		const text = await response.text();
		const data = parseJsonResponse(text);

		if (!response.ok) {
			throw new Error(statusToMessage(response.status, data));
		}

		const content = data.choices?.[0]?.message?.content;
		if (!content || typeof content !== "string") {
			throw new Error("API returned an unexpected response format.");
		}

		return content.trim();
	} finally {
		window.clearTimeout(timeout);
	}
}

function chatCompletionsUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function parseJsonResponse(text: string): ChatCompletionResponse {
	if (!text.trim()) {
		return {};
	}

	try {
		return JSON.parse(text) as ChatCompletionResponse;
	} catch {
		throw new Error("API returned invalid JSON.");
	}
}

function statusToMessage(status: number, data: ChatCompletionResponse): string {
	const apiMessage = data.error?.message;

	if (status === 401 || status === 403) {
		return "API authentication failed. Check your API key and access permissions.";
	}

	if (status === 429) {
		return "API rate limit reached. Please wait and try again.";
	}

	if (status >= 500) {
		return "API server error. Please try again later.";
	}

	return apiMessage
		? `API request failed: ${apiMessage}`
		: `API request failed with status ${status}.`;
}
