import { test, expect } from "bun:test";
import { parseLocale, validateParity } from "./audit.mjs";
const reference = parseLocale("[x]\na=__1__ __CONTROL__focus-search__\nb=[font=default]Text[/font]\n");
test("locale validation catches missing keys and duplicate entries", () => {
  expect(() => validateParity(reference, parseLocale("[x]\na=__1__ __CONTROL__focus-search__\n"), "de")).toThrow("missing x.b");
  expect(() => parseLocale("[x]\na=One\na=Two")).toThrow("duplicate");
});
test("locale validation catches broken parameters and rich text", () => {
  expect(() => validateParity(reference, parseLocale("[x]\na=__2__ __CONTROL__focus-search__\nb=Text\n"), "de")).toThrow("parameter/control mismatch");
  expect(() => parseLocale("[x]\na=[font=default]Text")).toThrow("unbalanced");
});
test("translations may use their own grammar while preserving runtime arguments", () => {
  const english = parseLocale("[x]\na=__1__ __plural_for_parameter__1__{1=source|rest=sources}__");
  const chinese = parseLocale("[x]\na=__1__ 个来源");
  expect(() => validateParity(english, chinese, "zh-CN")).not.toThrow();
});
test("control identifiers containing underscores cannot silently disappear in translation", () => {
  const english = parseLocale("[x]\na=__CONTROL__location_location_location_focus_search__");
  expect(() => validateParity(english, parseLocale("[x]\na=Search"), "de")).toThrow("parameter/control mismatch");
});
