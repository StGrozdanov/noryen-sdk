export interface InitOptions {
	apiKey: string;
	endpoint?: string;
	debug?: boolean;
}

export interface TrackEvent {
	prompt: string | Record<string, unknown>[] | Record<string, unknown>;
	response: string | Record<string, unknown>;
	model: string;
	latency?: number;
	cost?: number;
	requestId?: string;
	provider?: string;
	success?: boolean;
	error?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	metadata?: Record<string, unknown>;
	timestamp?: string;
}

export interface WrapOptions {
	/** Additional metadata to attach to every tracked event */
	metadata?: Record<string, unknown>;
	/** Override the tracked model name */
	modelOverride?: string;
	/** Enable wrapper-level debug warnings */
	debug?: boolean;
}
