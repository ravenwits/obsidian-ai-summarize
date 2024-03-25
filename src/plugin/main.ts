import { App, Editor, Menu, Plugin, MarkdownView, TFile } from 'obsidian';
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

	updateSummary(md: string, newSummary: string): Record<string, string> {
		const frontmatterMatch = md.match(this.frontmatterRegex);
		const frontmatter: Record<string, string | string[]> = {};

		if (frontmatterMatch) {
			const frontmatterString = frontmatterMatch[1];
			let currentKey = '';
			frontmatterString.split('\n').forEach((line) => {
				if (line.startsWith('-')) {
					// This line is part of a list
					if (!frontmatter[currentKey]) {
						frontmatter[currentKey] = [];
					}
					frontmatter[currentKey] = line.trim().replace('-', '');
				} else {
					const [key, value] = line.split(':').map((item) => item.trim());
					currentKey = key.toLowerCase();
					frontmatter[currentKey] = value;
				}
			});
		}
		const updatedFrontmatter = { ...frontmatter, summary: newSummary };
		return updatedFrontmatter;
	}

	async updateFrontmatter(content: string, frontmatter: any, activeFile: TFile): Promise<void> {
		function serializeToYaml(properties: any): string {
			// Start with the opening delimiter
			let yamlString = '---\n';

			// Iterate over each property in the object
			for (const [key, value] of Object.entries(properties)) {
				// Handle the tags array separately
				if (Array.isArray(value)) {
					value.forEach((v: string) => {
						yamlString += `${key}: "${v}"\n`;
					});
				} else {
					// For other properties, add them to the YAML string
					yamlString += value != undefined ? `${key}: ${value}\n` : `${key}\n`;
				}
			}

			yamlString += `---\n`;

			return yamlString;
		}

		const serializedFrontMatter = serializeToYaml(frontmatter);
		const updatedContent = serializedFrontMatter + content.replace(this.frontmatterRegex, '');

		await this.app.vault.modify(activeFile, updatedContent);
		Notify('Summary updated successfully.');
	}

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
						const content = await this.app.vault.read(activeFile);
						const frontmatter = this.updateSummary(content, `"${summary}"`);
						this.updateFrontmatter(content, frontmatter, activeFile);
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
			id: 'ai-summarize-summarize-selection',
			name: 'Summarize Selection',
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
					.setTitle('AI Summarize')
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
