import { App, type TFile } from "obsidian";
import { estimateTokens, trimToTokenBudget } from "src/plugin/budget";
import {
	collectFolderMarkdownFiles,
	getCachedSummary,
	readNoteBody,
	type FolderFileOptions,
} from "src/plugin/note-context";
import { getDigestPreset, type DigestType, joinInstructionSections } from "src/plugin/prompts";

export interface DigestOptions extends FolderFileOptions {
	digestType: DigestType;
}

export interface DigestSource {
	file: TFile;
	text: string;
	fromCache: boolean;
}

export interface DigestCollection {
	files: TFile[];
	estimatedTokens: number;
}

export interface DigestSourceProgress {
	file: TFile;
	index: number;
	total: number;
	phase: "cache" | "summarize";
}

export function collectDigestFiles(app: App, options: DigestOptions): DigestCollection {
	const files = collectFolderMarkdownFiles(app, options);
	const estimatedTokens = files.reduce(
		(total, file) => total + Math.max(100, Math.ceil(file.stat.size / 4)),
		0
	);

	return { files, estimatedTokens };
}

export async function createDigestSources(
	app: App,
	files: TFile[],
	summarizeFile: (file: TFile, content: string) => Promise<string>,
	onProgress?: (progress: DigestSourceProgress) => void
): Promise<DigestSource[]> {
	const sources: DigestSource[] = [];

	for (let index = 0; index < files.length; index++) {
		const file = files[index];
		const cached = getCachedSummary(app, file);
		if (cached) {
			onProgress?.({
				file,
				index: index + 1,
				total: files.length,
				phase: "cache",
			});
			sources.push({ file, text: cached, fromCache: true });
			continue;
		}

		const content = trimToTokenBudget(await readNoteBody(app, file), 6000);
		onProgress?.({
			file,
			index: index + 1,
			total: files.length,
			phase: "summarize",
		});
		const text = await summarizeFile(file, content);
		sources.push({ file, text, fromCache: false });
	}

	return sources;
}

export function buildDigestPrompt(
	options: DigestOptions,
	sources: DigestSource[],
	defaultPrompt: string,
	inputBudget?: number
): string {
	const preset = getDigestPreset(options.digestType);
	const baseHeader = `${joinInstructionSections(defaultPrompt, preset.promptInstruction)}\n\nFolder: ${options.folderPath}`;
	const remainingBudget = inputBudget
		? inputBudget - estimateTokens(baseHeader) - 200
		: undefined;
	const selectedSources =
		remainingBudget === undefined
			? sources
			: remainingBudget > 0
				? selectSourcesForBudget(sources, remainingBudget)
				: [];
	const omittedCount = sources.length - selectedSources.length;
	const header = `${baseHeader}\nFiles included: ${selectedSources.length}${
		omittedCount > 0
			? `\nFiles omitted due to model budget: ${omittedCount}`
			: ""
	}`;
	const sourceText = selectedSources
		.map(
			(source, index) => `Source ${index + 1}: ${source.file.path}\n${source.text}`
		)
		.join("\n\n---\n\n");

	return sourceText
		? `${header}\n\n${sourceText}`
		: `${header}\n\n[Source summaries omitted because the digest prompt exceeded the model budget.]`;
}

function selectSourcesForBudget(
	sources: DigestSource[],
	remainingBudget: number
): DigestSource[] {
	const selected: DigestSource[] = [];
	let used = 0;
	const perSourceBudget = Math.max(
		80,
		Math.floor(remainingBudget / Math.max(1, sources.length))
	);

	for (const source of sources) {
		const pathBudget = estimateTokens(source.file.path) + 16;
		const textBudget = Math.max(40, perSourceBudget - pathBudget);
		const text = trimToTokenBudget(source.text.trim(), textBudget);
		const cost = pathBudget + estimateTokens(text);

		if (selected.length > 0 && used + cost > remainingBudget) {
			break;
		}

		selected.push({ ...source, text });
		used += cost;
	}

	return selected;
}

export function buildDigestSystemInstruction(
	digestType: DigestType,
	baseSystemInstruction: string | undefined
): string {
	const preset = getDigestPreset(digestType);
	return joinInstructionSections(baseSystemInstruction, preset.systemInstruction);
}

export function digestTitle(digestType: DigestType): string {
	return getDigestPreset(digestType).name;
}

export function digestNotice(files: TFile[], estimatedTokens: number): string {
	return `Generating digest from ${files.length} notes (~${estimatedTokens} input tokens before summarization).`;
}

export function digestSummaryForModal(collection: DigestCollection): string {
	return `${collection.files.length} notes, ~${collection.estimatedTokens} estimated tokens.`;
}
