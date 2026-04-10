import { TrackQueue } from "./queue.js";
import type { InitOptions, TrackEvent, WrapOptions } from "./types.js";
import { wrapAnthropic } from "./wrappers/anthropic.js";
import { wrapGemini } from "./wrappers/gemini.js";
import { wrapOpenAI } from "./wrappers/openai.js";
import type {
	AnthropicType,
	GoogleGenAIType,
	OpenAIType,
} from "./wrappers/types.js";

const ENDPOINT_ENV_KEYS = [
	"NORYEN_API_URL",
	"NORYEN_TRACK_ENDPOINT",
	"NEXT_PUBLIC_NORYEN_API_URL",
];
const DEFAULT_TRACK_ENDPOINT = "https://noryen-api.fly.dev/v1/track";

function resolveEndpointFromEnv(): string | undefined {
	if (typeof process === "undefined" || !process.env) {
		return undefined;
	}

	for (const key of ENDPOINT_ENV_KEYS) {
		const value = process.env[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}

	return undefined;
}

export class NoryenClient {
	private queue: TrackQueue | null = null;
	private endpoint = DEFAULT_TRACK_ENDPOINT;
	private debug = false;
	private globalMetadata: Record<string, unknown> = {};

	public init(options: InitOptions): void {
		if (!options.apiKey) {
			throw new Error("[Noryen SDK] init() requires an apiKey.");
		}

		if (this.queue) {
			console.warn(
				"[Noryen SDK] init() called more than once. Reinitializing client.",
			);
		}

		const resolvedEndpoint =
			options.endpoint ?? resolveEndpointFromEnv() ?? DEFAULT_TRACK_ENDPOINT;
		this.endpoint = resolvedEndpoint;
		this.debug = options.debug ?? false;

		this.queue = new TrackQueue(this.endpoint, options.apiKey);
	}

	public track(event: TrackEvent): void {
		if (!this.queue) {
			this.warn("[Noryen SDK] track() called before init(). Event dropped.");
			return;
		}

		if (!event.model) {
			this.warn("[Noryen SDK] track() requires at least a model.");
			return;
		}
		if (event.success !== false && !this.hasEventContent(event)) {
			this.warn(
				"[Noryen SDK] track() requires prompt and response for successful events.",
			);
			return;
		}

		this.queue.enqueue({
			...event,
			metadata: {
				...this.globalMetadata,
				...event.metadata,
			},
		});
	}

	public wrap<T extends object>(client: T, options?: WrapOptions): T {
		if (this.isOpenAIClient(client)) {
			return this.wrapOpenAI(client, options) as unknown as T;
		}
		if (this.isAnthropicClient(client)) {
			return this.wrapAnthropic(client, options) as unknown as T;
		}
		if (this.isGeminiClient(client)) {
			return this.wrapGemini(client, options) as unknown as T;
		}
		throw new Error(
			"[Noryen SDK] Unknown provider. Use wrapOpenAI/wrapAnthropic/wrapGemini directly.",
		);
	}

	public wrapOpenAI<T extends OpenAIType>(client: T, options?: WrapOptions): T {
		return wrapOpenAI(client, this.createTracker(), options);
	}

	public wrapAnthropic<T extends AnthropicType>(
		client: T,
		options?: WrapOptions,
	): T {
		return wrapAnthropic(client, this.createTracker(), options);
	}

	public wrapGemini<T extends GoogleGenAIType>(
		client: T,
		options?: WrapOptions,
	): T {
		return wrapGemini(client, this.createTracker(), options);
	}

	private createTracker(): (event: TrackEvent) => void {
		return (event: TrackEvent) => {
			try {
				this.track(event);
				if (this.debug) {
					console.log("[Noryen SDK] tracked event:", event);
				}
			} catch (err) {
				if (this.debug) {
					console.warn("[Noryen SDK] Wrapper tracking failed:", err);
				}
			}
		};
	}

	public setContext(metadata: Record<string, unknown>): void {
		this.globalMetadata = {
			...this.globalMetadata,
			...metadata,
		};
	}

	public async flush(): Promise<void> {
		await this.queue?.flush();
	}

	private warn(message: string): void {
		if (this.debug) {
			console.warn(message);
		}
	}

	private hasEventContent(event: TrackEvent): boolean {
		return (
			this.hasMeaningfulValue(event.prompt) &&
			this.hasMeaningfulValue(event.response)
		);
	}

	private hasMeaningfulValue(
		value: string | Record<string, unknown>[] | Record<string, unknown>,
	): boolean {
		if (value == null) {
			return false;
		}
		if (typeof value === "string") {
			return value.trim().length > 0;
		}
		if (Array.isArray(value)) {
			return value.length > 0;
		}
		return Object.keys(value).length > 0;
	}

	private isOpenAIClient(client: object): client is OpenAIType {
		return (
			"chat" in client &&
			typeof client.chat === "object" &&
			client.chat !== null &&
			"completions" in client.chat &&
			typeof client.chat.completions === "object" &&
			client.chat.completions !== null &&
			"create" in client.chat.completions &&
			typeof client.chat.completions.create === "function"
		);
	}

	private isAnthropicClient(client: object): client is AnthropicType {
		return (
			"messages" in client &&
			typeof client.messages === "object" &&
			client.messages !== null &&
			"create" in client.messages &&
			typeof client.messages.create === "function"
		);
	}

	private isGeminiClient(client: object): client is GoogleGenAIType {
		return (
			"models" in client &&
			typeof client.models === "object" &&
			client.models !== null &&
			"generateContent" in client.models &&
			typeof client.models.generateContent === "function"
		);
	}
}
