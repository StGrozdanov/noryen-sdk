import type { TrackEvent, WrapOptions } from "../types.js";
import {
	extractDocumentTagBlocks,
	normalizeContent,
	safeExtractContext,
} from "./context.js";
import { firstNumeric } from "./cost.js";
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
						const cost = resolveCost(usage);
						const context = safeExtractContext(
							() => extractOpenAIContext(params, options),
							options?.debug,
							"openai",
						);

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
							cost,
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
							context,
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
						const context = safeExtractContext(
							() => extractOpenAIContext(params, options),
							options?.debug,
							"openai",
						);

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
							context,
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

function extractOpenAIContext(
	params: Record<string, unknown>,
	options?: WrapOptions,
): TrackEvent["context"] {
	const messages = Array.isArray(params.messages)
		? (params.messages as Record<string, unknown>[])
		: [];
	if (messages.length === 0) {
		return undefined;
	}

	const documents: NonNullable<TrackEvent["context"]>["documents"] = [];
	const instructions: string[] = [];
	let query: string | undefined;

	for (const message of messages) {
		const role = String(message.role || "").toLowerCase();
		const content = normalizeContent(message.content);
		if (role === "system" && content !== "") {
			instructions.push(content);
		}
		if (role === "user") {
			const userText = extractUserQuery(message.content);
			if (userText !== "") {
				query = userText;
			}
		}
		if (role === "tool" && content !== "") {
			documents.push({
				content,
				source: "openai.tool_result",
				metadata: {
					role: message.role,
					name: message.name,
					tool_call_id: message.tool_call_id,
				},
			});
			continue;
		}

		if (Array.isArray(message.content)) {
			for (const item of message.content) {
				if (!item || typeof item !== "object") {
					continue;
				}
				const record = item as Record<string, unknown>;
				if (record.type !== "file_search_result") {
					continue;
				}
				const results = Array.isArray(record.results)
					? (record.results as Record<string, unknown>[])
					: [];
				for (const result of results) {
					const resultContent = normalizeContent(result.content);
					if (resultContent === "") {
						continue;
					}
					const score =
						typeof result.score === "number" ? result.score : undefined;
					documents.push({
						id:
							typeof result.file_id === "string"
								? result.file_id
								: typeof result.id === "string"
									? result.id
									: undefined,
						content: resultContent,
						source: "openai.file_search_result",
						score,
						metadata: {
							filename: result.filename,
							role: message.role,
						},
					});
				}
			}
		}

		if (options?.parseDocumentTags) {
			const blocks = extractDocumentTagBlocks(content);
			for (const text of blocks) {
				documents.push({
					content: text,
					source: "openai.message_document_block",
					metadata: { role: message.role },
				});
			}
		}
	}

	if (documents.length === 0 && instructions.length === 0) {
		return undefined;
	}

	return {
		documents: documents.length > 0 ? documents : undefined,
		instructions:
			instructions.length > 0 ? instructions.join("\n\n") : undefined,
		retrieval:
			documents.length > 0 || query
				? {
						query,
						method: "sdk_auto",
						k: documents.length,
					}
				: undefined,
	};
}

function extractUserQuery(content: unknown): string {
	if (typeof content === "string") {
		return content.trim();
	}
	if (!Array.isArray(content)) {
		return normalizeContent(content);
	}
	const parts: string[] = [];
	for (const item of content) {
		if (typeof item === "string") {
			const text = item.trim();
			if (text !== "") {
				parts.push(text);
			}
			continue;
		}
		if (!item || typeof item !== "object") {
			continue;
		}
		const record = item as Record<string, unknown>;
		if (record.type === "file_search_result") {
			continue;
		}
		const text = normalizeContent(record);
		if (text !== "") {
			parts.push(text);
		}
	}
	return parts.join("\n").trim();
}

function resolveCost(usage: Record<string, unknown>): number | undefined {
	return firstNumeric(usage, [
		["cost"],
		["cost_details", "upstream_inference_cost"],
		["cost_details", "total_cost"],
		["cost_details", "inference_cost"],
	]);
}
