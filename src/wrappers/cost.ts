export type UnknownRecord = Record<string, unknown>;

export function toFiniteNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

export function getValueAtPath(
	obj: UnknownRecord | undefined,
	path: readonly string[],
): unknown {
	if (!obj) {
		return undefined;
	}
	let current: unknown = obj;
	for (const key of path) {
		if (
			current != null &&
			typeof current === "object" &&
			key in (current as UnknownRecord)
		) {
			current = (current as UnknownRecord)[key];
			continue;
		}
		return undefined;
	}
	return current;
}

export function firstNumeric(
	obj: UnknownRecord | undefined,
	paths: ReadonlyArray<readonly string[]>,
): number | undefined {
	for (const path of paths) {
		const value = toFiniteNumber(getValueAtPath(obj, path));
		if (value != null) {
			return value;
		}
	}
	return undefined;
}
