export type FormatMode =
	| "obsidian-markdown"
	| "course-note"
	| "review-card"
	| "wiki-candidates"
	| "concise"
	| "custom";

export interface FormatTask {
	id: string;
	name: string;
	mode: Exclude<FormatMode, "custom">;
}

export interface PromptOptions {
	mode: FormatMode;
	selectedText: string;
	customInstruction?: string;
	currentFileName?: string;
}

export interface ChatMessage {
	role: "system" | "user";
	content: string;
}

export const FORMAT_MODES: FormatMode[] = [
	"obsidian-markdown",
	"course-note",
	"review-card",
	"wiki-candidates",
	"concise",
	"custom"
];

export const FORMAT_MODE_LABELS: Record<FormatMode, string> = {
	"obsidian-markdown": "Obsidian Markdown",
	"course-note": "Course Note",
	"review-card": "Review Card",
	"wiki-candidates": "Wiki Candidates",
	concise: "Concise",
	custom: "Custom Instruction"
};

export const FORMAT_TASKS: FormatTask[] = [
	{
		id: "format-selection-as-obsidian-markdown",
		name: "Format selection as Obsidian Markdown",
		mode: "obsidian-markdown"
	},
	{
		id: "format-selection-as-course-note",
		name: "Format selection as course note",
		mode: "course-note"
	},
	{
		id: "compress-selection-into-review-card",
		name: "Compress selection into review card",
		mode: "review-card"
	},
	{
		id: "generate-wiki-candidates",
		name: "Generate Wiki candidates",
		mode: "wiki-candidates"
	},
	{
		id: "make-selection-concise",
		name: "Make selection concise",
		mode: "concise"
	}
];

const TASK_PROMPTS: Record<FormatMode, string> = {
	"obsidian-markdown":
		"请将输入文本整理为清晰、规范、适合 Obsidian 的 Markdown。保留原意、公式、条件、wikilink、tag、callout 和 frontmatter。",
	"course-note": `请将输入文本整理为课程笔记，严格使用以下 Markdown 结构：
## 核心概念
## 公式与条件
## 典型题入口
## 易错点
## 待追问问题`,
	"review-card": `请将输入文本压缩为 Obsidian callout 复习卡片，严格使用以下结构：
> [!summary] 复习卡片
> - 核心结论：
> - 适用条件：
> - 典型题型：
> - 易错点：`,
	"wiki-candidates": `请根据输入文本生成最多 10 条 Wiki 候选条目，严格输出 Markdown 表格：
| 类型 | 候选标题 | 来源依据 | 为什么值得沉淀 |
|---|---|---|---|

类型只能从以下选项中选择：
Concept, Formula, Method, Theorem, Problem, Comparison, Open Question`,
	concise:
		"请将输入文本精简为更短、更清楚的 Markdown，不丢失核心公式、适用条件、定义、限制和关键结论。",
	custom: ""
};

export function buildUserPrompt(options: PromptOptions): string {
	const sections: string[] = [];
	const taskPrompt = options.mode === "custom"
		? buildCustomInstruction(options.customInstruction)
		: TASK_PROMPTS[options.mode];

	sections.push(taskPrompt);

	if (options.mode !== "custom" && options.customInstruction?.trim()) {
		sections.push(`补充要求：\n${options.customInstruction.trim()}`);
	}

	if (options.currentFileName?.trim()) {
		sections.push(`当前文件名：\n${options.currentFileName.trim()}`);
	}

	sections.push(`输入文本：\n${options.selectedText}`);

	return sections.join("\n\n");
}

export function buildMessages(systemPrompt: string, options: PromptOptions): ChatMessage[] {
	return [
		{
			role: "system",
			content: systemPrompt
		},
		{
			role: "user",
			content: buildUserPrompt(options)
		}
	];
}

function buildCustomInstruction(customInstruction?: string): string {
	const instruction = customInstruction?.trim()
		? customInstruction.trim()
		: "请根据输入文本进行 Markdown 格式整理。";

	return `${instruction}

强制规则：
1. 不输出 bash。
2. 不输出 shell 或终端命令。
3. 不解释过程。
4. 只输出最终 Markdown。`;
}
