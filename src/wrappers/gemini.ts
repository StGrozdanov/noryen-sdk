import type { TrackEvent, WrapOptions } from "../types.js";
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
						metadata: {
							...options?.metadata,
							rawRequest: params,
							rawResponse: result,
						},
					});

					return result;
				} catch (err) {
					const latency = Date.now() - start;
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
