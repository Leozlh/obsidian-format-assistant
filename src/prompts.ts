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
	inputSource?: "selection" | "manual";
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
	"obsidian-markdown": `请将输入文本整理为清晰、规范、适合 Obsidian 的 Markdown。
Only transform the provided input text.
Do not add frontmatter, metadata, date, tags, title, headings, templates, or sections that are not explicitly present in the input.
Do not infer a diary structure from the current file name.
If the input is only several diary sentences, only format those sentences.
不要添加输入文本中不存在的内容。
不要添加 frontmatter、date、tags、title、文件标题或日记模板。
不要添加“日常记录”“任务清单”等小节，除非输入里已经有。
不要根据 currentFileName 推断日期或标题。
不要扩写事实。
只做格式整理、列表化、轻微措辞清理。
Return only the final Markdown.`,
	"course-note":
		"整理为课程笔记：\n将内容整理成适合课程复习的 Markdown。优先突出主线、定义、关键公式、推导步骤、条件、易错点和复习抓手。不要扩写，不要补造知识点，不要添加 frontmatter、标题模板或总结套话。",
	"review-card":
		"压缩为复习卡片：\n将内容压缩成高密度复习版。优先保留结论、公式、条件、关键词、易错点和最短必要解释。尽量短、准、可扫读，但不要遗漏原文关键逻辑，不要编造内容。",
	"wiki-candidates":
		"提取 Wiki 候选条目：\n从内容中提取适合单独沉淀为 Wiki 的概念、公式、方法、定理、模型或实验术语。输出时按条目列出，每个条目只保留最小必要定义、用途或区分点。不要自动创建链接，不要扩写成完整文章。",
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

	if (options.inputSource) {
		sections.push(
			options.inputSource === "manual"
				? "输入来源：Manual input（用户在侧栏手动粘贴或输入的文本）"
				: "输入来源：Captured selection（Obsidian 编辑器中的选中文本）"
		);
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
4. 只输出最终 Markdown。
5. 直接输出 Markdown 正文本身，不要用 \`\`\` 或 \`\`\`markdown 代码块把整体结果包裹起来。
6. 不要在开头或结尾添加任何说明、前言、总结或客套话。
7. 输出的第一个字符就是正文的第一个字符。`;
}
