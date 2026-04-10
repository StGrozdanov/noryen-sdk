import type { TrackEvent } from "./types.js";

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 50;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_BATCH_SIZE = 50;

export class TrackQueue {
	private queue: TrackEvent[] = [];
	private isProcessing = false;
	private processingPromise: Promise<void> | null = null;

	constructor(
		private readonly endpoint: string,
		private readonly apiKey: string,
	) {}

	public enqueue(event: TrackEvent): void {
		const payload: TrackEvent = {
			timestamp: new Date().toISOString(),
			...event,
		};
		this.queue.push(payload);
		Promise.resolve()
			.then(() => this.processQueue())
			.catch(() => {});
	}

	public async flush(): Promise<void> {
		await this.processQueue();
		if (this.processingPromise) {
			await this.processingPromise;
		}
	}

	private async processQueue(): Promise<void> {
		if (this.isProcessing || this.queue.length === 0) {
			return;
		}

		this.isProcessing = true;
		this.processingPromise = this.drainQueue();

		try {
			await this.processingPromise;
		} finally {
			this.isProcessing = false;
			this.processingPromise = null;

			if (this.queue.length > 0) {
				Promise.resolve()
					.then(() => this.processQueue())
					.catch(() => {});
			}
		}
	}

	private async drainQueue(): Promise<void> {
		const batch = this.queue.slice(0, MAX_BATCH_SIZE);
		if (batch.length === 0) return;

		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				const res = await this.sendBatch(batch);

				if (res.ok) {
					this.queue = this.queue.slice(batch.length);
					break;
				}

				const shouldRetry = res.status === 429 || res.status >= 500;
				if (!shouldRetry) {
					console.error(
						`[Noryen SDK] Dropping batch of ${batch.length} events. Status ${res.status}.`,
					);
					this.queue = this.queue.slice(batch.length);
					break;
				}

				if (attempt === MAX_RETRIES) {
					console.error(
						`[Noryen SDK] Failed to track ${batch.length} events after max retries.`,
					);
					this.queue = this.queue.slice(batch.length);
				}
			} catch (err) {
				if (attempt === MAX_RETRIES) {
					console.error(
						`[Noryen SDK] Failed to track ${batch.length} events after max retries due to network error.`,
					);
					this.queue = this.queue.slice(batch.length);
				}
			}

			if (attempt < MAX_RETRIES) {
				await this.sleep(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1));
			}
		}
	}

	private async sendBatch(events: TrackEvent[]): Promise<Response> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		try {
			return await fetch(this.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({ events }),
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private async sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
