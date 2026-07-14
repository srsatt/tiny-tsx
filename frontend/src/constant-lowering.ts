import type {Constant, ConstantValue} from "./hir.js";
import type {StagedBinding, StagedValue} from "./staging.js";

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
  if (value === null) {
    return {kind: "null"};
  }
  if (typeof value === "boolean") {
    return {kind: "boolean", value};
  }
  if (typeof value === "number") {
    return {kind: "number", value};
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
