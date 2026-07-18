import type {Constant, ConstantValue} from "./hir.js";
import type {StagedBinding, StagedValue} from "./staging.js";
import {STAGED_UNDEFINED, StagedSymbol} from "./staged-value.js";

export function lowerStagedConstants(bindings: readonly StagedBinding[]): Constant[] {
  return bindings.map((binding, id) => ({
    id,
    module: binding.module,
    name: binding.name,
    span: binding.span,
    value: lowerValue(binding.value),
  }));
}

function lowerValue(value: StagedValue): ConstantValue {
  if (value === STAGED_UNDEFINED) {
    return {kind: "undefined"};
  }
  if (value === null) {
    return {kind: "null"};
  }
  if (typeof value === "boolean") {
    return {kind: "boolean", value};
  }
  if (typeof value === "number") {
    if (Object.is(value, -0)) return {kind: "numberSpecial", value: "negativeZero"};
    if (Number.isNaN(value)) return {kind: "numberSpecial", value: "nan"};
    if (value === Number.POSITIVE_INFINITY) {
      return {kind: "numberSpecial", value: "positiveInfinity"};
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return {kind: "numberSpecial", value: "negativeInfinity"};
    }
    return {kind: "number", value};
  }
  if (value instanceof StagedSymbol) {
    return {
      kind: "symbol",
      id: value.id,
      ...(value.description === undefined ? {} : {description: value.description}),
    };
  }
  if (typeof value === "bigint") {
    return {kind: "bigint", value: value.toString()};
  }
  if (typeof value === "string") {
    return {kind: "string", value};
  }
  if (Array.isArray(value)) {
    return {kind: "array", items: value.map(lowerValue)};
  }
  return {
    kind: "record",
    fields: Object.entries(value).map(([name, field]) => ({name, value: lowerValue(field)})),
  };
}
