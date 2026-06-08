import {
	Editor,
	type EditorPosition,
	MarkdownView,
	Menu,
	Plugin,
	type TAbstractFile,
	type TFile,
	TFolder,
} from "obsidian";
import OpenAI from "openai";
import {
	contextWindowForModel,
	estimateTokens,
	safeInputBudget,
	splitIntoChunks,
	tokenBudgetToChars,
} from "src/plugin/budget";
import {
	createDigestSources,
	buildDigestPrompt,
	buildDigestSystemInstruction,
	collectDigestFiles,
	digestNotice,
	digestTitle,
	type DigestOptions,
} from "src/plugin/digest";
import {
	destinationLabel,
	isStreamingEditorDestination,
	writeGeneratedOutput,
} from "src/plugin/destinations";
import {
	buildLinkedContext,
	readNoteBody,
	resolveFolderInput,
} from "src/plugin/note-context";
import {
	CONTEXT_MENU_PRESETS,
	joinInstructionSections,
	type PromptPresetDefinition,
} from "src/plugin/prompts";
import ProgressNotice from "src/plugin/progress";
import DigestModal from "src/ui/DigestModal";
import AiSummarizeSettingTab, {
	clampMaxTokens,
	DEFAULT_MODEL,
	default_settings,
	FALLBACK_MODELS,
	MIN_SELECTION_WORDS,
	normalizeSettings,
	type AiSummarizePluginSettings,
	type SummaryPlacement,
	upsertActiveProfileFromRoot,
} from "src/settings/settings";
import Notify from "./Notify";
import { isAbortError, prompt } from "./gpt";

declare module "obsidian" {
	interface MenuItem {
		setSubmenu?(): Menu;
	}
}

const SUPPORTED_MODEL_PREFIXES = ["gpt-4", "gpt-5", "o1", "o3", "o4"];
const UNSUPPORTED_MODEL_MARKERS = [
	"audio",
	"dall-e",
	"embedding",
	"image",
	"moderation",
	"realtime",
	"transcribe",
	"tts",
	"whisper",
];

function isSupportedSummaryModel(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return (
		SUPPORTED_MODEL_PREFIXES.some((prefix) =>
			normalized.startsWith(prefix)
		) &&
		!UNSUPPORTED_MODEL_MARKERS.some((marker) =>
			normalized.includes(marker)
		)
	);
}

function sortModels(models: string[]): string[] {
	const preferredOrder = new Map(
		FALLBACK_MODELS.map((model, index) => [model, index])
	);
	const unique = Array.from(new Set(models.filter(Boolean)));

	return unique.sort((a, b) => {
		const aIndex = preferredOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
		const bIndex = preferredOrder.get(b) ?? Number.MAX_SAFE_INTEGER;

		if (aIndex !== bIndex) {
			return aIndex - bIndex;
		}

		return a.localeCompare(b);
	});
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === "string") {
		return error;
	}

	return "Unknown error.";
}

function hasMenuPosition(
	event: MouseEvent | KeyboardEvent
): event is MouseEvent {
	return "clientX" in event && "clientY" in event;
}

interface RectTarget extends EventTarget {
	getBoundingClientRect(): DOMRect;
}

function hasBoundingClientRect(target: EventTarget): target is RectTarget {
	return (
		"getBoundingClientRect" in target &&
		typeof target.getBoundingClientRect === "function"
	);
}

function getEventTargetRect(
	event: MouseEvent | KeyboardEvent
): DOMRect | undefined {
	const target = event.currentTarget || event.target;
	if (!target || !hasBoundingClientRect(target)) {
		return undefined;
	}

	return target.getBoundingClientRect();
}

export default class AISummarizePlugin extends Plugin {
	settings: AiSummarizePluginSettings;
	private currentRunId = 0;
	private currentAbort?: AbortController;

	async getAvailableModels(signal?: AbortSignal): Promise<string[]> {
		const apiKey = this.settings.apiKey.trim();
		if (!apiKey) {
			return [...FALLBACK_MODELS];
		}

		try {
			const client = new OpenAI({
				apiKey,
				dangerouslyAllowBrowser: true,
			});
			const list = await client.models.list({ signal });
			const models = sortModels(
				list.data
					.map((model) => model.id)
					.filter(isSupportedSummaryModel)
			);

			return models.length ? models : [...FALLBACK_MODELS];
		} catch (error) {
			throw new Error(
				`Could not refresh OpenAI models: ${formatError(error)}`
			);
		}
	}

	async refreshAvailableModels(signal?: AbortSignal): Promise<string[]> {
		const availableModels = await this.getAvailableModels(signal);
		this.settings.availableModels = availableModels;

		if (
			!this.settings.model ||
			!availableModels.includes(this.settings.model)
		) {
			this.settings.model = availableModels[0] || DEFAULT_MODEL;
			upsertActiveProfileFromRoot(this.settings);
		}

		await this.saveSettings();
		return availableModels;
	}

	async refreshAvailableModelsWithProgress(): Promise<void> {
		const { abortController, runId, isCurrentRun } = this.startRun();
		const progress = new ProgressNotice("Refreshing OpenAI models.", {
			onCancel: () => {
				this.cancelCurrentRun();
			},
		});

		try {
			const models = await this.refreshAvailableModels(abortController.signal);
			if (!isCurrentRun()) {
				progress.hide();
				return;
			}

			progress.finish(`Model list refreshed (${models.length} models).`);
		} catch (error) {
			if (isAbortError(error) || abortController.signal.aborted) {
				progress.finish("Operation cancelled.");
			} else if (isCurrentRun()) {
				progress.finish(`Error: ${formatError(error)}`);
			}
		} finally {
			this.finishRun(runId);
		}
	}

	private advancePosition(
		position: EditorPosition,
		insertedText: string
	): EditorPosition {
		const lines = insertedText.split("\n");
		if (lines.length === 1) {
			return { line: position.line, ch: position.ch + insertedText.length };
		}

		return {
			line: position.line + lines.length - 1,
			ch: lines[lines.length - 1].length,
		};
	}

	private countWords(text: string): number {
		const words = text.trim().split(/\s+/).filter(Boolean);
		return words.length;
	}

	private canSummarize(text: string): boolean {
		return this.countWords(text) >= MIN_SELECTION_WORDS;
	}

	private selectionTooShortMessage(): string {
		return `Selected text is too short. Select at least ${MIN_SELECTION_WORDS} words.`;
	}

	private summarizeCurrentSelection(
		editor: Editor,
		preset?: PromptPresetDefinition
	): void {
		const selected = editor.getSelection();
		if (!this.canSummarize(selected)) {
			Notify(this.selectionTooShortMessage());
			return;
		}

		void this.generateSummary(selected, editor, preset);
	}

	private addPresetMenuItems(menu: Menu, editor: Editor): void {
		menu.addItem((item) => {
			item.setTitle("Active profile summary")
				.setIcon("lucide-bot")
				.onClick(() => {
					this.summarizeCurrentSelection(editor);
				});
		});

		let currentGroup: string | undefined;
		for (const preset of CONTEXT_MENU_PRESETS) {
			if (currentGroup !== preset.group) {
				currentGroup = preset.group;
				menu.addSeparator();
				menu.addItem((item) => {
					item.setTitle(this.presetGroupLabel(preset.group)).setIsLabel(true);
				});
			}

			menu.addItem((item) => {
				item.setTitle(preset.name)
					.setIcon(preset.icon)
					.onClick(() => {
						this.summarizeCurrentSelection(editor, preset);
					});
			});
		}
	}

	private presetGroupLabel(group: PromptPresetDefinition["group"]): string {
		if (group === "review") {
			return "Review";
		}

		if (group === "open-loops") {
			return "Open loops";
		}

		return "Summaries";
	}

	private startRun(): {
		abortController: AbortController;
		runId: number;
		isCurrentRun: () => boolean;
	} {
		this.currentAbort?.abort();
		const abortController = new AbortController();
		this.currentAbort = abortController;
		const runId = ++this.currentRunId;

		return {
			abortController,
			runId,
			isCurrentRun: () =>
				runId === this.currentRunId && !abortController.signal.aborted,
		};
	}

	private finishRun(runId: number): void {
		if (runId === this.currentRunId) {
			this.currentAbort = undefined;
		}
	}

	private cancelCurrentRun(): boolean {
		if (!this.currentAbort || this.currentAbort.signal.aborted) {
			return false;
		}

		this.currentAbort.abort();
		return true;
	}

	private async collectCompletion(
		input: string,
		maxTokens: number,
		model: string,
		systemInstruction: string,
		abortController: AbortController,
		isCurrentRun: () => boolean
	): Promise<string> {
		let output = "";
		for await (const delta of prompt(
			input,
			this.settings.apiKey.trim(),
			maxTokens,
			model,
			systemInstruction,
			{ signal: abortController.signal }
		)) {
			if (!isCurrentRun()) {
				return "";
			}

			output += delta;
		}

		return output;
	}

	private async generateTextFromContent(options: {
		content: string;
		title: string;
		preset?: PromptPresetDefinition;
		linkedContext?: string;
		abortController: AbortController;
		isCurrentRun: () => boolean;
	}): Promise<string> {
		const model = this.settings.model || DEFAULT_MODEL;
		const outputBudget = clampMaxTokens(this.settings.maxTokens);
		const systemInstruction = joinInstructionSections(
			this.settings.systemInstruction,
			options.preset?.systemInstruction
		);
		const promptInstructions = joinInstructionSections(
			this.settings.defaultPrompt,
			options.preset?.promptInstruction
		);
		const contextSection = options.linkedContext
			? `${options.linkedContext}\n\n`
			: "";
		const basePrompt = `${promptInstructions}\n\nTitle of the note: ${options.title}\n\n${contextSection}`;
		const fullPrompt = `${basePrompt}${options.content}`;
		const maxInputAllowed = safeInputBudget(model, outputBudget);

		if (estimateTokens(fullPrompt) <= maxInputAllowed) {
			return this.collectCompletion(
				fullPrompt,
				outputBudget,
				model,
				systemInstruction,
				options.abortController,
				options.isCurrentRun
			);
		}

		const chunkTokens = Math.max(
			3000,
			Math.min(6000, Math.floor(maxInputAllowed * 0.8))
		);
		const chunks = splitIntoChunks(
			options.content,
			tokenBudgetToChars(chunkTokens)
		);
		const chunkSummaries: string[] = [];

		for (let index = 0; index < chunks.length; index++) {
			if (!options.isCurrentRun()) {
				return "";
			}

			const chunkPrompt = `${basePrompt}Summarize part ${index + 1}/${chunks.length} of the note for later synthesis.\n\n${chunks[index]}`;
			const summary = await this.collectCompletion(
				chunkPrompt,
				Math.min(512, outputBudget),
				model,
				systemInstruction,
				options.abortController,
				options.isCurrentRun
			);
			chunkSummaries.push(summary);
		}

		const metaPrompt = `${basePrompt}You will be given partial summaries. Produce one coherent final result in the requested format without repetition. Keep it under ${outputBudget} tokens.\n\nPartial summaries:\n${chunkSummaries
			.map((summary, index) => `(${index + 1}) ${summary}`)
			.join("\n\n")}`;

		return this.collectCompletion(
			metaPrompt,
			outputBudget,
			model,
			systemInstruction,
			options.abortController,
			options.isCurrentRun
		);
	}

	private noteOutputDestination(): SummaryPlacement {
		const destination = this.settings.summaryPlacement || "append-current";
		return destination === "replace" || destination === "below"
			? "append-current"
			: destination;
	}

	private getActiveEditorForFile(file: TFile): Editor | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view?.file?.path === file.path ? view.editor : undefined;
	}

	async summarizeCurrentNote(): Promise<void> {
		if (!this.settings.apiKey.trim()) {
			Notify("Enter your OpenAI API key in settings first.");
			return;
		}

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			Notify("No active file found.");
			return;
		}

		const { abortController, runId, isCurrentRun } = this.startRun();
		const progress = new ProgressNotice("Preparing full note summary.", {
			onCancel: () => {
				this.cancelCurrentRun();
			},
		});
		try {
			const model = this.settings.model || DEFAULT_MODEL;
			const outputBudget = clampMaxTokens(this.settings.maxTokens);
			progress.update("Reading active note.");
			const content = await readNoteBody(this.app, activeFile);
			let linkedContext = "";

			if (this.settings.linkAwareFullNoteSummaries) {
				progress.update("Building linked note context.");
				const inputBudget = safeInputBudget(model, outputBudget);
				const linkedBudget = Math.min(Math.floor(inputBudget * 0.2), 12000);
				const result = await buildLinkedContext(
					this.app,
					activeFile,
					linkedBudget
				);
				linkedContext = result.text;
				if (result.limited) {
					Notify("Linked context was limited for this model.");
				}
			}

			progress.update("Generating full note summary.");
			const output = await this.generateTextFromContent({
				content,
				title: activeFile.basename,
				linkedContext,
				abortController,
				isCurrentRun,
			});

			if (!isCurrentRun()) {
				progress.hide();
				return;
			}

			progress.update(`Writing output to ${destinationLabel(this.noteOutputDestination())}.`);
			const message = await writeGeneratedOutput({
				app: this.app,
				activeFile,
				editor: this.getActiveEditorForFile(activeFile),
				destination: this.noteOutputDestination(),
				text: output,
				title: "AI summary",
			});
			progress.finish(message);
		} catch (error) {
			if (isAbortError(error) || abortController.signal.aborted) {
				progress.finish("Operation cancelled.");
			} else if (isCurrentRun()) {
				progress.finish(`Error: ${formatError(error)}`);
			}
		} finally {
			this.finishRun(runId);
		}
	}

	openDigestModal(initialFolderPath = "/"): void {
		new DigestModal(this.app, (options, destination) => {
			void this.createDigestFromFolder(options, destination);
		}, initialFolderPath).open();
	}

	async createDigestFromFolder(
		options: DigestOptions,
		destination: SummaryPlacement
	): Promise<void> {
		if (!this.settings.apiKey.trim()) {
			Notify("Enter your OpenAI API key in settings first.");
			return;
		}

		const { abortController, runId, isCurrentRun } = this.startRun();
		const progress = new ProgressNotice("Preparing folder digest.", {
			onCancel: () => {
				this.cancelCurrentRun();
			},
		});
		try {
			progress.update("Collecting notes from folder.");
			const collection = collectDigestFiles(this.app, options);
			const digestFolder = resolveFolderInput(this.app, options.folderPath);
			if (!collection.files.length) {
				progress.hide();
				Notify("No markdown notes found for this digest.");
				return;
			}

			progress.update(digestNotice(collection.files, collection.estimatedTokens));
			const model = this.settings.model || DEFAULT_MODEL;
			const sources = await createDigestSources(
				this.app,
				collection.files,
				async (file: TFile, content: string) => {
					const input = `Summarize this source note in 3-5 concise bullets for a later folder digest. Preserve concrete decisions, action items, names, dates, and open questions.\n\nTitle: ${file.basename}\nPath: ${file.path}\n\n${content}`;
					return this.collectCompletion(
						input,
						400,
						model,
						this.settings.systemInstruction || "",
						abortController,
						isCurrentRun
					);
				},
				({ file, index, total, phase }) => {
					const action =
						phase === "cache" ? "Using cached summary" : "Summarizing";
					progress.update(`${action} ${index}/${total}: ${file.basename}`);
				}
			);

			if (!isCurrentRun()) {
				progress.hide();
				return;
			}

			progress.update("Generating final digest.");
			const outputBudget = clampMaxTokens(this.settings.maxTokens);
			const promptText = buildDigestPrompt(
				options,
				sources,
				this.settings.defaultPrompt,
				safeInputBudget(model, outputBudget)
			);
			const systemInstruction = buildDigestSystemInstruction(
				options.digestType,
				this.settings.systemInstruction
			);
			const digest = await this.collectCompletion(
				promptText,
				outputBudget,
				model,
				systemInstruction,
				abortController,
				isCurrentRun
			);

			if (!isCurrentRun()) {
				progress.hide();
				return;
			}

			if (destination === "frontmatter") {
				throw new Error(
					"Folder digests cannot be written to frontmatter. Choose another destination."
				);
			}

			const digestDestination = destination;
			const anchorFile =
				digestDestination === "append-current"
					? this.app.workspace.getActiveFile()
					: collection.files[0];
			if (!anchorFile) {
				throw new Error("Open a note before appending a digest to the current note.");
			}
			progress.update(`Writing digest to ${destinationLabel(digestDestination)}.`);
			const message = await writeGeneratedOutput({
				app: this.app,
				activeFile: anchorFile,
				editor:
					digestDestination === "append-current"
						? this.getActiveEditorForFile(anchorFile)
						: undefined,
				destination: digestDestination,
				text: digest,
				title: digestTitle(options.digestType),
				targetFolderPath: digestFolder?.path || "",
				baseName: digestFolder?.name || "Vault",
			});
			progress.finish(message);
		} catch (error) {
			if (isAbortError(error) || abortController.signal.aborted) {
				progress.finish("Operation cancelled.");
			} else if (isCurrentRun()) {
				progress.finish(`Error: ${formatError(error)}`);
			}
		} finally {
			this.finishRun(runId);
		}
	}

	private openPresetMenu(
		event: MouseEvent | KeyboardEvent,
		editor: Editor
	): void {
		const presetMenu = new Menu();
		this.addPresetMenuItems(presetMenu, editor);

		const targetRect = getEventTargetRect(event);
		if (targetRect) {
			presetMenu.showAtPosition({ x: targetRect.right + 4, y: targetRect.top });
			return;
		}

		if (hasMenuPosition(event) && (event.clientX !== 0 || event.clientY !== 0)) {
			presetMenu.showAtPosition({ x: event.clientX, y: event.clientY });
			return;
		}

		const rect = this.app.workspace.containerEl.getBoundingClientRect();
		presetMenu.showAtPosition(
			{ x: rect.left + 24, y: rect.top + 24 },
			this.app.workspace.containerEl.ownerDocument
		);
	}

	async generateSummary(
		selectedText: string,
		editor: Editor,
		preset?: PromptPresetDefinition
	): Promise<void> {
		const apiKey = this.settings.apiKey.trim();
		if (!apiKey) {
			Notify("Enter your OpenAI API key in settings first.");
			return;
		}

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			Notify("No active file found.");
			return;
		}

		const { abortController, runId, isCurrentRun } = this.startRun();
		const progress = new ProgressNotice("Preparing selection summary.", {
			onCancel: () => {
				this.cancelCurrentRun();
			},
		});

		let pending = "";
		let flushTimer: number | undefined;
		let insertPosition: EditorPosition | undefined;
		let replaceFrom: EditorPosition | undefined;
		let replaceTo: EditorPosition | undefined;

		const placement = this.settings.summaryPlacement || "replace";
		const model = this.settings.model || DEFAULT_MODEL;
		const outputBudget = clampMaxTokens(this.settings.maxTokens);
		const systemInstruction = joinInstructionSections(
			this.settings.systemInstruction,
			preset?.systemInstruction
		);
		const clearFlushTimer = () => {
			if (flushTimer !== undefined) {
				window.clearTimeout(flushTimer);
				flushTimer = undefined;
			}
		};

		const writeToEditor = (text: string) => {
			if (!text || !isStreamingEditorDestination(placement) || !insertPosition) {
				return;
			}

			editor.replaceRange(text, insertPosition);
			insertPosition = this.advancePosition(insertPosition, text);
		};

		const flushNow = () => {
			clearFlushTimer();
			if (!pending) {
				return;
			}

			if (!isCurrentRun()) {
				pending = "";
				return;
			}

			writeToEditor(pending);
			pending = "";
		};

		const queueWrite = (text: string) => {
			if (!text || !isStreamingEditorDestination(placement)) {
				return;
			}

			pending += text;
			if (pending.length > 96) {
				flushNow();
				return;
			}

			clearFlushTimer();
			flushTimer = window.setTimeout(flushNow, 50);
		};

		const writeHeader = (text: string) => {
			queueWrite(text);
			flushNow();
		};

		try {
			progress.update("Preparing editor output.");
			if (placement === "replace") {
				const from = editor.getCursor("from");
				const to = editor.getCursor("to");
				replaceFrom = from;
				replaceTo = to;
			} else if (placement === "below") {
				insertPosition = editor.getCursor("to");
				writeToEditor("\n");
			}

			const title = activeFile.basename;
			const promptInstructions = joinInstructionSections(
				this.settings.defaultPrompt,
				preset?.promptInstruction
			);
			const basePrompt = `${promptInstructions}\n\n${
				title ? `Title of the note: ${title}\n\n` : ""
			}`;
			const fullPromptPreview = `${basePrompt}${selectedText}`;
			const contextWindow = contextWindowForModel(model);
			const inputEstimate = estimateTokens(fullPromptPreview);
			const overhead = 1000;
			const maxInputAllowed = Math.max(
				1000,
				contextWindow - outputBudget - overhead
			);
			const needsChunking = inputEstimate > maxInputAllowed;

			progress.update(
				needsChunking
					? `Large selection detected (~${inputEstimate} tokens). Summarizing in chunks.`
					: `Generating ${preset ? preset.name.toLowerCase() : "summary"}.`
			);

			let finalSummary = "";

			const runChunk = async (
				chunkText: string,
				index: number,
				total: number,
				perChunkMax: number
			): Promise<string> => {
				let chunkSummary = "";
				const promptText = `${basePrompt}${chunkText}`;

				if (needsChunking && placement !== "frontmatter") {
					progress.update(`Summarizing chunk ${index + 1}/${total}.`);
					writeHeader(
						`${index === 0 ? "" : "\n\n"}Part ${index + 1}/${total}: `
					);
				}

				for await (const delta of prompt(
					promptText,
					apiKey,
					perChunkMax,
					model,
					systemInstruction,
					{ signal: abortController.signal }
				)) {
					if (!isCurrentRun()) {
						progress.hide();
						return "";
					}

					chunkSummary += delta;
					queueWrite(delta);
				}

				flushNow();
				return chunkSummary;
			};

			if (!needsChunking) {
				let singleSummary = "";
				for await (const delta of prompt(
					fullPromptPreview,
					apiKey,
					outputBudget,
					model,
					systemInstruction,
					{ signal: abortController.signal }
				)) {
					if (!isCurrentRun()) {
						progress.hide();
						return;
					}

					singleSummary += delta;
					queueWrite(delta);
				}

				flushNow();
				finalSummary = singleSummary;
			} else {
				const availableForInput = Math.max(
					2000,
					contextWindow - outputBudget - overhead
				);
				const chunkTokens = Math.max(
					3000,
					Math.min(6000, Math.floor(availableForInput * 0.9))
				);
				const parts = splitIntoChunks(selectedText, chunkTokens * 4);
				const perChunkMax = Math.min(512, outputBudget);
				const chunkSummaries: string[] = [];

				for (let index = 0; index < parts.length; index++) {
					if (!isCurrentRun()) {
						progress.hide();
						return;
					}

					const chunkSummary = await runChunk(
						parts[index],
						index,
						parts.length,
						perChunkMax
					);
					chunkSummaries.push(chunkSummary);
				}

				const metaPrompt = `${basePrompt}You will be given partial summaries. Produce one coherent final result in the requested format without repetition. Keep it under ${outputBudget} tokens.\n\nPartial summaries:\n${chunkSummaries
					.map((summary, index) => `(${index + 1}) ${summary}`)
					.join("\n\n")}`;

				if (placement !== "frontmatter") {
					writeHeader("\n\nFinal summary:\n");
				}

				progress.update("Generating final summary.");
				let finalText = "";
				for await (const delta of prompt(
					metaPrompt,
					apiKey,
					outputBudget,
					model,
					systemInstruction,
					{ signal: abortController.signal }
				)) {
					if (!isCurrentRun()) {
						progress.hide();
						return;
					}

					finalText += delta;
					queueWrite(delta);
				}

				flushNow();
				finalSummary = finalText;
			}

			if (!isCurrentRun()) {
				progress.hide();
				return;
			}

			if (placement === "replace" && replaceFrom && replaceTo) {
				editor.replaceRange(finalSummary.trim(), replaceFrom, replaceTo);
				progress.finish("Selection summarized successfully.");
				return;
			}

			progress.update(`Writing output to ${destinationLabel(placement)}.`);
			const message = await writeGeneratedOutput({
				app: this.app,
				activeFile,
				editor,
				destination: placement,
				text: finalSummary,
				title: preset?.name || "AI summary",
			});
			progress.finish(message);
		} catch (error) {
			if (isAbortError(error) || abortController.signal.aborted) {
				progress.finish("Operation cancelled.");
			} else if (isCurrentRun()) {
				progress.finish(`Error: ${formatError(error)}`);
			}
		} finally {
			clearFlushTimer();
			this.finishRun(runId);
		}
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<AiSummarizePluginSettings> | null;
		this.settings = {
			...default_settings,
			...(loaded || {}),
			availableModels: loaded?.availableModels
				? [...loaded.availableModels]
				: [...(default_settings.availableModels || [])],
			profiles: loaded?.profiles
				? loaded.profiles.map((profile) => ({ ...profile }))
				: default_settings.profiles?.map((profile) => ({ ...profile })),
		};
		normalizeSettings(this.settings);
	}

	async saveSettings(): Promise<void> {
		normalizeSettings(this.settings);
		await this.saveData(this.settings);
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.saveSettings();

		this.registerEvent(
			this.app.workspace.on(
				"editor-menu",
				this.handleHighlighterInContextMenu
			)
		);
		this.registerEvent(
			this.app.workspace.on("file-menu", this.handleFileMenu)
		);

		this.addCommand({
			id: "summarize-selection",
			name: "Summarize selection",
			icon: "lucide-bot",
			editorCallback: (editor) => {
				this.summarizeCurrentSelection(editor);
			},
		});

		this.addCommand({
			id: "summarize-current-note",
			name: "Summarize current note",
			icon: "lucide-file-text",
			callback: () => {
				void this.summarizeCurrentNote();
			},
		});

		this.addCommand({
			id: "create-digest-from-folder",
			name: "Create digest from folder",
			icon: "lucide-folder-search",
			callback: () => {
				this.openDigestModal();
			},
		});

		this.addCommand({
			id: "cancel-current-operation",
			name: "Cancel current operation",
			icon: "lucide-circle-stop",
			callback: () => {
				Notify(
					this.cancelCurrentRun()
						? "Current operation cancelled."
						: "No operation is currently running."
				);
			},
		});

		this.addCommand({
			id: "refresh-models",
			name: "Refresh models",
			callback: () => {
				void this.refreshAvailableModelsWithProgress();
			},
		});

		this.addSettingTab(new AiSummarizeSettingTab(this.app, this));
	}

	onunload(): void {
		this.currentAbort?.abort();
	}

	handleHighlighterInContextMenu = (menu: Menu, editor: Editor): void => {
		if (!this.canSummarize(editor.getSelection())) {
			return;
		}

		menu.setUseNativeMenu(false);
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle("AI summarize")
				.setIcon("lucide-bot");

			const submenu = item.setSubmenu?.();
			if (submenu) {
				this.addPresetMenuItems(submenu, editor);
				return;
			}

			item.onClick((event) => {
				this.openPresetMenu(event, editor);
			});
		});
	};

	handleFileMenu = (menu: Menu, file: TAbstractFile): void => {
		if (!(file instanceof TFolder)) {
			return;
		}

		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle("Create AI digest")
				.setIcon("lucide-folder-search")
				.onClick(() => {
					this.openDigestModal(file.path || "/");
				});
		});
	};
}
