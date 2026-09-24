import spec from "@geo-platform/types/openapi.json";

/**
 * Helpers to render the committed OpenAPI document (packages/types/openapi.json).
 * The API reference is built from this file at build time; nothing is fetched.
 */

export type JsonSchema = {
  $ref?: string;
  type?: string;
  title?: string;
  description?: string;
  enum?: (string | number)[];
  const?: string;
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
  examples?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
};

type Parameter = { name: string; in: string; required?: boolean; schema: JsonSchema; description?: string };
type MediaType = { schema?: JsonSchema; example?: unknown };
type ResponseObject = { description?: string; content?: Record<string, MediaType> };
type OperationObject = {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  responses: Record<string, ResponseObject>;
  security?: Record<string, string[]>[];
};
type OpenApiDocument = {
  info: { title: string; version: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, OperationObject>>;
  components: { schemas: Record<string, JsonSchema> };
};

export const openApi = spec as unknown as OpenApiDocument;

export type Operation = OperationObject & { method: string; path: string };

/** The public /v1 operations, in document order. */
export function publicOperations(): Operation[] {
  return Object.entries(openApi.paths)
    .filter(([path]) => path.startsWith("/v1/"))
    .flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, operation]) => ({ ...operation, method: method.toUpperCase(), path })),
    );
}

export function resolve(schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.split("/").at(-1) ?? "";
  // Keep sibling keywords (such as description) from the referencing schema.
  const { $ref: _ref, ...rest } = schema;
  void _ref;
  return { ...openApi.components.schemas[name], ...rest };
}

function refName(schema: JsonSchema): string | undefined {
  return schema.$ref?.split("/").at(-1);
}

export function describeType(schema: JsonSchema): string {
  const name = refName(schema);
  if (name) {
    const target = openApi.components.schemas[name];
    return target?.enum ? target.enum.map((value) => `"${value}"`).join(" | ") : name;
  }
  if (schema.anyOf) return schema.anyOf.map(describeType).join(" | ");
  if (schema.enum) return schema.enum.map((value) => `"${value}"`).join(" | ");
  if (schema.const) return `"${schema.const}"`;
  if (schema.type === "array") {
    if (schema.prefixItems) return `[${schema.prefixItems.map(describeType).join(", ")}]`;
    return `${schema.items ? describeType(schema.items) : "unknown"}[]`;
  }
  return schema.type ?? "object";
}

export function constraints(schema: JsonSchema): string[] {
  const target = resolve(schema);
  const result: string[] = [];
  if (target.minLength !== undefined || target.maxLength !== undefined) {
    result.push(`${target.minLength ?? 0}–${target.maxLength ?? "∞"} characters`);
  }
  if (target.minimum !== undefined || target.maximum !== undefined) {
    result.push(`${target.minimum ?? "−∞"} to ${target.maximum ?? "∞"}`);
  }
  if (schema.default !== undefined) result.push(`default ${JSON.stringify(schema.default)}`);
  return result;
}

export type SchemaRow = { name: string; type: string; required: boolean; description: string };

/** Flattens an object schema into dotted rows (nested objects up to `depth` levels). */
export function flattenSchema(schema: JsonSchema, prefix = "", depth = 3): SchemaRow[] {
  const target = resolve(schema);
  const rows: SchemaRow[] = [];
  for (const [key, property] of Object.entries(target.properties ?? {})) {
    const name = `${prefix}${key}`;
    const resolved = resolve(property);
    rows.push({
      name,
      type: describeType(property),
      required: target.required?.includes(key) ?? false,
      description: property.description ?? resolved.description ?? "",
    });
    if (depth <= 1) continue;
    if (property.$ref && resolved.properties) {
      rows.push(...flattenSchema(property, `${name}.`, depth - 1));
    } else if (property.type === "array" && property.items?.$ref) {
      rows.push(...flattenSchema(property.items, `${name}[].`, depth - 1));
    }
  }
  return rows;
}

export function successSchema(operation: Operation): JsonSchema | undefined {
  return operation.responses["200"]?.content?.["application/json"]?.schema;
}

export type ErrorResponseInfo = { status: string; code: string; message: string };

export function errorResponses(operation: Operation): ErrorResponseInfo[] {
  return Object.entries(operation.responses)
    .filter(([status]) => status !== "200")
    .map(([status, response]) => {
      const example = response.content?.["application/json"]?.example as
        | { error?: { code?: string; message?: string } }
        | undefined;
      return {
        status,
        code: example?.error?.code ?? "",
        message: example?.error?.message ?? response.description ?? "",
      };
    });
}
