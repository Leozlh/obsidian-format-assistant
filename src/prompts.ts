export type FormatMode =
	| "obsidian-markdown"
	| "note-organize"
	| "diary-organize"
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
1. 保留用户原始语气和真实感，不要改得太正式。
2. 不要添加输入中没有的情绪判断。
3. 不要添加心理分析。
4. 不要扩写成鸡汤或总结。
5. 将生活记录、计划、待办分开。
6. 如果输入中包含明确任务，请整理成 Obsidian task 格式：
   - [ ] 任务内容
7. 如果输入只是普通记录，不要强行变成任务。
8. 不要添加 frontmatter。
9. 不要添加日期标题。
10. 不要添加“日常记录”“任务清单”等小节，除非确实有助于整理且输入足够长。
11. 输入较短时，优先输出简洁列表。

推荐输出方式：
如果输入中既有记录又有任务，可以输出：

## 记录

- ...

## 待办

- [ ] ...

如果输入很短，可以只输出：

- ...
- [ ] ...

特别要求：
日记整理模式中，任务必须尽量从原文中提取，不要创造新任务。
例如：
输入：
下午要继续写作业，晚上开始复习计划。
输出：
- [ ] 下午继续写作业
- [ ] 晚上开始复习计划`;

const COURSE_NOTE_PROMPT =
	"整理为课程笔记：\n将内容整理成适合课程复习的 Markdown。优先突出主线、定义、关键公式、推导步骤、条件、易错点和复习抓手。不要扩写，不要补造知识点，不要添加 frontmatter、标题模板或总结套话。";

const REVIEW_CARD_PROMPT =
	"压缩为复习卡片：\n将内容压缩成高密度复习版。优先保留结论、公式、条件、关键词、易错点和最短必要解释。尽量短、准、可扫读，但不要遗漏原文关键逻辑，不要编造内容。";

const WIKI_CANDIDATES_PROMPT =
	"提取 Wiki 候选条目：\n从内容中提取适合单独沉淀为 Wiki 的概念、公式、方法、定理、模型或实验术语。输出时按条目列出，每个条目只保留最小必要定义、用途或区分点。不要自动创建链接，不要扩写成完整文章。";

const CONCISE_PROMPT =
	"请将输入文本精简为更短、更清楚的 Markdown，不丢失核心公式、适用条件、定义、限制和关键结论。";

export const FORMAT_MODES: FormatMode[] = [
	"obsidian-markdown",
	"note-organize",
	"diary-organize",
	"course-note",
	"review-card",
	"wiki-candidates",
	"concise",
	"custom"
];

export const FORMAT_MODE_LABELS: Record<FormatMode, string> = {
	"obsidian-markdown": "Obsidian Markdown",
	"note-organize": "笔记整理",
	"diary-organize": "日记整理",
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
		id: "organize-selection-as-note",
		name: "Organize selection as note",
		mode: "note-organize"
	},
	{
		id: "organize-selection-as-diary",
		name: "Organize selection as diary",
		mode: "diary-organize"
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

	if (mode === "course-note") {
		return COURSE_NOTE_PROMPT;
	}

	if (mode === "review-card") {
		return REVIEW_CARD_PROMPT;
	}

	if (mode === "wiki-candidates") {
		return WIKI_CANDIDATES_PROMPT;
	}

	if (mode === "concise") {
		return CONCISE_PROMPT;
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
			options.inputSource === "manual"
				? "输入来源：Manual input（用户在侧栏手动粘贴或输入的文本）"
				: "输入来源：Captured selection（Obsidian 编辑器中的选中文本）"
		);
	}

	return sections.length ? `上下文信息：\n${sections.join("\n")}` : "";
}
