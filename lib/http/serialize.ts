import { ErrorCode, frameworkError } from "../errors/index.js";

/**
 * Schema-driven JSON serialization (CLAUDE.md decision D1, Option A).
 *
 * Opt-in and self-contained: nothing here runs unless you call
 * `createSerializer()`. `res.json()` is untouched, so a route that does not use
 * a schema pays nothing for this existing.
 *
 * Built by composing closures, never by generating code — decision 11's ban on
 * `eval`/`new Function` stands. The measured win turned out to live in the
 * escaping strategy rather than in codegen: a linear char scan that quotes a
 * clean string directly, and hands anything unusual to `JSON.stringify`.
 *
 * **Parity is the contract.** For any value, `createSerializer(schema)(value)`
 * returns exactly what `JSON.stringify(value)` would. Every case the fast path
 * is not certain about delegates to `JSON.stringify`, so a value that does not
 * match its schema is still serialized correctly rather than corrupted. The
 * fuzz suite in `test/fuzz/` asserts that equivalence over random input.
 */
export type Schema =
  | { readonly type: "string" }
  | { readonly type: "number" }
  | { readonly type: "boolean" }
  | { readonly type: "raw" }
  | {
      readonly type: "object";
      readonly properties: Readonly<Record<string, Schema>>;
      /** Properties that may be absent. An absent one is omitted, as JSON.stringify does. */
      readonly optional?: readonly string[];
    }
  | { readonly type: "array"; readonly items: Schema };

export type Serializer<T = unknown> = (value: T) => string;

/** One compiled field of an object: its name, and how to render it. */
interface Field {
  key: string;
  /** `"key":` including the quotes and colon, escaped once at compile time. */
  prefix: string;
  write: Serializer;
  optional: boolean;
}

/**
 * Compile a schema into a serializer.
 *
 * @throws when the schema itself is malformed — at setup, never per request.
 */
export function createSerializer<T = unknown>(schema: Schema): Serializer<T> {
  return compile(schema, "$") as Serializer<T>;
}

function compile(schema: Schema, path: string): Serializer {
  if (schema === null || typeof schema !== "object" || typeof schema.type !== "string") {
    throw frameworkError(
      `createSerializer(): ${path} is not a schema object with a "type"`,
      createSerializer,
      ErrorCode.INVALID_ARGUMENT,
    );
  }

  switch (schema.type) {
    case "string":
      return serializeString;
    case "number":
      return serializeNumber;
    case "boolean":
      return serializeBoolean;
    case "raw":
      return serializeRaw;
    case "array": {
      // Measured, twice: a hand-rolled element loop cannot beat V8's array path
      // from JavaScript. Concatenating elements ran at 0.75x JSON.stringify on a
      // 20-object list and collecting-then-joining at 0.54x. Codegen might close
      // it, but decision 11 bans that. So an array delegates wholesale, which is
      // exactly 1.0x rather than a loss - and an array *field* inside an object
      // still leaves the surrounding object on the fast path.
      compile(schema.items, `${path}[]`); // validate the item schema at setup
      return serializeRaw;
    }

    case "object": {
      const optional = new Set(schema.optional ?? []);
      const fields: Field[] = Object.entries(schema.properties).map(([key, child]) => ({
        key,
        prefix: `${escapeString(key)}:`,
        write: compile(child, `${path}.${key}`),
        optional: optional.has(key),
      }));
      const allRequired = fields.every((f) => !f.optional);

      return (value) => {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          return serializeRaw(value);
        }
        const source = value as Record<string, unknown>;
        let out = "{";

        if (allRequired) {
          // No absence checks needed: the comma pattern is fixed.
          for (let i = 0; i < fields.length; i++) {
            const field = fields[i] as Field;
            const own = source[field.key];
            if (own === undefined) return serializeRaw(value); // schema lied; stay correct
            if (i > 0) out += ",";
            out += field.prefix + field.write(own);
          }
          return out + "}";
        }

        let first = true;
        for (let i = 0; i < fields.length; i++) {
          const field = fields[i] as Field;
          const own = source[field.key];
          if (own === undefined) {
            // JSON.stringify omits undefined properties entirely.
            if (field.optional) continue;
            return serializeRaw(value);
          }
          if (!first) out += ",";
          first = false;
          out += field.prefix + field.write(own);
        }
        return out + "}";
      };
    }
    default:
      throw frameworkError(
        `createSerializer(): unsupported type ${JSON.stringify((schema as { type: string }).type)} at ${path}`,
        createSerializer,
        ErrorCode.INVALID_ARGUMENT,
      );
  }
}

/**
 * Quote a string directly when every character is printable ASCII that JSON
 * leaves alone; hand anything else to `JSON.stringify`.
 *
 * A linear scan, not a regex — decision 11 bans nested quantifiers repo-wide,
 * and this runs on developer data that may contain anything.
 */
export function escapeString(value: unknown): string {
  if (typeof value !== "string") return serializeRaw(value);
  const length = value.length;
  for (let i = 0; i < length; i++) {
    const code = value.charCodeAt(i);
    // < 0x20 control, 0x22 quote, 0x5c backslash, > 0x7e non-ASCII (incl. lone
    // surrogates, which JSON.stringify escapes for well-formed output).
    if (code < 0x20 || code === 0x22 || code === 0x5c || code > 0x7e) {
      return JSON.stringify(value) as string;
    }
  }
  return '"' + value + '"';
}

const serializeString: Serializer = (value) => escapeString(value);

const serializeNumber: Serializer = (value) => {
  if (typeof value !== "number") return serializeRaw(value);
  // JSON has no NaN or Infinity; JSON.stringify emits null for both.
  return Number.isFinite(value) ? String(value) : "null";
};

const serializeBoolean: Serializer = (value) =>
  typeof value === "boolean" ? (value ? "true" : "false") : serializeRaw(value);

/** The escape hatch that keeps parity absolute. */
const serializeRaw: Serializer = (value) => {
  const json = JSON.stringify(value);
  // JSON.stringify returns undefined for undefined/function/symbol; in the
  // positions this can be reached from, null is what a JSON document needs.
  return json === undefined ? "null" : json;
};
