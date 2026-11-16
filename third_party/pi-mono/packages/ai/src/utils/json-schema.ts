type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{ type: "null" }`, optionally with annotations: the branch a nullable union adds. */
function isNullBranch(schema: unknown): boolean {
	if (!isObject(schema) || schema.type !== "null") return false;
	return Object.keys(schema).every((key) => key === "type" || key === "description" || key === "title");
}

/** A branch that names its type and nothing that a type array would change the meaning of. */
function isTypedBranch(schema: unknown): schema is JsonObject {
	if (!isObject(schema) || "anyOf" in schema || "oneOf" in schema || "allOf" in schema) return false;
	if ("enum" in schema || "const" in schema) return false;
	const { type } = schema;
	if (typeof type === "string") return type !== "null";
	return Array.isArray(type) && type.length > 0 && type.every((entry) => typeof entry === "string" && entry !== "null");
}

function nullableTypeArray(node: JsonObject): JsonObject | undefined {
	const { anyOf, ...rest } = node;
	if (!Array.isArray(anyOf) || anyOf.length !== 2) return undefined;
	const typed = anyOf.find(isTypedBranch);
	const hasNull = anyOf.some(isNullBranch);
	if (!typed || !hasNull) return undefined;
	const types = Array.isArray(typed.type) ? (typed.type as string[]) : [typed.type as string];
	// Annotations on the union itself describe the whole property, so they win over the branch's.
	return { ...typed, ...rest, type: [...types, "null"] };
}

/**
 * Rewrites `anyOf: [<typed schema>, { type: "null" }]` into the equivalent `{ ...<typed schema>,
 * type: [<type>, "null"] }` everywhere in a tool parameter schema.
 *
 * TypeBox and zod emit a nullable property as an `anyOf` without a `type` of its own. Gemini's
 * function declarations, served through OpenAI-compatible endpoints, reject a schema that does not
 * name its type, which fails every request that carries the tool. A type array is standard JSON
 * Schema with the same meaning. Other `anyOf` shapes are left alone. The input is never modified.
 */
export function withNullableTypeArrays<T>(schema: T): T {
	return rewrite(schema) as T;
}

function rewrite(value: unknown): unknown {
	if (Array.isArray(value)) {
		let changed = false;
		const items = value.map((item) => {
			const next = rewrite(item);
			if (next !== item) changed = true;
			return next;
		});
		return changed ? items : value;
	}
	if (!isObject(value)) return value;
	const rewritten: JsonObject = {};
	let changed = false;
	for (const [key, child] of Object.entries(value)) {
		const next = rewrite(child);
		if (next !== child) changed = true;
		rewritten[key] = next;
	}
	const merged = nullableTypeArray(rewritten);
	if (merged) return merged;
	return changed ? rewritten : value;
}
