import { Notice } from 'obsidian';

export default function Notify(message: string) {
	new Notice(`AI Summarize: ${message}`);
}
