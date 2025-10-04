import OpenAI from "openai";

// Stream a summary using the official OpenAI SDK (Responses API)
// Yields tokens as they arrive for good UX in the editor.
export async function* prompt(
	prompt: string,
	apiKey: string,
	maxTokens: number,
	model: string = "gpt-4o-mini",
	instructions?: string,
	options?: { signal?: AbortSignal }
) {
	// Initialize the client for browser environment (Obsidian renderer)
	const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
	console.log(`Making request to model: ${model}`);

	// Prefer Responses API for all models (especially GPT-5 and reasoning models)
	// Token limit param for Responses API is max_output_tokens.
	const isReasoningModel =
		model.startsWith("gpt-5") ||
		model.startsWith("o1") ||
		model.startsWith("o3") ||
		model.startsWith("o4");
	const request: any = {
		model,
		input: prompt,
		max_output_tokens: maxTokens,
	};
	if (instructions && instructions.trim().length > 0) {
		request.instructions = instructions;
	}
	// Only set temperature for non-reasoning chat models (reasoning models reject it)
	if (!isReasoningModel) {
		request.temperature = 0.7;
	}

	let fullText = "";

	try {
		// Use streaming for best UX
		const stream = await (client as any).responses.stream(request);

		// Wire abort signal to stream abort for concurrency guard
		if (options?.signal && (stream as any)?.controller?.abort) {
			const onAbort = () => {
				try {
					(stream as any).controller.abort();
				} catch (e) {
					console.warn("Failed to abort stream controller", e);
				}
			};
			if (options.signal.aborted) onAbort();
			else options.signal.addEventListener("abort", onAbort, { once: true });
		}

		// The SDK emits incremental text deltas; iterate and yield tokens until completion
		for await (const event of stream as any) {
			if (
				event?.type === "response.output_text.delta" &&
				typeof event.delta === "string"
			) {
				fullText += event.delta;
				yield event.delta;
			}
			if (event?.type === "response.completed") {
				break;
			}
		}
	} catch (err: any) {
		// If stream was aborted by SDK/user, return whatever we have without duplicating the request
		if (
			err?.name === "APIUserAbortError" ||
			/aborted/i.test(String(err?.message || ""))
		) {
			console.warn(
				"Streaming aborted by SDK/user; returning partial text.",
				err
			);
			return fullText;
		}
		// Fallback: non-streaming call to ensure at least some response
		console.warn(
			"Streaming failed; falling back to non-streaming response.",
			err
		);
		const resp = await client.responses.create(request);
		const text = (resp as any)?.output_text ?? "";
		fullText = text;
		if (text) yield text;
	}

	return fullText;
}
