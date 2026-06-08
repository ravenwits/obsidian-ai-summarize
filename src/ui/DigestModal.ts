import {
	AbstractInputSuggest,
	App,
	Modal,
	Setting,
	type TFolder,
} from "obsidian";
import { destinationLabel } from "src/plugin/destinations";
import { collectDigestFiles, digestSummaryForModal, type DigestOptions } from "src/plugin/digest";
import { DIGEST_PRESETS, type DigestType } from "src/plugin/prompts";
import type { SummaryPlacement } from "src/settings/settings";
import { getVaultFolders } from "src/plugin/note-context";

const DESTINATIONS: SummaryPlacement[] = [
	"append-current",
	"new-note",
	"daily-note",
];

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private folders: TFolder[];
	private onChoose: (folder: TFolder) => void;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		onChoose: (folder: TFolder) => void
	) {
		super(app, inputEl);
		this.folders = getVaultFolders(app);
		this.onChoose = onChoose;
	}

	protected getSuggestions(query: string): TFolder[] {
		const normalizedQuery = query
			.trim()
			.replace(/^\/+/, "")
			.toLowerCase();
		if (!normalizedQuery) {
			return this.folders;
		}

		return this.folders.filter((folder) =>
			folder.path.toLowerCase().includes(normalizedQuery)
		);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folderPathForInput(folder));
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folderPathForInput(folder));
		this.onChoose(folder);
		this.close();
	}
}

function folderPathForInput(folder: TFolder): string {
	return folder.path || "/";
}

export default class DigestModal extends Modal {
	private folderPath = "/";
	private includeSubfolders = true;
	private dateFilter: DigestOptions["dateFilter"] = "30d";
	private maxFiles = 25;
	private digestType: DigestType = "project-status";
	private destination: SummaryPlacement = "new-note";
	private onSubmit: (options: DigestOptions, destination: SummaryPlacement) => void;
	private estimateEl?: HTMLElement;
	private hasSelectedFolder = false;

	constructor(
		app: App,
		onSubmit: (options: DigestOptions, destination: SummaryPlacement) => void,
		initialFolderPath = "/"
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.folderPath = initialFolderPath || "/";
		this.hasSelectedFolder = this.folderPath !== "/";
	}

	onOpen(): void {
		this.titleEl.setText("Create digest from folder");
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName("Folder")
			.setDesc("Choose a folder, or paste a note path to use its parent folder.")
			.addText((text) => {
				text.setPlaceholder("Vault root or folder path")
					.setValue(this.folderPath)
					.onChange((value) => {
						this.folderPath = value.trim();
						this.hasSelectedFolder = false;
						this.showSelectFolderEstimateMessage();
					});
				new FolderSuggest(this.app, text.inputEl, (folder) => {
					this.folderPath = folderPathForInput(folder);
					this.hasSelectedFolder = true;
					this.updateEstimate();
				});
			});

		new Setting(contentEl)
			.setName("Digest type")
			.setDesc("Choose the shape of the final digest.")
			.addDropdown((dropdown) => {
				dropdown
					.addOptions(
						Object.fromEntries(
							DIGEST_PRESETS.map((preset) => [preset.id, preset.name])
						)
					)
					.setValue(this.digestType)
					.onChange((value) => {
						this.digestType = value as DigestType;
					});
			});

		new Setting(contentEl)
			.setName("Date filter")
			.setDesc("Limit notes by modified date.")
			.addDropdown((dropdown) => {
				dropdown
					.addOptions({
						all: "All notes",
						"7d": "Last 7 days",
						"30d": "Last 30 days",
					})
					.setValue(this.dateFilter)
					.onChange((value) => {
						this.dateFilter = value as DigestOptions["dateFilter"];
						this.updateEstimate();
					});
			});

		new Setting(contentEl)
			.setName("Include subfolders")
			.setDesc("Include notes in nested folders.")
			.addToggle((toggle) => {
				toggle.setValue(this.includeSubfolders).onChange((value) => {
					this.includeSubfolders = value;
					this.updateEstimate();
				});
			});

		new Setting(contentEl)
			.setName("Max files")
			.setDesc("Limit how many notes are included.")
			.addText((text) => {
				text.setValue(this.maxFiles.toString()).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					if (Number.isFinite(parsed)) {
						this.maxFiles = Math.max(1, Math.min(100, parsed));
						this.updateEstimate();
					}
				});
			});

		new Setting(contentEl)
			.setName("Destination")
			.setDesc("Choose where the digest should be written.")
			.addDropdown((dropdown) => {
				dropdown
					.addOptions(
						Object.fromEntries(
							DESTINATIONS.map((destination) => [
								destination,
								destinationLabel(destination),
							])
						)
					)
					.setValue(this.destination)
					.onChange((value) => {
						this.destination = value as SummaryPlacement;
					});
			});

		this.estimateEl = contentEl.createEl("p", {
			text: "Select a folder to estimate digest size.",
		});
		if (this.hasSelectedFolder) {
			this.updateEstimate();
		}

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			)
			.addButton((button) =>
				button
					.setButtonText("Create digest")
					.setCta()
					.onClick(() => {
						this.onSubmit(this.currentOptions(), this.destination);
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private currentOptions(): DigestOptions {
		return {
			folderPath: this.folderPath,
			includeSubfolders: this.includeSubfolders,
			dateFilter: this.dateFilter,
			maxFiles: this.maxFiles,
			digestType: this.digestType,
		};
	}

	private updateEstimate(): void {
		if (!this.estimateEl) {
			return;
		}

		if (!this.hasSelectedFolder) {
			this.showSelectFolderEstimateMessage();
			return;
		}

		try {
			const collection = collectDigestFiles(this.app, this.currentOptions());
			this.estimateEl.setText(digestSummaryForModal(collection));
		} catch (error) {
			this.estimateEl.setText(
				error instanceof Error ? error.message : "Could not estimate digest size."
			);
		}
	}

	private showSelectFolderEstimateMessage(): void {
		this.estimateEl?.setText(
			"Select a folder from suggestions to estimate digest size."
		);
	}
}
