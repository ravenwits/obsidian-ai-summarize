import { App, PluginSettingTab, Setting } from "obsidian";
import Notify from "src/plugin/Notify";
import type AISummarizePlugin from "src/plugin/main";

export type SummaryPlacement =
	| "frontmatter"
	| "replace"
	| "below"
	| "append-current"
	| "new-note"
	| "daily-note";
export type SummaryPresetId =
	| "concise"
	| "detailed"
	| "bullet-points"
	| "action-items"
	| "study-notes"
	| "meeting-notes";

export interface SummaryPresetDefinition {
	id: SummaryPresetId;
	name: string;
	description: string;
	promptInstruction: string;
	systemInstruction: string;
}

export interface ModelProfile {
	id: string;
	name: string;
	model: string;
	maxTokens: number;
	defaultPrompt: string;
	systemInstruction?: string;
	summaryPlacement?: SummaryPlacement;
	linkAwareFullNoteSummaries?: boolean;
}

export interface AiSummarizePluginSettings {
	apiKey: string;
	maxTokens: number;
	defaultPrompt: string;
	model?: string;
	availableModels?: string[];
	systemInstruction?: string;
	summaryPlacement?: SummaryPlacement;
	linkAwareFullNoteSummaries?: boolean;
	profiles?: ModelProfile[];
	activeProfileId?: string;
}

export const DEFAULT_MODEL = "gpt-4o-mini";
export const DEFAULT_MAX_TOKENS = 1000;
export const MIN_SELECTION_WORDS = 30;
export const MIN_MAX_TOKENS = 128;
export const MAX_MAX_TOKENS = 16000;
export const DEFAULT_PROMPT =
	"Generate a concise summary of the following note in 3-4 sentences:\n\n";
export const SUMMARY_PRESETS: SummaryPresetDefinition[] = [
	{
		id: "concise",
		name: "Concise summary",
		description: "A short 3-4 sentence overview.",
		promptInstruction:
			"For this run, keep the result to 3-4 clear sentences.",
		systemInstruction: "",
	},
	{
		id: "detailed",
		name: "Detailed summary",
		description: "A fuller summary that preserves important details.",
		promptInstruction:
			"For this run, produce a detailed summary. Preserve important names, dates, decisions, definitions, and supporting context.",
		systemInstruction:
			"Use clear markdown. Include the main idea first, then the important supporting details.",
	},
	{
		id: "bullet-points",
		name: "Bullet points",
		description: "A scannable markdown bullet list.",
		promptInstruction:
			"For this run, summarize the note as clear markdown bullet points. Group related ideas together and avoid repetition.",
		systemInstruction:
			"Use concise bullets. Keep each bullet focused on one idea.",
	},
	{
		id: "action-items",
		name: "Action items",
		description: "Tasks, owners, and follow-ups when present.",
		promptInstruction:
			"For this run, extract action items. Include owners, deadlines, blockers, and follow-ups when they are stated. If no action items are present, say so briefly.",
		systemInstruction:
			"Use markdown checkboxes for tasks. Do not invent owners or deadlines.",
	},
	{
		id: "study-notes",
		name: "Study notes",
		description: "Structured notes for learning and review.",
		promptInstruction:
			"For this run, turn the note into study notes. Include key concepts, definitions, examples, and a short review checklist.",
		systemInstruction:
			"Use markdown headings and bullets. Make the result easy to review later.",
	},
	{
		id: "meeting-notes",
		name: "Meeting notes",
		description: "Meeting-style summary with decisions and next steps.",
		promptInstruction:
			"For this run, summarize the note as meeting notes. Include agenda or topics, key discussion points, decisions, and next steps when present.",
		systemInstruction:
			"Use clear sections. Do not invent decisions or next steps.",
	},
];
export const FALLBACK_MODELS = [
	"gpt-4o-mini",
	"gpt-4o",
	"gpt-4.1-mini",
	"gpt-4.1",
	"gpt-5-chat-latest",
	"gpt-5-mini",
	"o4-mini",
];

const SPONSOR_URL = "https://www.buymeacoffee.com/ravenwits";

export const default_settings: AiSummarizePluginSettings = {
	apiKey: "",
	maxTokens: DEFAULT_MAX_TOKENS,
	defaultPrompt: DEFAULT_PROMPT,
	model: DEFAULT_MODEL,
	availableModels: [...FALLBACK_MODELS],
	systemInstruction: "",
	summaryPlacement: "replace",
	linkAwareFullNoteSummaries: false,
	profiles: [
		{
			id: "default",
			name: "Default",
			model: DEFAULT_MODEL,
			maxTokens: DEFAULT_MAX_TOKENS,
			defaultPrompt: DEFAULT_PROMPT,
			systemInstruction: "",
			summaryPlacement: "replace",
			linkAwareFullNoteSummaries: false,
		},
	],
	activeProfileId: "default",
};

const MODEL_CAPABILITIES: Record<string, string[]> = {
	"gpt-4.1": ["Chat"],
	"gpt-4.1-mini": ["Chat"],
	"gpt-4.1-nano": ["Chat"],
	"gpt-4o": ["Vision", "Chat"],
	"gpt-4o-mini": ["Vision", "Chat"],
	"gpt-5": ["Reasoning"],
	"gpt-5-chat-latest": ["Reasoning", "Chat"],
	"gpt-5-mini": ["Reasoning"],
	"gpt-5-nano": ["Reasoning"],
	o1: ["Reasoning"],
	"o1-mini": ["Reasoning"],
	o3: ["Reasoning"],
	"o3-mini": ["Reasoning"],
	"o4-mini": ["Reasoning"],
};

function labelForModel(id: string): string {
	const tags = MODEL_CAPABILITIES[id] || [];
	return tags.length ? `${id} (${tags.join(", ")})` : id;
}

function genId(prefix = "profile"): string {
	return `${prefix}_${Math.random()
		.toString(36)
		.slice(2, 8)}_${Date.now().toString(36)}`;
}

export function clampMaxTokens(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_MAX_TOKENS;
	}

	return Math.min(
		MAX_MAX_TOKENS,
		Math.max(MIN_MAX_TOKENS, Math.trunc(value))
	);
}

export function isSummaryPlacement(value: string): value is SummaryPlacement {
	return (
		value === "replace" ||
		value === "below" ||
		value === "frontmatter" ||
		value === "append-current" ||
		value === "new-note" ||
		value === "daily-note"
	);
}

function normalizeAvailableModels(models: string[] | undefined): string[] {
	const unique = Array.from(new Set(models?.filter(Boolean) || []));
	return unique.length ? unique : [...FALLBACK_MODELS];
}

function normalizeProfile(profile: ModelProfile, linkAwareFallback: boolean): void {
	delete (profile as ModelProfile & { summaryPresetId?: unknown }).summaryPresetId;
	profile.name = profile.name || "Default";
	profile.model = profile.model || DEFAULT_MODEL;
	if (profile.model === "gpt-3.5-turbo") {
		profile.model = DEFAULT_MODEL;
	}
	profile.maxTokens = clampMaxTokens(profile.maxTokens);
	profile.defaultPrompt = profile.defaultPrompt || DEFAULT_PROMPT;
	profile.systemInstruction = profile.systemInstruction || "";
	profile.summaryPlacement = profile.summaryPlacement || "replace";
	profile.linkAwareFullNoteSummaries =
		profile.linkAwareFullNoteSummaries === undefined
			? linkAwareFallback
			: Boolean(profile.linkAwareFullNoteSummaries);
}

export function normalizeSettings(settings: AiSummarizePluginSettings): void {
	delete (settings as AiSummarizePluginSettings & { summaryPresetId?: unknown })
		.summaryPresetId;
	settings.apiKey = settings.apiKey || "";
	settings.defaultPrompt = settings.defaultPrompt || DEFAULT_PROMPT;
	settings.systemInstruction = settings.systemInstruction || "";
	settings.maxTokens = clampMaxTokens(settings.maxTokens);
	settings.availableModels = normalizeAvailableModels(settings.availableModels);
	settings.summaryPlacement = settings.summaryPlacement || "replace";
	settings.linkAwareFullNoteSummaries = Boolean(
		settings.linkAwareFullNoteSummaries
	);

	if (!settings.model) {
		settings.model = DEFAULT_MODEL;
	}
	if (settings.model === "gpt-3.5-turbo") {
		settings.model = DEFAULT_MODEL;
	}

	ensureProfilesInitialized(settings);
	for (const profile of settings.profiles || []) {
		normalizeProfile(profile, settings.linkAwareFullNoteSummaries);
	}
}

function ensureProfilesInitialized(settings: AiSummarizePluginSettings): void {
	if (settings.profiles && settings.profiles.length > 0) {
		return;
	}

	settings.profiles = [
		{
			id: "default",
			name: "Default",
			model: settings.model || DEFAULT_MODEL,
			maxTokens: settings.maxTokens ?? DEFAULT_MAX_TOKENS,
			defaultPrompt: settings.defaultPrompt || DEFAULT_PROMPT,
			systemInstruction: settings.systemInstruction || "",
			summaryPlacement: settings.summaryPlacement || "replace",
			linkAwareFullNoteSummaries: Boolean(
				settings.linkAwareFullNoteSummaries
			),
		},
	];
	settings.activeProfileId = "default";
}

function getActiveProfile(
	settings: AiSummarizePluginSettings
): ModelProfile | undefined {
	const profiles = settings.profiles || [];
	if (!profiles.length) {
		return undefined;
	}

	const id = settings.activeProfileId || profiles[0].id;
	return profiles.find((profile) => profile.id === id) || profiles[0];
}

function applyProfileToRoot(
	settings: AiSummarizePluginSettings,
	profile: ModelProfile
): void {
	settings.model = profile.model;
	settings.maxTokens = clampMaxTokens(profile.maxTokens);
	settings.defaultPrompt = profile.defaultPrompt;
	settings.systemInstruction = profile.systemInstruction || "";
	settings.summaryPlacement = profile.summaryPlacement || "replace";
	settings.linkAwareFullNoteSummaries = Boolean(
		profile.linkAwareFullNoteSummaries
	);
}

export function upsertActiveProfileFromRoot(
	settings: AiSummarizePluginSettings
): void {
	const profile = getActiveProfile(settings);
	if (!profile) {
		return;
	}

	profile.model = settings.model || profile.model || DEFAULT_MODEL;
	profile.maxTokens = clampMaxTokens(settings.maxTokens);
	profile.defaultPrompt = settings.defaultPrompt || DEFAULT_PROMPT;
	profile.systemInstruction = settings.systemInstruction || "";
	profile.summaryPlacement = settings.summaryPlacement || "replace";
	profile.linkAwareFullNoteSummaries = Boolean(
		settings.linkAwareFullNoteSummaries
	);
}

function getModelOptions(settings: AiSummarizePluginSettings): Record<string, string> {
	const activeProfile = getActiveProfile(settings);
	const models = normalizeAvailableModels([
		...(settings.availableModels || []),
		settings.model || "",
		activeProfile?.model || "",
	]);

	return Object.fromEntries(models.map((model) => [model, labelForModel(model)]));
}

export default class AiSummarizeSettingTab extends PluginSettingTab {
	plugin: AISummarizePlugin;

	constructor(app: App, plugin: AISummarizePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		normalizeSettings(this.plugin.settings);

		const activeProfileInit = getActiveProfile(this.plugin.settings);
		if (activeProfileInit) {
			applyProfileToRoot(this.plugin.settings, activeProfileInit);
		}

		new Setting(containerEl).setName("Profiles").setHeading();
		new Setting(containerEl)
			.setName("Active profile")
			.setDesc("Select which profile to use for summarization.")
			.addDropdown((dropdown) => {
				const profiles = this.plugin.settings.profiles || [];
				const options = Object.fromEntries(
					profiles.map((profile) => [profile.id, profile.name || profile.id])
				);

				dropdown
					.addOptions(options)
					.setValue(
						this.plugin.settings.activeProfileId ||
							(profiles[0] ? profiles[0].id : "default")
					)
					.onChange(async (id) => {
						this.plugin.settings.activeProfileId = id;
						const chosen = (this.plugin.settings.profiles || []).find(
							(profile) => profile.id === id
						);

						if (!chosen) {
							return;
						}

						applyProfileToRoot(this.plugin.settings, chosen);
						await this.plugin.saveSettings();
						this.display();
					});
			})
			.addButton((button) =>
				button
					.setButtonText("New profile")
					.setCta()
					.onClick(async () => {
						const count = (this.plugin.settings.profiles || []).length;
						const id = genId();
						const newProfile: ModelProfile = {
							id,
							name: `Profile ${count + 1}`,
							model: this.plugin.settings.model || DEFAULT_MODEL,
							maxTokens: clampMaxTokens(this.plugin.settings.maxTokens),
							defaultPrompt:
								this.plugin.settings.defaultPrompt || DEFAULT_PROMPT,
							systemInstruction:
								this.plugin.settings.systemInstruction || "",
							summaryPlacement:
								this.plugin.settings.summaryPlacement || "replace",
							linkAwareFullNoteSummaries: Boolean(
								this.plugin.settings.linkAwareFullNoteSummaries
							),
						};

						this.plugin.settings.profiles = [
							...(this.plugin.settings.profiles || []),
							newProfile,
						];
						this.plugin.settings.activeProfileId = id;
						applyProfileToRoot(this.plugin.settings, newProfile);
						await this.plugin.saveSettings();
						this.display();
					})
			)
			.addButton((button) =>
				button.setButtonText("Delete profile").onClick(async () => {
					const profiles = this.plugin.settings.profiles || [];
					if (profiles.length <= 1) {
						Notify("Keep at least one profile.");
						return;
					}

					const activeId =
						this.plugin.settings.activeProfileId || profiles[0].id;
					const remaining = profiles.filter(
						(profile) => profile.id !== activeId
					);

					this.plugin.settings.profiles = remaining;
					this.plugin.settings.activeProfileId = remaining[0].id;
					applyProfileToRoot(this.plugin.settings, remaining[0]);
					await this.plugin.saveSettings();
					this.display();
				})
			);

		new Setting(containerEl)
			.setName("Profile name")
			.setDesc("Rename the active profile.")
			.addText((text) => {
				const active = getActiveProfile(this.plugin.settings);
				text.setPlaceholder("Profile name")
					.setValue(active?.name || "")
					.onChange(async (value) => {
						const profile = getActiveProfile(this.plugin.settings);
						if (!profile || !value.trim()) {
							return;
						}

						profile.name = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName("Generation").setHeading();

		new Setting(containerEl)
			.setName("OpenAI API key")
			.setTooltip(
				"Get your key from the OpenAI API keys page."
			)
			.setDesc("Required to generate summaries with OpenAI.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.setAttribute("autocomplete", "off");
				text.setPlaceholder("OpenAI API key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Max tokens")
			.setDesc(
				`Maximum output tokens. Use ${MIN_MAX_TOKENS}-${MAX_MAX_TOKENS}; default is ${DEFAULT_MAX_TOKENS}.`
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_MAX_TOKENS.toString())
					.setValue(this.plugin.settings.maxTokens.toString())
					.onChange(async (value) => {
						if (!value.trim()) {
							return;
						}

						const parsed = Number.parseInt(value, 10);
						if (!Number.isFinite(parsed)) {
							Notify("Max tokens must be a number.");
							return;
						}

						this.plugin.settings.maxTokens = clampMaxTokens(parsed);
						upsertActiveProfileFromRoot(this.plugin.settings);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("AI model")
			.setDesc(`Model used for summaries. Default is ${DEFAULT_MODEL}.`)
			.setTooltip(
				"Reasoning models may stream more slowly. For GPT-5 chat-style output, use the chat-latest GPT-5 model."
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOptions(getModelOptions(this.plugin.settings))
					.setValue(this.plugin.settings.model || DEFAULT_MODEL)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						upsertActiveProfileFromRoot(this.plugin.settings);
						await this.plugin.saveSettings();
					});
			})
			.addButton((button) =>
				button.setButtonText("Refresh models").onClick(() => {
					if (!this.plugin.settings.apiKey) {
						Notify("Add an OpenAI API key first.");
						return;
					}

					void this.plugin.refreshAvailableModelsWithProgress().then(() => {
						this.display();
					});
				})
			);

		new Setting(containerEl)
			.setName("Default prompt")
			.setDesc("Prompt used before the selected note text.")
			.addTextArea((text) =>
				text
					.setPlaceholder("Your custom prompt")
					.setValue(this.plugin.settings.defaultPrompt)
					.onChange(async (value) => {
						this.plugin.settings.defaultPrompt = value || DEFAULT_PROMPT;
						upsertActiveProfileFromRoot(this.plugin.settings);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("System instructions")
			.setDesc("Optional guidance for tone, constraints, style, or language.")
			.setTooltip(
				"For example: Respond in the user's preferred language, use bullet points, or keep the response under 100 words."
			)
			.addTextArea((text) =>
				text
					.setPlaceholder(
						"You are a helpful assistant that summarizes notes."
					)
					.setValue(this.plugin.settings.systemInstruction || "")
					.onChange(async (value) => {
						this.plugin.settings.systemInstruction = value;
						upsertActiveProfileFromRoot(this.plugin.settings);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Output destination")
			.setDesc("Choose where generated output should go.")
			.addDropdown((dropdown) => {
				dropdown
					.addOptions({
						replace: "Replace selection",
						below: "Insert below selection",
						frontmatter: "Frontmatter (YAML: summary)",
						"append-current": "Append to current note",
						"new-note": "Create new note",
						"daily-note": "Append to daily note",
					})
					.setValue(this.plugin.settings.summaryPlacement || "replace")
					.onChange(async (value) => {
						if (!isSummaryPlacement(value)) {
							return;
						}

						this.plugin.settings.summaryPlacement = value;
						upsertActiveProfileFromRoot(this.plugin.settings);
						await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Link-aware full-note summaries")
			.setDesc(
				"When summarizing a full note, include summaries or short excerpts from directly linked notes within the model budget."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(Boolean(this.plugin.settings.linkAwareFullNoteSummaries))
					.onChange(async (value) => {
						this.plugin.settings.linkAwareFullNoteSummaries = value;
						upsertActiveProfileFromRoot(this.plugin.settings);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName("How to use").setHeading();
		containerEl.createEl("p", {
			text: `Select at least ${MIN_SELECTION_WORDS} words in a note, then choose AI summarize from the context menu or run Summarize selection from the command palette.`,
		});

		new Setting(containerEl).setName("Support").setHeading();
		new Setting(containerEl)
			.setName("Buy me a coffee")
			.setDesc(
				"If this plugin is useful, you can support continued development."
			)
			.addButton((button) =>
				button.setButtonText("Open sponsor page").onClick(() => {
					activeWindow.open(SPONSOR_URL, "_blank", "noopener,noreferrer");
				})
			);
	}
}
