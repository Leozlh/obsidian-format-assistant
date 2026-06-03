import { describe, expect, it } from "vitest";
import { buildModePrompt, resolveModeRuntime } from "./prompts";

describe("buildModePrompt", () => {
	it("course-note now reuses the structured note-organize prompt", () => {
		expect(buildModePrompt("course-note")).toBe(buildModePrompt("note-organize"));
	});

	it("note-organize keeps the structured heading template", () => {
		const prompt = buildModePrompt("note-organize");
		expect(prompt).toContain("## 核心内容");
		expect(prompt).toContain("## 待追问问题");
	});

	it("obsidian-markdown stays a light formatting prompt", () => {
		expect(buildModePrompt("obsidian-markdown")).toContain("轻量整理");
		expect(buildModePrompt("obsidian-markdown")).not.toContain("## 核心内容");
	});

	it("diary-organize preserves timeline, judges tasks, and tracks status", () => {
		const prompt = buildModePrompt("diary-organize");
		expect(prompt).toContain("日记整理模式");
		expect(prompt).toContain("时间顺序");
		expect(prompt).toContain("- [x]");
		// task vs life-record judgment + default-to-todo for unmarked tasks
		expect(prompt).toContain("生活记录");
		expect(prompt).toContain("默认 - [ ]");
		expect(prompt).not.toContain("## 待办");
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

	it("applies the same override to course-note", () => {
		expect(resolveModeRuntime("course-note", settings)).toEqual({
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
});
