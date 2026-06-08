import { SUMMARY_PRESETS, type SummaryPresetDefinition } from "src/settings/settings";

export type PromptPresetGroup = "summary" | "review" | "open-loops";
export type DigestType =
	| "project-status"
	| "weekly-digest"
	| "research-digest"
	| "meeting-digest"
	| "open-loops-digest";

export interface PromptPresetDefinition {
	id: string;
	name: string;
	description: string;
	promptInstruction: string;
	systemInstruction: string;
	group: PromptPresetGroup;
	icon: string;
}

export interface DigestPresetDefinition {
	id: DigestType;
	name: string;
	description: string;
	promptInstruction: string;
	systemInstruction: string;
}

function fromSummaryPreset(
	preset: SummaryPresetDefinition
): PromptPresetDefinition {
	return {
		...preset,
		group: "summary",
		icon: "lucide-list",
	};
}

export const REVIEW_PRESETS: PromptPresetDefinition[] = [
	{
		id: "review-questions",
		name: "Review questions",
		description: "Questions for active recall.",
		promptInstruction:
			"For this run, create review questions that test understanding of the selected text. Include concise answers after each question.",
		systemInstruction:
			"Use markdown. Make questions specific, useful, and grounded only in the selected text.",
		group: "review",
		icon: "lucide-circle-help",
	},
	{
		id: "flashcards",
		name: "Flashcards",
		description: "Question and answer cards for review.",
		promptInstruction:
			"For this run, turn the selected text into flashcards. Use a question on the front and a short answer on the back.",
		systemInstruction:
			"Use markdown. Format each card as front and back. Avoid duplicating cards.",
		group: "review",
		icon: "lucide-copy-check",
	},
	{
		id: "explain-simply",
		name: "Explain simply",
		description: "A plain-language explanation.",
		promptInstruction:
			"For this run, explain the selected text simply for someone new to the topic. Preserve the important meaning without jargon where possible.",
		systemInstruction:
			"Use clear markdown and simple language. Do not add facts that are not supported by the text.",
		group: "review",
		icon: "lucide-sparkles",
	},
	{
		id: "what-to-remember",
		name: "What to remember",
		description: "The most important takeaways.",
		promptInstruction:
			"For this run, extract the most important things to remember from the selected text. Prioritize durable takeaways over details.",
		systemInstruction:
			"Use a compact markdown list. Keep each takeaway actionable or memorable.",
		group: "review",
		icon: "lucide-brain",
	},
];

export const OPEN_LOOP_PRESETS: PromptPresetDefinition[] = [
	{
		id: "open-loops",
		name: "Open loops",
		description: "Questions, follow-ups, unresolved decisions, and missing context.",
		promptInstruction:
			"For this run, identify open loops in the selected text. Include open questions, follow-ups, unresolved decisions, missing context, and action items. If none are present, say so briefly.",
		systemInstruction:
			"Use markdown headings. Do not invent work that is not implied by the text.",
		group: "open-loops",
		icon: "lucide-list-checks",
	},
	{
		id: "open-questions",
		name: "Open questions",
		description: "Questions still needing answers.",
		promptInstruction:
			"For this run, extract only open questions from the selected text. If no open questions are present, say so briefly.",
		systemInstruction:
			"Use a concise markdown list. Do not invent questions.",
		group: "open-loops",
		icon: "lucide-message-circle-question",
	},
	{
		id: "unresolved-decisions",
		name: "Unresolved decisions",
		description: "Decisions that still need closure.",
		promptInstruction:
			"For this run, extract unresolved decisions and decision points from the selected text. Include what needs to be decided and any known options.",
		systemInstruction:
			"Use markdown. Do not invent options or owners.",
		group: "open-loops",
		icon: "lucide-git-branch",
	},
	{
		id: "missing-context",
		name: "Missing context",
		description: "Context gaps that make the note harder to act on.",
		promptInstruction:
			"For this run, identify missing context in the selected text. Focus on unclear references, unstated assumptions, missing owners, missing deadlines, and ambiguous next steps.",
		systemInstruction:
			"Use markdown. Be specific about what is missing and why it matters.",
		group: "open-loops",
		icon: "lucide-search",
	},
];

export const CONTEXT_MENU_PRESETS: PromptPresetDefinition[] = [
	...SUMMARY_PRESETS.map(fromSummaryPreset),
	...REVIEW_PRESETS,
	...OPEN_LOOP_PRESETS,
];

export const DIGEST_PRESETS: DigestPresetDefinition[] = [
	{
		id: "project-status",
		name: "Project status",
		description: "Status, decisions, blockers, and next steps.",
		promptInstruction:
			"Create a project status digest from these note summaries. Include current status, key progress, decisions, blockers, risks, and next steps.",
		systemInstruction:
			"Use clear markdown headings. Be concrete and avoid generic summaries.",
	},
	{
		id: "weekly-digest",
		name: "Weekly digest",
		description: "A weekly-style recap of recent notes.",
		promptInstruction:
			"Create a weekly digest from these note summaries. Include themes, notable updates, completed work, open loops, and suggested next actions.",
		systemInstruction:
			"Use concise markdown sections and preserve important dates or names when present.",
	},
	{
		id: "research-digest",
		name: "Research digest",
		description: "Findings, evidence, questions, and directions.",
		promptInstruction:
			"Create a research digest from these note summaries. Include key findings, evidence, contradictions, open questions, and promising directions.",
		systemInstruction:
			"Use markdown headings. Distinguish facts from unresolved questions.",
	},
	{
		id: "meeting-digest",
		name: "Meeting digest",
		description: "Decisions, action items, and follow-ups across meeting notes.",
		promptInstruction:
			"Create a meeting digest from these note summaries. Include decisions, action items, owners, deadlines, follow-ups, and unresolved discussion points when present.",
		systemInstruction:
			"Use markdown checkboxes for action items. Do not invent owners or deadlines.",
	},
	{
		id: "open-loops-digest",
		name: "Open loops digest",
		description: "Folder-level questions, blockers, and unresolved work.",
		promptInstruction:
			"Create an open loops digest from these note summaries. Focus on open questions, blockers, missing context, unresolved decisions, and follow-up tasks.",
		systemInstruction:
			"Use markdown headings and checkboxes where useful. Do not invent work.",
	},
];

export function getDigestPreset(id: DigestType): DigestPresetDefinition {
	return DIGEST_PRESETS.find((preset) => preset.id === id) || DIGEST_PRESETS[0];
}

export function joinInstructionSections(
	...sections: Array<string | undefined>
): string {
	return sections
		.map((section) => section?.trim())
		.filter((section): section is string => Boolean(section))
		.join("\n\n");
}
