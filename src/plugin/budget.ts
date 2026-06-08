export const TOKEN_CHAR_RATIO = 4;
export const DEFAULT_CONTEXT_WINDOW = 128000;
export const DEFAULT_PROMPT_OVERHEAD = 1000;

const CONTEXT_WINDOWS: Record<string, number> = {
	"gpt-4": 8192,
	"gpt-4-turbo": 128000,
	"gpt-4.1": 1000000,
	"gpt-4.1-mini": 1000000,
	"gpt-4.1-nano": 1000000,
	"gpt-4o": 128000,
	"gpt-4o-mini": 128000,
	"gpt-5": 1000000,
	"gpt-5-chat-latest": 1000000,
	"gpt-5-mini": 400000,
	"gpt-5-nano": 400000,
	o1: 200000,
	o3: 200000,
	"o3-mini": 200000,
	"o4-mini": 200000,
};

const CONTEXT_WINDOW_PREFIXES: Array<[string, number]> = [
	["gpt-4.1", 1000000],
	["gpt-4o", 128000],
	["gpt-5-chat", 1000000],
	["gpt-5-mini", 400000],
	["gpt-5-nano", 400000],
	["gpt-5", 1000000],
	["gpt-4-turbo", 128000],
	["gpt-4", 8192],
	["o4", 200000],
	["o3", 200000],
	["o1", 200000],
];

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / TOKEN_CHAR_RATIO);
}

export function contextWindowForModel(model: string | undefined): number {
	if (!model) {
		return DEFAULT_CONTEXT_WINDOW;
	}

	const exact = CONTEXT_WINDOWS[model];
	if (exact) {
		return exact;
	}

	const normalized = model.toLowerCase();
	return (
		CONTEXT_WINDOW_PREFIXES.find(([prefix]) =>
			normalized.startsWith(prefix)
		)?.[1] || DEFAULT_CONTEXT_WINDOW
	);
}

export function safeInputBudget(
	model: string | undefined,
	outputBudget: number,
	overhead = DEFAULT_PROMPT_OVERHEAD
): number {
	return Math.max(1000, contextWindowForModel(model) - outputBudget - overhead);
}

export function tokenBudgetToChars(tokenBudget: number): number {
	return Math.max(0, Math.floor(tokenBudget * TOKEN_CHAR_RATIO));
}

export function trimToTokenBudget(text: string, tokenBudget: number): string {
	const maxChars = tokenBudgetToChars(tokenBudget);
	if (text.length <= maxChars) {
		return text;
	}

	return `${text.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n\n[Truncated]`;
}

export function splitIntoChunks(text: string, chunkCharTarget: number): string[] {
	if (text.length <= chunkCharTarget) {
		return [text];
	}

	const paragraphs = text.split(/\n\n+/);
	const chunks: string[] = [];
	let current = "";

	for (const paragraph of paragraphs) {
		const candidate = current.length ? `${current}\n\n${paragraph}` : paragraph;

		if (candidate.length <= chunkCharTarget || !current) {
			current = candidate;
		} else {
			chunks.push(current);
			current = paragraph;
		}
	}

	if (current) {
		chunks.push(current);
	}

	return chunks;
}
