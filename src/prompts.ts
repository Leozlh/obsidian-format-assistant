export type FormatMode =
	| "obsidian-markdown"
	| "note-organize"
	| "diary-organize"
	| "custom";

export interface FormatTask {
	id: string;
	name: string;
	mode: Exclude<FormatMode, "custom">;
}

export interface PromptOptions {
	mode: FormatMode;
	selectedText: string;
	inputSource?: "selection" | "manual" | "note";
	customInstruction?: string;
	currentFileName?: string;
}

export interface ChatMessage {
	role: "system" | "user";
	content: string;
}

export const BASE_SYSTEM_PROMPT = `你是 Obsidian Markdown 笔记整理助手。

通用规则：
1. 只处理用户提供的输入文本本身。
2. 不要添加输入文本中不存在的事实。
3. 不要编造日期、人物、地点、标题、标签、结论。
4. 不要添加 frontmatter。
5. 不要添加 date、tags、title 等元数据。
6. 不要根据文件名推断日期或标题。
7. 不要补全模板。
8. 不要输出 bash、shell、终端命令。
9. 不要解释你的处理过程。
10. 不要输出“下面是整理结果”等额外开头。
11. 只输出最终 Markdown。
12. 保留原意。
13. 可以做适度分段、列表化、标题层级调整和轻微措辞清理。
14. 保持 Obsidian 兼容：
    - wikilink 保持为 [[...]]
    - task 保持为 - [ ] / - [x]
    - callout 保持为 > [!type]
    - Markdown 标题使用 # 层级
15. 如果输入文本很短，不要强行扩展成复杂结构。`;

export const OBSIDIAN_MARKDOWN_PROMPT = `你正在执行“Obsidian Markdown 轻量整理模式”。

整理目标：
1. 只做基础 Markdown 格式整理。
2. 优先改善断句、分段、列表和标题层级。
3. 不要生成复杂结构。
4. 不要添加输入中不存在的 frontmatter、标题、模板小节或元数据。
5. 如果输入很短，只输出更清楚的原文整理版。`;

export const NOTE_ORGANIZE_PROMPT = `你正在执行“笔记整理模式”。

整理目标：
1. 将输入内容整理成清晰的 Obsidian Markdown 笔记。
2. 优先提炼概念、公式、结论、条件、易错点和待追问问题。
3. 如果输入中包含公式，请保留公式，并补充适用条件。
4. 如果输入中包含推导，请保留关键步骤，不要跳得太大。
5. 如果输入中包含多个概念，请用小标题分层。
6. 如果输入内容较短，只做轻量整理，不要强行生成完整章节。
7. 不要添加输入中不存在的知识点。
8. 不要补充未经输入支持的背景介绍。

推荐输出结构：
如果输入内容较完整，可使用：

## 核心内容

## 关键公式与条件

## 易错点

## 待追问问题

但如果输入很短，可以只使用列表，不要强行生成所有标题。`;

export const DIARY_ORGANIZE_PROMPT = `你正在执行“日记整理模式”。

整理目标：
1. 保留用户原始语气和真实感，不要改得太正式，不要添加情绪判断或心理分析，不要扩写成鸡汤或总结。
2. 不要添加 frontmatter、日期标题，或输入中不存在的内容。

结构处理：
3. 如果原文带有时间线索（早 / 上午 / 下午 / 晚 / 具体时间），请保留这个时间顺序作为主结构，不要打散重排。
4. 默认只做轻量整理：分行、把同一时段的事项理顺。输入很短时不要添加 ## 小标题。

任务判定（关键）：
5. 先判断每条属于“任务”还是“生活记录”：
   - 任务：可执行的学习 / 工作事项，例如做作业、复习、写报告、做项目、推进某件事。
   - 生活记录：起床、吃饭、拿快递、身体状态、心情等。
6. 所有“任务”一律标成未完成待办 - [ ]，由用户之后自己勾选。即使原文写了“做完 / 完成”，也用 - [ ]，绝不要自动标成 - [x]。
7. 保留用户原有批注（如“实际：没做”），不要替换成模板词。
8. 对“生活记录”保持普通 bullet，不要转成 checkbox。
9. 只整理原文已有的事项，不要凭空编造任务。

示例：
输入：
上午：原子做完，复习第三章（实际：没做）
下午：写大物报告
输出：
- 上午：
  - [ ] 原子做完
  - [ ] 复习第三章（实际：没做）
- 下午：
  - [ ] 写大物报告`;

export interface ModeRuntime {
	maxTokens?: number;
	timeoutSeconds?: number;
}

// Per-mode overrides for token budget and request timeout.
// Modes not listed here fall back to the global settings values.
export const MODE_RUNTIME: Partial<Record<FormatMode, ModeRuntime>> = {
	// note-organize produces longer structured output -> larger budget, longer wait.
	"note-organize": { maxTokens: 2000, timeoutSeconds: 60 },
	// diary output is usually shorter and faster.
	"diary-organize": { maxTokens: 900, timeoutSeconds: 30 }
};

export function resolveModeRuntime(
	mode: FormatMode,
	settings: {
		maxTokens: number;
		timeoutSeconds: number;
		modeRuntime?: Partial<Record<FormatMode, ModeRuntime>>;
	}
): { maxTokens: number; timeoutSeconds: number } {
	// User per-mode setting wins; else the built-in default; else global.
	const override = settings.modeRuntime?.[mode] ?? MODE_RUNTIME[mode] ?? {};
	return {
		maxTokens: override.maxTokens ?? settings.maxTokens,
		timeoutSeconds: override.timeoutSeconds ?? settings.timeoutSeconds
	};
}

export const FORMAT_MODES: FormatMode[] = [
	"obsidian-markdown",
	"note-organize",
	"diary-organize",
	"custom"
];

export const FORMAT_MODE_LABELS: Record<FormatMode, string> = {
	"obsidian-markdown": "Obsidian Markdown",
	"note-organize": "Note Organize",
	"diary-organize": "Diary Organize",
	custom: "Custom Instruction"
};

export const FORMAT_TASKS: FormatTask[] = [
	{
		id: "format-selection-as-obsidian-markdown",
		name: "Format selection as Obsidian Markdown",
		mode: "obsidian-markdown"
	},
	{
		id: "organize-selection-as-note",
		name: "Organize selection as note",
		mode: "note-organize"
	},
	{
		id: "organize-selection-as-diary",
		name: "Organize selection as diary",
		mode: "diary-organize"
	}
];

export function buildPromptMessages(
	systemPrompt: string,
	options: PromptOptions
): ChatMessage[] {
	return [
		{
			role: "system",
			content: systemPrompt.trim() || BASE_SYSTEM_PROMPT
		},
		{
			role: "user",
			content: buildUserPrompt(options)
		}
	];
}

export function buildMessages(systemPrompt: string, options: PromptOptions): ChatMessage[] {
	return buildPromptMessages(systemPrompt, options);
}

export function buildUserPrompt(options: PromptOptions): string {
	return [
		buildModePrompt(options.mode),
		buildUserInstructionBlock(options),
		buildContextBlock(options),
		buildInputBlock(options.selectedText)
	].filter(Boolean).join("\n\n");
}

export function buildModePrompt(mode: FormatMode): string {
	if (mode === "obsidian-markdown") {
		return OBSIDIAN_MARKDOWN_PROMPT;
	}

	if (mode === "note-organize") {
		return NOTE_ORGANIZE_PROMPT;
	}

	if (mode === "diary-organize") {
		return DIARY_ORGANIZE_PROMPT;
	}

	return "你正在执行“自定义指令模式”。请按用户临时 instruction 处理输入文本，但仍必须遵守 system message 中的通用规则。";
}

export function buildUserInstructionBlock(options: PromptOptions): string {
	const instruction = options.customInstruction?.trim();
	if (!instruction) {
		return "";
	}

	return `用户临时 instruction：\n${instruction}`;
}

export function buildInputBlock(selectedText: string): string {
	return `输入文本：\n${selectedText}`;
}

function buildContextBlock(options: PromptOptions): string {
	const sections: string[] = [];

	if (options.currentFileName?.trim()) {
		sections.push(`当前文件名：${options.currentFileName.trim()}`);
	}

	if (options.inputSource) {
		sections.push(
			inputSourceLabel(options.inputSource)
		);
	}

	return sections.length ? `上下文信息：\n${sections.join("\n")}` : "";
}

function inputSourceLabel(source: NonNullable<PromptOptions["inputSource"]>): string {
	if (source === "manual") {
		return "输入来源：Manual input（用户在侧栏手动粘贴或输入的文本）";
	}

	if (source === "note") {
		return "输入来源：Current note fallback（当前 Markdown 文件正文，已移除开头 frontmatter 和一级标题）";
	}

	return "输入来源：Captured selection（Obsidian 编辑器中的选中文本）";
}
