import { App, Editor, Menu, Plugin } from 'obsidian';
import Notify from './Notify';
import { prompt } from './gpt';
import AiSummarizeSettingTab, { AiSummarizePluginSettings, default_settings } from 'src/settings/settings';

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

	async generateSummary(selectedText: string, editor: EnhancedEditor): Promise<string> {
		try {
			const activeFile = this.app.workspace.getActiveFile();

			if (!activeFile) {
				throw new Error('No active file found.');
			}

			const title = activeFile.basename;
			const promptText = `${this.settings.defaultPrompt} ${title ? 'title of the note is: ' + title + '\n' : ''} \n\n${selectedText}`;

			if (!!this.settings.apiKey) {
				Notify('Generating summary...');
				let message = 'Summary updated successfully.';
				(async () => {
					let summary = '';
					for await (const summaryChunk of prompt(promptText, this.settings.apiKey, this.settings.maxTokens)) {
						if (!this.settings.putSummaryInFrontmatter) editor.replaceSelection(summaryChunk);
						summary += summaryChunk;
					}
					if (this.settings.putSummaryInFrontmatter) {
						this.app.fileManager.processFrontMatter(activeFile, (fm) => {
							fm['summary'] = summary;
						});
					} else {
						message = 'Selection summarized successfully.';
					}
					Notify(message);
				})();
			} else {
				throw new Error('Please enter your OpenAI API Key in the settings.');
			}
		} catch (error) {
			Notify(error);
			return;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, default_settings, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async onload() {
		await this.loadSettings();
		console.log(`AI Summarize v${this.manifest.version} loaded!`);

		this.registerEvent(this.app.workspace.on('editor-menu', this.handleHighlighterInContextMenu));

		this.addCommand({
			id: 'summarize-selection',
			name: 'Summarize selection',
			icon: 'lucide-bot',
			editorCallback: (editor, ctx) => {
				const selected = editor.getSelection();
				const wordCount = selected.split(' ').length;

				if (selected) {
					if (wordCount > 10) {
						this.generateSummary(selected, editor);
						return true;
					}

					Notify('Selected text is too short!');
					return false;
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AiSummarizeSettingTab(this.app, this));
	}

	async onunload() {
		console.log('unloading plugin of Ravenwits!');
	}

	handleHighlighterInContextMenu = (menu: Menu, editor: EnhancedEditor): void => {
		const selection = editor.getSelection();
		if (selection) {
			menu.addSeparator();
			menu.addItem((item) => {
				item
					.setTitle('AI summarize')
					.setIcon('lucide-bot')
					.onClick((e) => {
						if (editor.getSelection()) {
							const selected = editor.getSelection();
							const wordCount = selected.split(' ').length;

							if (wordCount > 10) {
								this.generateSummary(selection, editor);
							} else Notify('Selected text is too short!');
						}
					});
			});
		}
	};
}
