import { Notice } from "obsidian";

interface ProgressNoticeOptions {
	onCancel?: () => void;
}

function prefix(message: string): string {
	return `AI Summarize: ${message}`;
}

export default class ProgressNotice {
	private notice: Notice;
	private closed = false;
	private onCancel?: () => void;

	constructor(message: string, options: ProgressNoticeOptions = {}) {
		this.onCancel = options.onCancel;
		this.notice = new Notice(this.renderMessage(message), 0);
	}

	private renderMessage(message: string): string | DocumentFragment {
		if (!this.onCancel) {
			return prefix(message);
		}

		return createFragment((fragment) => {
			const container = fragment.createDiv({ cls: "ai-summarize-progress" });
			container.createSpan({
				cls: "ai-summarize-progress__spinner",
				attr: {
					"aria-hidden": "true",
				},
			});
			container.createSpan({
				cls: "ai-summarize-progress__message",
				text: prefix(message),
			});
			container.createEl("button", {
				cls: "ai-summarize-progress__cancel",
				text: "Cancel",
				attr: {
					"aria-label": "Cancel current AI summarize operation",
				},
			}, (button) => {
				button.addEventListener("click", () => {
					this.notice.setMessage(prefix("Cancelling operation."));
					this.onCancel?.();
				});
			});
		});
	}

	update(message: string): void {
		if (this.closed) {
			return;
		}

		this.notice.setMessage(this.renderMessage(message));
	}

	finish(message: string): void {
		if (this.closed) {
			return;
		}

		this.closed = true;
		this.notice.setMessage(prefix(message));
		window.setTimeout(() => {
			this.notice.hide();
		}, 5000);
	}

	hide(): void {
		if (this.closed) {
			return;
		}

		this.closed = true;
		this.notice.hide();
	}
}
