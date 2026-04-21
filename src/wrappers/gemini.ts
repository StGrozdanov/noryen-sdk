import type { TrackEvent, WrapOptions } from "../types.js";
import {
	extractDocumentTagBlocks,
	normalizeContent,
	safeExtractContext,
} from "./context.js";
import { firstNumeric } from "./cost.js";
import { getSafeValue, hasProperty } from "./types.js";
import type { GoogleGenAIType, WrappedFunction } from "./types.js";

type GeminiGenerate = (...args: unknown[]) => Promise<unknown>;

export function wrapGemini<T extends GoogleGenAIType>(
	gemini: T,
	tracker: (event: TrackEvent) => void,
	options?: WrapOptions,
): T {
	const originalGenerate = gemini.models
		.generateContent as WrappedFunction<GeminiGenerate>;
	if (originalGenerate?.__noryen_wrapped__) {
		throw new Error("[Noryen SDK] This Gemini client is already wrapped.");
	}

	const modelsObject = hasProperty(gemini, "models")
		? (gemini.models as Record<string, unknown>)
		: {};

	const wrapped = {
		...gemini,
		models: {
			...modelsObject,
			generateContent: async (
				params: Record<string, unknown>,
			): Promise<unknown> => {
				const start = Date.now();
				const requestId = crypto.randomUUID();

				try {
					const result = await (
						gemini.models.generateContent as (
							...args: unknown[]
						) => Promise<unknown>
					).call(gemini.models, params);
					const latency = Date.now() - start;

					const resultRecord = result as Record<string, unknown>;
					const response = hasProperty(resultRecord, "response")
						? (resultRecord.response as Record<string, unknown>)
						: {};

					let responseText = "";
					try {
						if (typeof response.text === "function") {
							responseText = String(response.text());
						} else {
							responseText = JSON.stringify(resultRecord);
						}
					} catch (error) {
						if (options?.debug) {
							console.warn(
								"[Noryen SDK] Falling back to JSON response serialization for Gemini.",
								error,
							);
						}
						responseText = JSON.stringify(resultRecord);
					}

					const usage = hasProperty(response, "usageMetadata")
						? (response.usageMetadata as Record<string, unknown>)
						: {};
					const cost = resolveCost(resultRecord, response, usage);
					const context = safeExtractContext(
						() => extractGeminiContext(params, response, options),
						options?.debug,
						"gemini",
					);

					tracker({
						requestId,
						timestamp: new Date().toISOString(),
						prompt: Array.isArray(params.contents)
							? (params.contents as Record<string, unknown>[])
							: [],
						response: responseText,
						model: (options?.modelOverride ||
							getSafeValue<string>(params, ["model"], "gemini")) as string,
						latency,
						cost,
						provider: "google",
						success: true,
						inputTokens: getSafeValue<number | undefined>(
							usage,
							["promptTokenCount"],
							undefined,
						),
						outputTokens: getSafeValue<number | undefined>(
							usage,
							["candidatesTokenCount"],
							undefined,
						),
						totalTokens: getSafeValue<number | undefined>(
							usage,
							["totalTokenCount"],
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
					const context = safeExtractContext(
						() => extractGeminiContext(params, undefined, options),
						options?.debug,
						"gemini",
					);
					tracker({
						requestId,
						timestamp: new Date().toISOString(),
						prompt: Array.isArray(params.contents)
							? (params.contents as Record<string, unknown>[])
							: [],
						response: "",
						model: (options?.modelOverride ||
							getSafeValue<string>(params, ["model"], "gemini")) as string,
						latency,
						provider: "google",
						success: false,
						error: err instanceof Error ? err.message : String(err),
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

	const wrappedGenerate = wrapped.models
		.generateContent as WrappedFunction<GeminiGenerate>;
	wrappedGenerate.__noryen_wrapped__ = true;

	return wrapped as T;
}

function extractGeminiContext(
	params: Record<string, unknown>,
	response?: Record<string, unknown>,
	options?: WrapOptions,
): TrackEvent["context"] {
	const documents: NonNullable<TrackEvent["context"]>["documents"] = [];
	let query: string | undefined;
	const instructions: string[] = [];
	const systemInstruction = hasProperty(params, "systemInstruction")
		? normalizeContent(params.systemInstruction)
		: "";
	if (systemInstruction !== "") {
		instructions.push(systemInstruction);
	}

	const contents = Array.isArray(params.contents)
		? (params.contents as Record<string, unknown>[])
		: [];
	for (const content of contents) {
		const role = String(content.role || "").toLowerCase();
		const parts = Array.isArray(content.parts)
			? (content.parts as Record<string, unknown>[])
			: [];
		const textContent = normalizeContent(parts);
		if (role === "user" && textContent !== "") {
			query = textContent;
		}
		if (role === "system" && textContent !== "") {
			instructions.push(textContent);
		}
		if (options?.parseDocumentTags) {
			const blocks = extractDocumentTagBlocks(textContent);
			for (const text of blocks) {
				documents.push({
					content: text,
					source: "gemini.document_block",
					metadata: { role: content.role },
				});
			}
		}
		for (const part of parts) {
			if (!part || typeof part !== "object") {
				continue;
			}
			if ("functionResponse" in part) {
				const payload = part.functionResponse;
				documents.push({
					content: JSON.stringify(payload),
					source: "gemini.function_response",
				});
				continue;
			}
			if ("function_response" in part) {
				const payload = part.function_response;
				documents.push({
					content: JSON.stringify(payload),
					source: "gemini.function_response",
				});
			}
		}
	}

	if (response?.groundingMetadata) {
		documents.push({
			content: JSON.stringify(response.groundingMetadata),
			source: "gemini.grounding_metadata",
		});
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

function resolveCost(
	resultRecord: Record<string, unknown>,
	response: Record<string, unknown>,
	usage: Record<string, unknown>,
): number | undefined {
	return (
		firstNumeric(resultRecord, [["cost"]]) ??
		firstNumeric(response, [["cost"]]) ??
		firstNumeric(usage, [["cost"], ["totalCost"]]) ??
		undefined
	);
}
