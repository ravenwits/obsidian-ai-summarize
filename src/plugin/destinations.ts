import {
	App,
	Editor,
	normalizePath,
	moment,
	type TFile,
} from "obsidian";
import {
	appHasDailyNotesPluginLoaded,
	createDailyNote,
	getAllDailyNotes,
	getDailyNote,
	getDailyNoteSettings,
} from "obsidian-daily-notes-interface";
import type { SummaryPlacement } from "src/settings/settings";

export interface DestinationWriteOptions {
	app: App;
	activeFile: TFile;
	editor?: Editor;
	destination: SummaryPlacement;
	text: string;
	title: string;
	targetFolderPath?: string;
	baseName?: string;
}

function markdownHeading(title: string, text: string): string {
	return `\n\n## ${title}\n\n${text.trim()}\n`;
}

function sourceFolder(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
	const normalized = normalizePath(folderPath);
	if (!normalized || app.vault.getFolderByPath(normalized)) {
		return;
	}

	const parts = normalized.split("/");
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getFolderByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}

async function availableMarkdownPath(app: App, path: string): Promise<string> {
	const normalized = normalizePath(path);
	if (!app.vault.getFileByPath(normalized)) {
		return normalized;
	}

	const withoutExtension = normalized.replace(/\.md$/u, "");
	for (let index = 2; index < 1000; index++) {
		const candidate = `${withoutExtension} ${index}.md`;
		if (!app.vault.getFileByPath(candidate)) {
			return candidate;
		}
	}

	throw new Error("Could not create a unique note path.");
}

async function createSummaryNote(
	app: App,
	activeFile: TFile,
	title: string,
	text: string,
	targetFolderPath?: string,
	baseName?: string
): Promise<string> {
	const folder = normalizePath(targetFolderPath || sourceFolder(activeFile.path));
	const targetFolder = folder ? `${folder}/AI summaries` : "AI summaries";
	const sourceName = baseName || activeFile.basename;
	await ensureFolder(app, targetFolder);
	const path = await availableMarkdownPath(
		app,
		`${targetFolder}/${sourceName} ${title}.md`
	);
	await app.vault.create(path, `# ${sourceName} ${title}\n\n${text.trim()}\n`);
	return `Created ${path}.`;
}

async function appendToDailyNote(
	app: App,
	text: string,
	title: string
): Promise<string> {
	if (!appHasDailyNotesPluginLoaded()) {
		throw new Error("Enable the Daily notes core plugin first.");
	}

	const today = moment();
	let dailyNote = getExistingDailyNote(today);
	if (!dailyNote) {
		try {
			dailyNote = await createDailyNote(today);
		} catch {
			dailyNote = undefined;
		}
		dailyNote = dailyNote || (await createFallbackDailyNote(app));
	}

	if (!dailyNote) {
		throw new Error("Could not create today's daily note.");
	}

	await app.vault.process(dailyNote, (data) =>
		`${data.trimEnd()}${markdownHeading(title, text)}`
	);
	return "Added to today's daily note.";
}

function getExistingDailyNote(today: moment.Moment): TFile | null {
	try {
		return getDailyNote(today, getAllDailyNotes());
	} catch {
		return null;
	}
}

async function createFallbackDailyNote(app: App): Promise<TFile | undefined> {
	const settings = getDailyNoteSettings();
	const format = settings.format || "YYYY-MM-DD";
	const folder = settings.folder || "";
	const fileName = moment().format(format);
	const path = normalizePath(folder ? `${folder}/${fileName}.md` : `${fileName}.md`);
	const existing = app.vault.getFileByPath(path);
	if (existing) {
		return existing;
	}

	const folderPath = sourceFolder(path);
	if (folderPath) {
		await ensureFolder(app, folderPath);
	}

	return app.vault.create(path, "");
}

export async function writeGeneratedOutput(
	options: DestinationWriteOptions
): Promise<string> {
	const {
		app,
		activeFile,
		destination,
		editor,
		text,
		title,
		targetFolderPath,
		baseName,
	} = options;
	const trimmed = text.trim();

	if (destination === "frontmatter") {
		await app.fileManager.processFrontMatter(
			activeFile,
			(frontmatter: Record<string, unknown>) => {
				frontmatter.summary = trimmed;
			}
		);
		return "Summary added to frontmatter.";
	}

	if (destination === "append-current") {
		if (editor) {
			const lastLine = editor.lastLine();
			editor.replaceRange(markdownHeading(title, trimmed), {
				line: lastLine,
				ch: editor.getLine(lastLine).length,
			});
			return "Added to current note.";
		}

		await app.vault.process(activeFile, (data) =>
			`${data.trimEnd()}${markdownHeading(title, trimmed)}`
		);
		return "Added to current note.";
	}

	if (destination === "new-note") {
		return createSummaryNote(
			app,
			activeFile,
			title,
			trimmed,
			targetFolderPath,
			baseName
		);
	}

	if (destination === "daily-note") {
		return appendToDailyNote(app, trimmed, title);
	}

	if (!editor) {
		await app.vault.process(activeFile, (data) =>
			`${data.trimEnd()}${markdownHeading(title, trimmed)}`
		);
		return "Added to current note.";
	}

	return destination === "below"
		? "Summary inserted below selection."
		: "Selection summarized successfully.";
}

export function isStreamingEditorDestination(destination: SummaryPlacement): boolean {
	return destination === "below";
}

export function destinationLabel(destination: SummaryPlacement): string {
	const labels: Record<SummaryPlacement, string> = {
		replace: "Replace selection",
		below: "Insert below selection",
		frontmatter: "Frontmatter summary",
		"append-current": "Append to current note",
		"new-note": "Create new note",
		"daily-note": "Append to daily note",
	};

	return labels[destination];
}
