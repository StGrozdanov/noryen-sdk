const MAX_NORMALIZE_DEPTH = 8;

export function normalizeContent(value: unknown, depth = 0): string {
	if (depth > MAX_NORMALIZE_DEPTH) {
		return "";
	}
	if (typeof value === "string") {
		return value.trim();
	}
	if (Array.isArray(value)) {
		const parts: string[] = [];
		for (const item of value) {
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
			if (typeof record.text === "string" && record.text.trim() !== "") {
				parts.push(record.text.trim());
				continue;
			}
			if ("content" in record) {
				const nested = normalizeContent(record.content, depth + 1);
				if (nested !== "") {
					parts.push(nested);
				}
				continue;
			}
			parts.push(JSON.stringify(record));
		}
		return parts.join("\n").trim();
	}
	if (value && typeof value === "object") {
		try {
			return JSON.stringify(value);
		} catch {
			return "";
		}
	}
	return "";
}

export function safeExtractContext<T>(
	extractor: () => T,
	debug?: boolean,
	providerName?: string,
): T | undefined {
	try {
		return extractor();
	} catch (error) {
		if (debug) {
			console.warn(
				`[Noryen SDK] Failed to extract ${providerName || "provider"} context.`,
				error,
			);
		}
		return undefined;
	}
}

export function extractDocumentTagBlocks(text: string): string[] {
	if (!text.includes("<document>") || !text.includes("</document>")) {
		return [];
	}
	const matches = text.match(/<document>([\s\S]*?)<\/document>/gi) || [];
	return matches
		.map((block) => block.replace(/<\/?document>/gi, "").trim())
		.filter((block) => block !== "");
}
