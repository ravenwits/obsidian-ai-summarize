import {
	App,
	normalizePath,
	TFile,
	TFolder,
	Vault,
	type CachedMetadata,
} from "obsidian";
import {
	estimateTokens,
	trimToTokenBudget,
} from "src/plugin/budget";

export interface LinkedContextResult {
	text: string;
	linkedCount: number;
	limited: boolean;
}

export interface FolderFileOptions {
	folderPath: string;
	includeSubfolders: boolean;
	dateFilter: "all" | "7d" | "30d";
	maxFiles: number;
}

function frontmatterSummary(cache: CachedMetadata | null): string | undefined {
	const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
	const summary = frontmatter?.summary;
	return typeof summary === "string" && summary.trim() ? summary.trim() : undefined;
}

function stripFrontmatter(content: string): string {
	if (!content.startsWith("---")) {
		return content;
	}

	const end = content.indexOf("\n---", 3);
	if (end === -1) {
		return content;
	}

	return content.slice(end + 4).trimStart();
}

export function getCachedSummary(app: App, file: TFile): string | undefined {
	return frontmatterSummary(app.metadataCache.getFileCache(file));
}

export async function readNoteBody(app: App, file: TFile): Promise<string> {
	return stripFrontmatter(await app.vault.cachedRead(file));
}

function resolveLinkedFiles(app: App, source: TFile): TFile[] {
	const links = app.metadataCache.resolvedLinks[source.path] || {};
	const linkedFiles: TFile[] = [];

	for (const path of Object.keys(links)) {
		const file = app.vault.getFileByPath(path);
		if (file && file.path !== source.path) {
			linkedFiles.push(file);
		}
	}

	return linkedFiles;
}

function resolveBacklinkFiles(app: App, source: TFile): TFile[] {
	const backlinkFiles: TFile[] = [];

	for (const [fromPath, destinations] of Object.entries(
		app.metadataCache.resolvedLinks
	)) {
		if (!destinations[source.path] || fromPath === source.path) {
			continue;
		}

		const file = app.vault.getFileByPath(fromPath);
		if (file) {
			backlinkFiles.push(file);
		}
	}

	return backlinkFiles;
}

async function linkedFileContext(
	app: App,
	file: TFile,
	perFileBudget: number
): Promise<string> {
	const summary = getCachedSummary(app, file);
	if (summary) {
		return `- ${file.basename}: ${trimToTokenBudget(summary, perFileBudget)}`;
	}

	const excerpt = trimToTokenBudget(await readNoteBody(app, file), perFileBudget);
	return `- ${file.basename}: ${excerpt}`;
}

export async function buildLinkedContext(
	app: App,
	source: TFile,
	tokenBudget: number,
	maxLinkedNotes = 8
): Promise<LinkedContextResult> {
	if (tokenBudget <= 0 || maxLinkedNotes <= 0) {
		return { text: "", linkedCount: 0, limited: false };
	}

	const files = [
		...resolveLinkedFiles(app, source),
		...resolveBacklinkFiles(app, source),
	];
	const uniqueFiles = Array.from(
		new Map(files.map((file) => [file.path, file])).values()
	).slice(0, maxLinkedNotes);
	const perFileBudget = Math.max(80, Math.floor(tokenBudget / Math.max(1, uniqueFiles.length)));
	const sections: string[] = [];
	let usedTokens = 0;
	let limited = files.length > uniqueFiles.length;

	for (const file of uniqueFiles) {
		const section = await linkedFileContext(app, file, perFileBudget);
		const sectionTokens = estimateTokens(section);
		if (usedTokens + sectionTokens > tokenBudget) {
			limited = true;
			break;
		}

		sections.push(section);
		usedTokens += sectionTokens;
	}

	return {
		text: sections.length
			? `Linked note context:\n${sections.join("\n")}`
			: "",
		linkedCount: sections.length,
		limited,
	};
}

function passesDateFilter(file: TFile, filter: FolderFileOptions["dateFilter"]): boolean {
	if (filter === "all") {
		return true;
	}

	const days = filter === "7d" ? 7 : 30;
	const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
	return file.stat.mtime >= cutoff;
}

export function collectFolderMarkdownFiles(
	app: App,
	options: FolderFileOptions
): TFile[] {
	const folder = resolveFolderInput(app, options.folderPath);
	if (!folder) {
		throw new Error(`Folder not found: ${options.folderPath}`);
	}

	const files: TFile[] = [];
	if (options.includeSubfolders) {
		Vault.recurseChildren(folder, (child) => {
			if (child instanceof TFile && child.extension === "md") {
				files.push(child);
			}
		});
	} else {
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md") {
				files.push(child);
			}
		}
	}

	return files
		.filter((file) => passesDateFilter(file, options.dateFilter))
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.slice(0, Math.max(1, options.maxFiles));
}

export function resolveFolderInput(app: App, input: string): TFolder | null {
	const trimmed = input.trim();
	if (!trimmed || trimmed === "/") {
		return app.vault.getRoot();
	}

	const normalized = normalizePath(
		trimmed.replace(/^\/+/, "").replace(/\/+$/, "")
	);
	const folder = app.vault.getFolderByPath(normalized);
	if (folder) {
		return folder;
	}

	const file = app.vault.getFileByPath(normalized);
	return file?.parent || null;
}

export function getVaultFolders(app: App): TFolder[] {
	const root = app.vault.getRoot();
	const folders: TFolder[] = [root];

	Vault.recurseChildren(root, (child) => {
		if (child instanceof TFolder) {
			folders.push(child);
		}
	});

	return folders;
}
