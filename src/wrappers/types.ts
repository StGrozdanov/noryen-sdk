export type WrappedFunction<T extends (...args: unknown[]) => unknown> = T & {
	__noryen_wrapped__?: boolean;
};

export interface BaseOpenAIType {
	chat: {
		completions: {
			create: (...args: unknown[]) => Promise<unknown>;
		};
	};
}

export interface BaseAnthropicType {
	messages: {
		create: (...args: unknown[]) => Promise<unknown>;
	};
}

export interface BaseGoogleGenAIType {
	models: {
		generateContent: (...args: unknown[]) => Promise<unknown>;
	};
}

export type OpenAIType = BaseOpenAIType & Record<string, unknown>;
export type AnthropicType = BaseAnthropicType & Record<string, unknown>;
export type GoogleGenAIType = BaseGoogleGenAIType & Record<string, unknown>;

export function getSafeValue<T>(
	obj: unknown,
	path: string[],
	defaultValue: T,
): T {
	let current: unknown = obj;
	for (const key of path) {
		if (
			current != null &&
			typeof current === "object" &&
			key in (current as Record<string, unknown>)
		) {
			current = (current as Record<string, unknown>)[key];
		} else {
			return defaultValue;
		}
	}
	return (current as T) ?? defaultValue;
}

export function hasProperty<K extends string>(
	obj: unknown,
	key: K,
): obj is Record<K, unknown> {
	return obj != null && typeof obj === "object" && key in obj;
}
