import { describe, expect, it } from "vitest";
import { buildModePrompt, FORMAT_MODES, resolveModeRuntime } from "./prompts";
import {
	MAX_RECENT_INSTRUCTIONS,
	normalizeModeRuntime,
	normalizeRecentInstructions,
	pushRecentInstruction
} from "./settings-types";

describe("buildModePrompt", () => {
	it("note-organize keeps the structured heading template", () => {
		const prompt = buildModePrompt("note-organize");
		expect(prompt).toContain("## 核心内容");
		expect(prompt).toContain("## 待追问问题");
	});

	it("obsidian-markdown stays a light formatting prompt", () => {
		expect(buildModePrompt("obsidian-markdown")).toContain("轻量整理");
		expect(buildModePrompt("obsidian-markdown")).not.toContain("## 核心内容");
	});

	it("diary-organize preserves timeline, judges tasks, and keeps every task unchecked", () => {
		const prompt = buildModePrompt("diary-organize");
		expect(prompt).toContain("日记整理模式");
		expect(prompt).toContain("时间顺序");
		// task vs life-record judgment; all tasks stay - [ ], never auto-completed
		expect(prompt).toContain("生活记录");
		expect(prompt).toContain("绝不要自动标成");
		// even an item that says "做完" stays unchecked in the example
		expect(prompt).toContain("- [ ] 原子做完");
		expect(prompt).not.toContain("## 待办");
	});

	it("exam-quiz extracts points and emits foldable self-test answers", () => {
		const prompt = buildModePrompt("exam-quiz");
		expect(prompt).toContain("考点自测模式");
		expect(prompt).toContain("## 考点清单");
		expect(prompt).toContain("## 自测题");
		// foldable answer callout
		expect(prompt).toContain("[!success]-");
		// anti-hallucination guard
		expect(prompt).toContain("绝不编造");
	});
});

describe("FORMAT_MODES", () => {
	it("contains the core modes, exam-quiz, plus custom", () => {
		expect(FORMAT_MODES).toEqual([
			"obsidian-markdown",
			"note-organize",
			"diary-organize",
			"exam-quiz",
			"custom"
		]);
	});
});

describe("resolveModeRuntime", () => {
	const settings = { maxTokens: 1200, timeoutSeconds: 30 };

	it("gives note-organize a larger budget and longer timeout", () => {
		expect(resolveModeRuntime("note-organize", settings)).toEqual({
			maxTokens: 2000,
			timeoutSeconds: 60
		});
	});

	it("uses standard limits for diary-organize", () => {
		expect(resolveModeRuntime("diary-organize", settings)).toEqual({
			maxTokens: 900,
			timeoutSeconds: 30
		});
	});

	it("gives exam-quiz a larger budget for points + questions", () => {
		expect(resolveModeRuntime("exam-quiz", settings)).toEqual({
			maxTokens: 2000,
			timeoutSeconds: 60
		});
	});

	it("falls back to global settings for unlisted modes", () => {
		expect(resolveModeRuntime("obsidian-markdown", settings)).toEqual({
			maxTokens: 1200,
			timeoutSeconds: 30
		});
		expect(resolveModeRuntime("custom", settings)).toEqual({
			maxTokens: 1200,
			timeoutSeconds: 30
		});
	});

	it("lets a per-mode setting override the built-in default", () => {
		const withOverride = {
			maxTokens: 1200,
			timeoutSeconds: 30,
			modeRuntime: {
				"note-organize": { maxTokens: 3500, timeoutSeconds: 90 },
				"obsidian-markdown": { maxTokens: 800, timeoutSeconds: 20 }
			}
		};
		expect(resolveModeRuntime("note-organize", withOverride)).toEqual({
			maxTokens: 3500,
			timeoutSeconds: 90
		});
		// editable mode now adjustable even though it has no built-in default
		expect(resolveModeRuntime("obsidian-markdown", withOverride)).toEqual({
			maxTokens: 800,
			timeoutSeconds: 20
		});
	});
});

describe("recent instructions", () => {
	it("moves a used instruction to the front, de-duped and capped", () => {
		let list: string[] = [];
		list = pushRecentInstruction(list, "keep concise");
		list = pushRecentInstruction(list, "preserve tone");
		list = pushRecentInstruction(list, "keep concise"); // re-use bubbles to front
		expect(list).toEqual(["keep concise", "preserve tone"]);

		list = pushRecentInstruction(list, "a");
		list = pushRecentInstruction(list, "b"); // exceeds cap of 3
		expect(list).toHaveLength(MAX_RECENT_INSTRUCTIONS);
		expect(list[0]).toBe("b");
	});

	it("ignores blank instructions", () => {
		expect(pushRecentInstruction(["x"], "   ")).toEqual(["x"]);
	});

	it("normalizes junk, trims, de-dupes, and caps on load", () => {
		expect(
			normalizeRecentInstructions(["  a  ", "a", "", 5, "b", "c", "d"])
		).toEqual(["a", "b", "c"]);
		expect(normalizeRecentInstructions("nope")).toEqual([]);
	});
});

describe("normalizeModeRuntime", () => {
	it("seeds defaults and keeps valid user values, dropping invalid ones", () => {
		const out = normalizeModeRuntime({
			"note-organize": { maxTokens: 3000, timeoutSeconds: -5 },
			"diary-organize": { maxTokens: "abc", timeoutSeconds: 45 }
		});
		expect(out["note-organize"]).toEqual({ maxTokens: 3000, timeoutSeconds: 60 });
		expect(out["diary-organize"]).toEqual({ maxTokens: 900, timeoutSeconds: 45 });
		expect(out["obsidian-markdown"]).toEqual({ maxTokens: 1200, timeoutSeconds: 30 });
	});
});
