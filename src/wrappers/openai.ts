import type { TrackEvent, WrapOptions } from "../types.js";
import { getSafeValue, hasProperty } from "./types.js";
import type { OpenAIType, WrappedFunction } from "./types.js";

type OpenAICreate = (...args: unknown[]) => Promise<unknown>;

export function wrapOpenAI<T extends OpenAIType>(
	openai: T,
	tracker: (event: TrackEvent) => void,
	options?: WrapOptions,
): T {
	const originalCreate = openai.chat?.completions
		?.create as WrappedFunction<OpenAICreate>;
	if (originalCreate?.__noryen_wrapped__) {
		throw new Error("[Noryen SDK] This OpenAI client is already wrapped.");
	}

	const chatObject = hasProperty(openai, "chat")
		? (openai.chat as Record<string, unknown>)
		: {};
	const completionsObject = hasProperty(chatObject, "completions")
		? (chatObject.completions as Record<string, unknown>)
		: {};

	const wrapped = {
		...openai,
		chat: {
			...chatObject,
			completions: {
				...completionsObject,
				create: async (
					params: Record<string, unknown>,
					requestOptions?: unknown,
				): Promise<unknown> => {
					const start = Date.now();
					const requestId = crypto.randomUUID();

					try {
						const result = await (
							openai.chat.completions.create as (
								...args: unknown[]
							) => Promise<unknown>
						).call(openai.chat.completions, params, requestOptions);

						const latency = Date.now() - start;

						const content = getSafeValue<string | null>(
							result,
							["choices", "0", "message", "content"],
							null,
						);
						const rawMessage = getSafeValue<unknown>(
							result,
							["choices", "0", "message"],
							"",
						);

						const usage = hasProperty(result, "usage")
							? (result.usage as Record<string, unknown>)
							: {};

						tracker({
							requestId,
							timestamp: new Date().toISOString(),
							prompt: Array.isArray(params.messages)
								? (params.messages as Record<string, unknown>[])
								: [],
							response: content ?? JSON.stringify(rawMessage),
							model: (options?.modelOverride ||
								params.model ||
								"openai-chat") as string,
							latency,
							provider:
								hasProperty(openai, "baseURL") &&
								String(openai.baseURL).includes("openrouter")
									? "openrouter"
									: "openai",
							success: true,
							inputTokens: getSafeValue<number | undefined>(
								usage,
								["prompt_tokens"],
								undefined,
							),
							outputTokens: getSafeValue<number | undefined>(
								usage,
								["completion_tokens"],
								undefined,
							),
							totalTokens: getSafeValue<number | undefined>(
								usage,
								["total_tokens"],
								undefined,
							),
							metadata: {
								...options?.metadata,
								rawRequest: params,
								rawResponse: result,
							},
						});

						return result;
					} catch (err) {
						const latency = Date.now() - start;
						const errorMessage =
							err instanceof Error ? err.message : String(err);

						tracker({
							requestId,
							timestamp: new Date().toISOString(),
							prompt: Array.isArray(params.messages)
								? (params.messages as Record<string, unknown>[])
								: [],
							response: "",
							model: (options?.modelOverride ||
								params.model ||
								"openai-chat") as string,
							latency,
							provider:
								hasProperty(openai, "baseURL") &&
								String(openai.baseURL).includes("openrouter")
									? "openrouter"
									: "openai",
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
		},
	};

	const wrappedCreate = wrapped.chat.completions
		.create as WrappedFunction<OpenAICreate>;
	wrappedCreate.__noryen_wrapped__ = true;

	return wrapped as T;
}
