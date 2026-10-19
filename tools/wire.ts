import type { JsonSchema, Schema, SchemaAST } from "effect";
import { BoundaryError } from "./projects.ts";

const checkIds = new Set([
  "effect/schema/isPattern",
  "effect/schema/isMinLength",
  "effect/schema/isMaxLength",
  "effect/schema/isInt",
  "effect/schema/isFinite",
  "effect/schema/isBetween",
]);
// This intentionally supports a small JSON-only subset. Effect's general export
// is best-effort: notably a non-Unicode RegExp silently loses its pattern.
export function assertWireSchema(schema: Schema.Constraint) {
  const visited = new Set<SchemaAST.AST>();
  const fail = (message: string): never => {
    throw new BoundaryError({ boundary: "wire schema", message });
  };
  const visit = (node: SchemaAST.AST): void => {
    if (visited.has(node)) return;
    visited.add(node);
    if (
      node.encoding !== undefined ||
      node.context?.constructorDefault !== undefined
    )
      fail(
        "Wire schemas cannot contain transformations or constructor defaults",
      );
    let type: JsonSchema.Type | undefined;
    switch (node._tag) {
      case "String":
        type = "string";
        break;
      case "Number":
        type = "number";
        break;
      case "Boolean":
        type = "boolean";
        break;
      case "Null":
        type = "null";
        break;
      case "Unknown":
        break;
      case "Literal":
        if (typeof node.literal === "number" && !Number.isFinite(node.literal))
          fail("Wire literals must be finite JSON values");
        break;
      case "Arrays":
        type = "array";
        if (node.encodingChecks !== undefined)
          fail("Wire arrays cannot have encoding-only checks");
        for (const child of [...node.elements, ...node.rest]) visit(child);
        break;
      case "Objects":
        type = "object";
        if (node.encodingChecks !== undefined)
          fail("Wire objects cannot have encoding-only checks");
        for (const property of node.propertySignatures) {
          if (typeof property.name !== "string")
            fail("Wire property names must be strings");
          visit(property.type);
        }
        for (const index of node.indexSignatures) {
          visit(index.parameter);
          visit(index.type);
        }
        break;
      case "Union":
        for (const child of node.types) visit(child);
        break;
      default:
        fail(`Unsupported wire AST node: ${node._tag}`);
    }
    let finite = false;
    const check = (item: SchemaAST.Check<never>): void => {
      if (item._tag === "FilterGroup") {
        if (item.annotations?.toJsonSchema !== undefined)
          fail("Custom group exporters are not supported");
        for (const child of item.checks) check(child);
        return;
      }
      const annotation = item.annotations,
        id = annotation?.representation?.id,
        exporter = annotation?.toJsonSchema;
      if (
        id === undefined ||
        !checkIds.has(id) ||
        exporter === undefined ||
        annotation?.representation?.schemas?.length
      )
        fail(
          "Wire refinement has no reviewed exact JSON Schema representation",
        );
      const exported = exporter!({ type, schemas: [] });
      if (Array.isArray(exported))
        fail(
          "Wire refinement would be approximated or omitted by JSON Schema export",
        );
      const fragment = exported as JsonSchema.JsonSchema;
      if (id === "effect/schema/isInt" || id === "effect/schema/isFinite")
        finite = true;
      if (
        id === "effect/schema/isBetween" &&
        typeof fragment.minimum === "number" &&
        Number.isFinite(fragment.minimum) &&
        typeof fragment.maximum === "number" &&
        Number.isFinite(fragment.maximum)
      )
        finite = true;
    };
    for (const item of node.checks ?? []) check(item);
    if (node._tag === "Number" && !finite)
      fail(
        "Wire numbers require finite bounds, isFinite or safe-integer validation",
      );
  };
  visit(schema.ast);
}
