import { App, Editor, Menu, Plugin } from "obsidian";
import Notify from "./Notify";
import { prompt } from "./gpt";
import AiSummarizeSettingTab, {
	AiSummarizePluginSettings,
	default_settings,
} from "src/settings/settings";
import OpenAI from "openai";

export type EnhancedMenu = Menu & { dom: HTMLElement };

export type EnhancedApp = App & {
	commands: { executeCommandById: Function };
};

export type EnhancedEditor = Editor & {
	getSelection: Function;
};

export default class AISummarizePlugin extends Plugin {
	settings: AiSummarizePluginSettings;
	frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;

	// Concurrency guard state
	private currentRunId: number = 0;
	private currentAbort?: AbortController;

	async getAvailableModels(): Promise<string[]> {
		if (!this.settings.apiKey) {
			console.log("No API key provided, using fallback models");
			return default_settings.availableModels || ["gpt-4"];
		}

		try {
			const client = new OpenAI({
				apiKey: this.settings.apiKey,
				dangerouslyAllowBrowser: true,
			});
			const list = await client.models.list();
			const ids = (list.data || []).map((m: any) => m.id as string);
			return ids
				.filter((id: string) =>
					[
						"gpt-3.5-turbo",
						"gpt-4",
						"gpt-4-turbo",
						"gpt-4.1",
						"gpt-4.1-mini",
						"gpt-4.1-nano",
						"gpt-4o",
						"gpt-4o-mini",
						"gpt-5",
						"gpt-5-chat-latest",
						"gpt-5-mini",
						"gpt-5-nano",
						"o1",
						"o3",
						"o3-mini",
						"o4-mini",
					].includes(id)
				)
				.sort();
		} catch (error) {
			console.error("Failed to fetch available models:", error);
			// Return fallback models if API call fails
			return default_settings.availableModels || ["gpt-4"];
		}
	}

	async refreshAvailableModels(): Promise<void> {
		const availableModels = await this.getAvailableModels();
		this.settings.availableModels = availableModels;
		await this.saveSettings();
		console.log("Refreshed available OpenAI models:", availableModels);
	}

	// Rough token estimator and context windows for budgeting
	private estimateTokens(text: string): number {
		// Heuristic: ~4 chars per token for English
		return Math.ceil((text || "").length / 4);
	}

	private contextWindowForModel(model: string | undefined): number {
		const map: Record<string, number> = {
			"gpt-3.5-turbo": 16000,
			"gpt-4": 8192,
			"gpt-4-turbo": 128000,
			"gpt-4.1": 128000,
			"gpt-4.1-mini": 128000,
			"gpt-4.1-nano": 128000,
			"gpt-4o": 128000,
			"gpt-4o-mini": 128000,
			"gpt-5": 200000,
			"gpt-5-chat-latest": 200000,
			"gpt-5-mini": 200000,
			"gpt-5-nano": 200000,
			o1: 200000,
			o3: 200000,
			"o3-mini": 200000,
			"o4-mini": 200000,
		};
		if (!model) return 128000;
		return map[model] || 128000;
	}

	private splitIntoChunks(text: string, chunkCharTarget: number): string[] {
		if (text.length <= chunkCharTarget) return [text];
		const paras = text.split(/\n\n+/);
		const chunks: string[] = [];
		let cur = "";
		for (const p of paras) {
			const candidate = cur.length ? cur + "\n\n" + p : p;
			if (candidate.length <= chunkCharTarget || !cur) {
				cur = candidate;
			} else {
				chunks.push(cur);
				cur = p;
			}
		}
		if (cur) chunks.push(cur);
		return chunks;
	}

	async generateSummary(
		selectedText: string,
		editor: EnhancedEditor
	): Promise<string> {
		try {
			const activeFile = this.app.workspace.getActiveFile();

			if (!activeFile) {
				throw new Error("No active file found.");
			}

			const title = activeFile.basename;
			const basePrompt = `${this.settings.defaultPrompt} ${
				title ? "title of the note is: " + title + "\n" : ""
			}\n\n`;
			const fullPromptPreview = `${basePrompt}${selectedText}`;

			if (!!this.settings.apiKey) {
				// Concurrency guard: cancel any previous run
				if (this.currentAbort) {
					try {
						this.currentAbort.abort();
					} catch {}
				}
				this.currentAbort = new AbortController();
				const myRunId = ++this.currentRunId;

				// Token budgeting and chunk plan
				const model = this.settings.model;
				const ctx = this.contextWindowForModel(model);
				const inputEstimate = this.estimateTokens(fullPromptPreview);
				const outputBudget = this.settings.maxTokens ?? 0;
				Notify(
					`Token estimate: ~${inputEstimate} input, ${outputBudget} output (model ${model}, ~${ctx} ctx)`
				);

				const overhead = 1000; // cushion for system/instructions and formatting
				const maxInputAllowed = Math.max(
					1000,
					ctx - outputBudget - overhead
				);
				const needsChunking = inputEstimate > maxInputAllowed;

				const placement = this.settings.summaryPlacement;

				Notify(
					needsChunking
						? `Large selection detected (~${inputEstimate} tokens). Chunking to stay under context window...`
						: `Generating summary...`
				);

				// Helper: throttled writer to reduce DOM churn
				let pending = "";
				let flushTimer: number | undefined;
				const flushNow = () => {
					if (!pending) return;
					// Guard against overlap
					if (myRunId !== this.currentRunId) {
						pending = "";
						return;
					}
					editor.replaceSelection(pending);
					pending = "";
				};
				const queueWrite = (s: string) => {
					if (!s) return;
					pending += s;
					// flush after N chars or after ~50ms
					if (pending.length > 96) {
						flushNow();
						if (flushTimer) {
							window.clearTimeout(flushTimer);
							flushTimer = undefined as any;
						}
					} else {
						if (flushTimer) window.clearTimeout(flushTimer);
						flushTimer = window.setTimeout(() => {
							flushTimer = undefined as any;
							flushNow();
						}, 50) as any;
					}
				};

				let message = "Summary updated successfully.";
				(async () => {
					let finalSummary = "";

					const writeHeader = (text: string) => {
						if (placement === "frontmatter") return;
						queueWrite(text);
						flushNow();
					};

					// If placing below, move cursor to end of selection and add one blank line
					if (placement === "below") {
						const to = (editor as any).getCursor
							? (editor as any).getCursor("to")
							: null;
						if (to) {
							(editor as any).setCursor(to);
						}
						queueWrite("\n");
						flushNow();
					}

					const runChunk = async (
						chunkText: string,
						idx: number,
						total: number,
						perChunkMax: number
					) => {
						let chunkSummary = "";
						const promptText = `${basePrompt}${chunkText}`;
						let prefix = "";
						if (needsChunking && placement !== "frontmatter") {
							prefix =
								(idx === 0 ? "" : "\n\n") +
								`Part ${idx + 1}/${total}: `;
							writeHeader(prefix);
						}
						for await (const delta of prompt(
							promptText,
							this.settings.apiKey,
							perChunkMax,
							this.settings.model,
							this.settings.systemInstruction,
							{ signal: this.currentAbort?.signal }
						)) {
							if (myRunId !== this.currentRunId) return "";
							chunkSummary += delta;
							if (placement !== "frontmatter") queueWrite(delta);
						}
						flushNow();
						return chunkSummary;
					};

					if (!needsChunking) {
						// Single call path
						let single = "";
						for await (const delta of prompt(
							fullPromptPreview,
							this.settings.apiKey,
							this.settings.maxTokens,
							this.settings.model,
							this.settings.systemInstruction,
							{ signal: this.currentAbort?.signal }
						)) {
							if (myRunId !== this.currentRunId) return;
							single += delta;
							if (placement !== "frontmatter") queueWrite(delta);
						}
						flushNow();
						finalSummary = single;
					} else {
						// Chunking pipeline
						const availableForInput = Math.max(
							2000,
							ctx - outputBudget - overhead
						);
						const chunkTokens = Math.max(
							3000,
							Math.min(6000, Math.floor(availableForInput * 0.9))
						);
						const chunkChars = chunkTokens * 4;
						const parts = this.splitIntoChunks(
							selectedText,
							chunkChars
						);
						const perChunkMax = Math.min(
							512,
							this.settings.maxTokens
						);
						const chunkSummaries: string[] = [];
						for (let i = 0; i < parts.length; i++) {
							if (myRunId !== this.currentRunId) return;
							const cs = await runChunk(
								parts[i],
								i,
								parts.length,
								perChunkMax
							);
							chunkSummaries.push(cs);
						}
						// Now produce a final "summary of summaries"
						const metaPrompt = `${basePrompt}You will be given N partial summaries. Produce a concise, coherent single summary that captures the overall content without repetition. Keep it under ${
							this.settings.maxTokens
						} tokens.\n\nPartial summaries:\n${chunkSummaries
							.map((s, i) => `(${i + 1}) ${s}`)
							.join("\n\n")}`;
						if (placement !== "frontmatter") {
							writeHeader("\n\nFinal summary:\n");
						}
						let finalText = "";
						for await (const delta of prompt(
							metaPrompt,
							this.settings.apiKey,
							this.settings.maxTokens,
							this.settings.model,
							this.settings.systemInstruction,
							{ signal: this.currentAbort?.signal }
						)) {
							if (myRunId !== this.currentRunId) return;
							finalText += delta;
							if (placement !== "frontmatter") queueWrite(delta);
						}
						flushNow();
						finalSummary = finalText;
					}

					// Persist to frontmatter if requested
					if (placement === "frontmatter") {
						this.app.fileManager.processFrontMatter(
							activeFile,
							(fm) => {
								fm["summary"] = finalSummary;
							}
						);
					}

					// Message per placement
					if (placement === "frontmatter") {
						message = "Summary added to frontmatter.";
					} else if (placement === "replace") {
						message = "Selection summarized successfully.";
					} else if (placement === "below") {
						message = "Summary inserted below selection.";
					}
					Notify(message);
				})();
			} else {
				throw new Error(
					"Please enter your OpenAI API Key in the settings."
				);
			}
		} catch (error) {
			Notify(error);
			return;
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			default_settings,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async onload() {
		await this.loadSettings();
		console.log(`AI Summarize v${this.manifest.version} loaded!`);

		// Fetch available models on plugin initialization
		const availableModels = await this.getAvailableModels();
		this.settings.availableModels = availableModels;

		// Ensure the current model is valid, fallback to first available if not
		if (
			!this.settings.model ||
			!availableModels.includes(this.settings.model)
		) {
			this.settings.model = availableModels[0] || "gpt-4";
		}

		await this.saveSettings();
		console.log("Available OpenAI models:", availableModels);
		console.log("Selected model:", this.settings.model);

		this.registerEvent(
			this.app.workspace.on(
				"editor-menu",
				this.handleHighlighterInContextMenu
			)
		);

		this.addCommand({
			id: "summarize-selection",
			name: "Summarize selection",
			icon: "lucide-bot",
			editorCallback: (editor, ctx) => {
				const selected = editor.getSelection();
				const wordCount = selected.split(" ").length;

				if (selected) {
					if (wordCount > 30) {
						this.generateSummary(selected, editor);
						return true;
					}

					Notify("Selected text is too short! (>30 words)");
					return false;
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AiSummarizeSettingTab(this.app, this));
	}

	async onunload() {
		console.log("unloading plugin of Ravenwits!");
	}

	handleHighlighterInContextMenu = (
		menu: Menu,
		editor: EnhancedEditor
	): void => {
		const selection = editor.getSelection();
		if (selection) {
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle("AI summarize")
					.setIcon("lucide-bot")
					.onClick((e) => {
						if (editor.getSelection()) {
							const selected = editor.getSelection();
							const wordCount = selected.split(" ").length;

							if (wordCount > 30) {
								this.generateSummary(selection, editor);
							} else
								Notify(
									"Selected text is too short! (>30 words)"
								);
						}
					});
			});
		}
	};
}
