import { test, expect } from "bun:test";
import { parseLocale, validateParity } from "./audit.ts";
import { BoundaryError } from "./projects.ts";
const reference = parseLocale(
  "[x]\na=__1__ __CONTROL__focus-search__\nb=[font=default]Text[/font]\n",
);
test("locale keys are complete and unique", () => {
  expect(() =>
    validateParity(
      reference,
      parseLocale("[x]\na=__1__ __CONTROL__focus-search__\n"),
      "de",
    ),
  ).toThrow(BoundaryError);
  expect(() => parseLocale("[x]\na=One\na=Two")).toThrow(BoundaryError);
  expect(() =>
    validateParity(
      reference,
      parseLocale(
        "[x]\na=__1__ __CONTROL__focus-search__\nb=Text\nc=Unexpected\n",
      ),
      "de",
    ),
  ).toThrow(BoundaryError);
});
test("locale arguments survive translation while grammatical plural forms remain language-specific", () => {
  const english = parseLocale(
    "[x]\na=__1__ __plural_for_parameter__1__{1=source|rest=sources}__",
  );
  validateParity(english, parseLocale("[x]\na=__1__ 个来源"), "zh-CN");
  expect(() =>
    validateParity(english, parseLocale("[x]\na=__2__ 个来源"), "zh-CN"),
  ).toThrow(BoundaryError);
  expect(() => parseLocale("[x]\na=[font=default]Text")).toThrow(BoundaryError);
  expect(() =>
    parseLocale("[x]\na=[font=default][color=red]Text[/font][/color]"),
  ).toThrow(BoundaryError);
});
test("control identifiers containing underscores cannot disappear in translation", () => {
  const english = parseLocale(
    "[x]\na=__CONTROL__location_location_location_focus_search__",
  );
  expect(() =>
    validateParity(english, parseLocale("[x]\na=Search"), "de"),
  ).toThrow(BoundaryError);
});
