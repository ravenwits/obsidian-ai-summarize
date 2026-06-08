import { Notice } from "obsidian";

function formatNoticeMessage(message: unknown): string {
	if (message instanceof Error) {
		return message.message;
	}

	if (typeof message === "string") {
		return message;
	}

	if (
		typeof message === "number" ||
		typeof message === "boolean" ||
		typeof message === "bigint"
	) {
		return message.toString();
	}

	try {
		const serialized = JSON.stringify(message);
		return serialized || "Unknown error.";
	} catch {
		return "Unknown error.";
	}
}

export default function Notify(message: unknown): void {
	const text = formatNoticeMessage(message);
	new Notice(`AI Summarize: ${text}`);
}
