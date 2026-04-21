import type { TrackEvent, WrapOptions } from "../types.js";
import {
	extractDocumentTagBlocks,
	normalizeContent,
	safeExtractContext,
} from "./context.js";
import { firstNumeric } from "./cost.js";
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
					const cost = resolveCost(usage);
					const context = safeExtractContext(
						() => extractAnthropicContext(params, options),
						options?.debug,
						"anthropic",
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
						cost,
						provider: "anthropic",
						success: true,
						inputTokens,
						outputTokens,
						totalTokens:
							inputTokens != null && outputTokens != null
								? inputTokens + outputTokens
								: undefined,
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
					const errorMessage = err instanceof Error ? err.message : String(err);
					const context = safeExtractContext(
						() => extractAnthropicContext(params, options),
						options?.debug,
						"anthropic",
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
							"anthropic-message") as string,
						latency,
						provider: "anthropic",
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
	};

	const wrappedCreate = wrapped.messages
		.create as WrappedFunction<AnthropicCreate>;
	wrappedCreate.__noryen_wrapped__ = true;

	return wrapped as T;
}

function extractAnthropicContext(
	params: Record<string, unknown>,
	options?: WrapOptions,
): TrackEvent["context"] {
	const messages = Array.isArray(params.messages)
		? (params.messages as Record<string, unknown>[])
		: [];
	const documents: NonNullable<TrackEvent["context"]>["documents"] = [];
	let query: string | undefined;

	for (const message of messages) {
		const content = message.content;
		const role = String(message.role || "").toLowerCase();
		if (role === "user") {
			const queryText = normalizeContent(content);
			if (queryText !== "") {
				query = queryText;
			}
		}
		if (Array.isArray(content)) {
			for (const part of content) {
				if (!part || typeof part !== "object") {
					continue;
				}
				const block = part as Record<string, unknown>;
				const blockType = String(block.type || "");
				if (blockType === "tool_result") {
					const toolContent = normalizeContent(block.content);
					if (toolContent !== "") {
						documents.push({
							content: toolContent,
							source: "anthropic.tool_result",
							metadata: { tool_use_id: block.tool_use_id },
						});
					}
				}
				if (blockType === "document") {
					const source = hasProperty(block, "source")
						? (block.source as Record<string, unknown>)
						: undefined;
					const documentText = source ? normalizeContent(source.data) : "";
					if (documentText !== "") {
						documents.push({
							content: documentText,
							source: "anthropic.document",
							metadata: {
								title: block.title,
								citations: block.citations,
								context: block.context,
							},
						});
					}
				}
			}
		}

		if (options?.parseDocumentTags) {
			const textBody = normalizeContent(content);
			const blocks = extractDocumentTagBlocks(textBody);
			for (const text of blocks) {
				documents.push({
					content: text,
					source: "anthropic.document_block",
					metadata: { role: message.role },
				});
			}
		}
	}

	const system = params.system;
	const instructions = normalizeContent(system);

	if (options?.parseDocumentTags) {
		const systemBlocks = extractDocumentTagBlocks(instructions);
		for (const text of systemBlocks) {
			documents.push({
				content: text,
				source: "anthropic.system_document_block",
			});
		}
	}

	if (documents.length === 0 && instructions === "") {
		return undefined;
	}
	return {
		documents: documents.length > 0 ? documents : undefined,
		instructions: instructions !== "" ? instructions : undefined,
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

function resolveCost(usage: Record<string, unknown>): number | undefined {
	return firstNumeric(usage, [
		["cost"],
		["total_cost"],
		["input_cost"],
		["output_cost"],
	]);
}
