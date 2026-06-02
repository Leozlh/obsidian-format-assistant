import { App, Modal, Notice } from "obsidian";

export class PreviewModal extends Modal {
	private originalText: string;
	private resultText: string;
	private showOriginal: boolean;
	private onReplace: () => void;

	constructor(
		app: App,
		options: {
			originalText: string;
			resultText: string;
			showOriginal: boolean;
			onReplace: () => void;
		}
	) {
		super(app);
		this.originalText = options.originalText;
		this.resultText = options.resultText;
		this.showOriginal = options.showOriginal;
		this.onReplace = options.onReplace;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("format-assistant-preview");

		contentEl.createEl("h2", { text: "Preview formatted Markdown" });

		const grid = contentEl.createDiv({ cls: "format-assistant-preview__grid" });

		if (this.showOriginal) {
			this.createTextPane(grid, "Original selection", this.originalText);
		}

		this.createTextPane(grid, "Formatted result", this.resultText);

		const actions = contentEl.createDiv({ cls: "format-assistant-preview__actions" });

		const replaceButton = actions.createEl("button", {
			text: "Replace selection",
			cls: "mod-cta"
		});
		replaceButton.addEventListener("click", () => {
			this.onReplace();
			this.close();
		});

		const copyButton = actions.createEl("button", { text: "Copy result" });
		copyButton.addEventListener("click", async () => {
			await navigator.clipboard.writeText(this.resultText);
			new Notice("Result copied.");
		});

		const cancelButton = actions.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}

	private createTextPane(parent: HTMLElement, title: string, text: string) {
		const pane = parent.createDiv({ cls: "format-assistant-preview__pane" });
		pane.createEl("h3", { text: title });
		pane.createDiv({
			cls: "format-assistant-preview__text",
			text
		});
	}
}

export class ConfirmModal extends Modal {
	private message: string;
	private confirmText: string;
	private onConfirm: () => void;

	constructor(
		app: App,
		options: {
			message: string;
			confirmText: string;
			onConfirm: () => void;
		}
	) {
		super(app);
		this.message = options.message;
		this.confirmText = options.confirmText;
		this.onConfirm = options.onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("format-assistant-confirm");
		contentEl.createEl("h2", { text: "Confirm change" });
		contentEl.createEl("p", { text: this.message });

		const actions = contentEl.createDiv({ cls: "format-assistant-preview__actions" });
		const confirmButton = actions.createEl("button", {
			text: this.confirmText,
			cls: "mod-cta"
		});
		confirmButton.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});

		const cancelButton = actions.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}
