import type { TrackEvent, WrapOptions } from "../types.js";
import { getSafeValue, hasProperty } from "./types.js";
import type { AnthropicType, WrappedFunction } from "./types.js";

type AnthropicCreate = (...args: unknown[]) => Promise<unknown>;

export function wrapAnthropic<T extends AnthropicType>(
	anthropic: T,
	tracker: (event: TrackEvent) => void,
	options?: WrapOptions,
): T {
	const originalCreate = anthropic.messages
		?.create as WrappedFunction<AnthropicCreate>;
	if (originalCreate?.__noryen_wrapped__) {
		throw new Error("[Noryen SDK] This Anthropic client is already wrapped.");
	}

	const messagesObject = hasProperty(anthropic, "messages")
		? (anthropic.messages as Record<string, unknown>)
		: {};

	const wrapped = {
		...anthropic,
		messages: {
			...messagesObject,
			create: async (
				params: Record<string, unknown>,
				requestOptions?: unknown,
			): Promise<unknown> => {
				const start = Date.now();
				const requestId = crypto.randomUUID();

				try {
					const result = await (
						anthropic.messages.create as (
							...args: unknown[]
						) => Promise<unknown>
					).call(anthropic.messages, params, requestOptions);
					const latency = Date.now() - start;

					const resultRecord = result as Record<string, unknown>;
					const content = getSafeValue<unknown>(
						resultRecord,
						["content"],
						null,
					);

					let responseText = "";
					if (Array.isArray(content) && content.length > 0) {
						const first = content[0] as Record<string, unknown>;
						responseText =
							first.type === "text"
								? String(first.text)
								: JSON.stringify(first);
					} else {
						responseText = JSON.stringify(content ?? "");
					}

					const usage = hasProperty(resultRecord, "usage")
						? (resultRecord.usage as Record<string, unknown>)
						: {};
					const inputTokens = getSafeValue<number | undefined>(
						usage,
						["input_tokens"],
						undefined,
					);
					const outputTokens = getSafeValue<number | undefined>(
						usage,
						["output_tokens"],
						undefined,
					);

					tracker({
						requestId,
						timestamp: new Date().toISOString(),
						prompt: Array.isArray(params.messages)
							? (params.messages as Record<string, unknown>[])
							: [],
						response: responseText,
						model: (options?.modelOverride ||
							params.model ||
							"anthropic-message") as string,
						latency,
						provider: "anthropic",
						success: true,
						inputTokens,
						outputTokens,
						totalTokens:
							inputTokens != null && outputTokens != null
								? inputTokens + outputTokens
								: undefined,
						metadata: {
							...options?.metadata,
							rawRequest: params,
							rawResponse: result,
						},
					});

					return result;
				} catch (err) {
					const latency = Date.now() - start;
					const errorMessage = err instanceof Error ? err.message : String(err);

					tracker({
						requestId,
						timestamp: new Date().toISOString(),
						prompt: Array.isArray(params.messages)
							? (params.messages as Record<string, unknown>[])
							: [],
						response: "",
						model: (options?.modelOverride ||
							params.model ||
							"anthropic-message") as string,
						latency,
						provider: "anthropic",
						success: false,
						error: errorMessage,
						metadata: {
							...options?.metadata,
							rawRequest: params,
						},
					});

					throw err;
				}
			},
		},
	};

	const wrappedCreate = wrapped.messages
		.create as WrappedFunction<AnthropicCreate>;
	wrappedCreate.__noryen_wrapped__ = true;

	return wrapped as T;
}
