import OpenAI, { APIUserAbortError } from "openai";
import type { ResponseCreateAndStreamParams } from "openai/lib/responses/ResponseStream";

const REASONING_MODEL_PREFIXES = ["gpt-5", "o1", "o3", "o4"];

export function isAbortError(error: unknown): boolean {
	if (error instanceof APIUserAbortError) {
		return true;
	}

	if (error instanceof DOMException && error.name === "AbortError") {
		return true;
	}

	return (
		error instanceof Error &&
		/abort|aborted|cancelled|canceled/i.test(error.message)
	);
}

function isReasoningModel(model: string): boolean {
	return REASONING_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
}

function buildRequest(
	input: string,
	maxTokens: number,
	model: string,
	instructions?: string
): ResponseCreateAndStreamParams {
	const request: ResponseCreateAndStreamParams = {
		model,
		input,
		max_output_tokens: Math.max(1, Math.trunc(maxTokens)),
	};

	const trimmedInstructions = instructions?.trim();
	if (trimmedInstructions) {
		request.instructions = trimmedInstructions;
	}

	if (!isReasoningModel(model)) {
		request.temperature = 0.7;
	}

	return request;
}

export async function* prompt(
	input: string,
	apiKey: string,
	maxTokens: number,
	model = "gpt-4o-mini",
	instructions?: string,
	options?: { signal?: AbortSignal }
) {
	const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
	const request = buildRequest(input, maxTokens, model, instructions);
	let fullText = "";

	try {
		const stream = client.responses.stream(request, {
			maxRetries: 0,
			signal: options?.signal,
		});

		for await (const event of stream) {
			if (options?.signal?.aborted) {
				return fullText;
			}

			if (event.type === "response.output_text.delta") {
				fullText += event.delta;
				yield event.delta;
			}

			if (event.type === "error") {
				throw new Error(event.message);
			}

			if (event.type === "response.failed") {
				throw new Error(
					event.response.error?.message || "OpenAI response failed."
				);
			}

			if (event.type === "response.incomplete") {
				const reason = event.response.incomplete_details?.reason;
				throw new Error(
					reason
						? `OpenAI response incomplete: ${reason}.`
						: "OpenAI response incomplete."
				);
			}
		}
	} catch (error) {
		if (isAbortError(error)) {
			return fullText;
		}

		throw error;
	}

	return fullText;
}
