import { sha256 } from "./lib.mjs";

const qualified = /^[a-z][a-z0-9-]*\/[A-Za-z0-9_-]{1,200}$/;
const reasons = new Set(["expand", "missing", "change"]);
export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
const sorted = values => [...new Set(values)].sort();

// Byte-prefix receipts survive tick resets and preserve repeated, identical submissions.
export function readFlags(bytes, previous = null) {
  if (previous) {
    requireValue(Number.isSafeInteger(previous.bytes) && previous.bytes >= 0 && previous.bytes <= bytes.length,
      "Previous flag receipt is not a prefix of this log");
    requireValue(sha256(bytes.subarray(0, previous.bytes)) === previous.sha256,
      "Flag log changed or was replaced; previous receipt does not match its prefix");
  }
  const records = [];
  let start = 0;
  for (let end = 0; end < bytes.length; end++) {
    if (bytes[end] !== 10) continue;
    const line = records.length + 1;
    const raw = bytes.subarray(start, end);
    let record;
    try { record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
    catch (error) { throw new Error(`flags line ${line}: ${error.message}`); }
    requireValue(record.schema_version === 1 && reasons.has(record.reason), `flags line ${line}: unsupported schema or reason`);
    const target = record.target;
    requireValue(target && qualified.test(target.id) && target.id === `${target.type}/${target.name}` &&
      ["item", "fluid", "entity", "recipe", "technology", "tile"].includes(target.base_type), `flags line ${line}: inconsistent typed identity`);
    requireValue(typeof record.note === "string" && Number.isSafeInteger(record.tick) && record.tick >= 0 &&
      Number.isSafeInteger(record.player_index) && record.player_index > 0 && typeof record.force === "string" &&
      typeof record.surface === "string" && record.mod_versions && !Array.isArray(record.mod_versions) &&
      Object.values(record.mod_versions).every(version => typeof version === "string"), `flags line ${line}: invalid feedback envelope`);
    if (record.related_entity) requireValue(qualified.test(record.related_entity.id), `flags line ${line}: invalid related entity`);
    records.push({ line, startByte: start, endByte: end + 1, recordSha256: sha256(raw), record });
    start = end + 1;
  }
  requireValue(start === bytes.length, "Flag log ends with an incomplete line; take another read after the writer completes it");
  if (previous) requireValue(previous.bytes === 0 || records.some(row => row.endByte === previous.bytes), "Previous receipt cuts through a record");
  return { receipt: { bytes: bytes.length, sha256: sha256(bytes), records: records.length }, since: previous, records: records.filter(row => !previous || row.startByte >= previous.bytes) };
}

export function corpusInventory(content) {
  const paragraphs = new Map();
  const editorialSignals = [];
  for (const entry of content.entries) {
    const paragraph = `${entry.topic}: ${entry.text}`;
    const same = paragraphs.get(entry.text) ?? [];
    same.push(entry.id);
    paragraphs.set(entry.text, same);
    if (/\b(?:Factorio|Py(?:'s)?)\b/.test(entry.text)) editorialSignals.push({ id: entry.id, signal: "explicit-game-narration", targets: entry.targets, paragraph });
    if (/\bsimilar names\b/i.test(entry.text)) editorialSignals.push({ id: entry.id, signal: "name-comparison-instead-of-mechanism", targets: entry.targets, paragraph });
  }
  return {
    notes: content.entries.length, targets: content.targetCount, counts: content.counts,
    sources: Object.keys(content.sources).length,
    editorialSignals,
    duplicateBodies: [...paragraphs.values()].filter(ids => ids.length > 1),
    interpretation: "Editorial signals require review, not automatic rejection. Presence is not scientific or stylistic approval.",
  };
}

export function validateContext(context) {
  requireValue(context.schemaVersion === 1 && context.modVersions && context.sourceSave?.sha256 &&
    context.provenance && context.technologies && context.recipes && Array.isArray(context.omittedRecipes) &&
    Array.isArray(context.recipePrototypeNames) && Array.isArray(context.technologyPrototypeNames), "Unsupported relationship reference");
  const native = new Set(context.recipePrototypeNames);
  const omitted = new Set(context.omittedRecipes.map(row => row.id));
  requireValue(native.size === context.recipePrototypeNames.length && omitted.size === context.omittedRecipes.length, "Duplicate native or omitted recipe identity");
  for (const [id, recipe] of Object.entries(context.recipes)) {
    requireValue(id === recipe.id && qualified.test(id) && id.startsWith("recipe/") && native.has(id.slice(7)) &&
      !omitted.has(id) && Array.isArray(recipe.unlocks) && Array.isArray(recipe.ingredients) && Array.isArray(recipe.products), `Invalid reference recipe ${id}`);
    for (const part of [...recipe.ingredients, ...recipe.products]) {
      requireValue(typeof part.name === "string" && ["item", "fluid"].includes(part.type) && Number.isFinite(part.amount) && part.amount >= 0 &&
        (part.id === null || qualified.test(part.id)), `${id}: invalid typed ingredient/product`);
      if (part.targets) requireValue(part.targets.every(target => qualified.test(target)), `${id}: invalid product card`);
    }
    for (const product of recipe.products) requireValue(Array.isArray(product.targets) &&
      (product.id === null ? product.targets.length === 0 : product.targets[0] === product.id), `${id}: unresolved or inconsistent product-card ownership`);
  }
  requireValue(native.size === Object.keys(context.recipes).length + omitted.size &&
    [...omitted].every(id => native.has(id.slice(7))), "Reference does not account for every native recipe ID");
  for (const [name, prerequisites] of Object.entries(context.technologies)) {
    requireValue(Array.isArray(prerequisites) && prerequisites.every(value => typeof value === "string"), `Invalid prerequisites: ${name}`);
  }
  return context;
}

export function versionDifferences(expected, actual, neutralMods = []) {
  const neutral = new Set(neutralMods);
  return sorted([...Object.keys(expected), ...Object.keys(actual)]).filter(name => !neutral.has(name) && expected[name] !== actual[name])
    .map(name => ({ mod: name, reference: expected[name] ?? null, observed: actual[name] ?? null }));
}

export function auditScope({ flags, content, context, families, progress }) {
  validateContext(context);
  requireValue(families.schemaVersion === 1 && Array.isArray(families.families), "Unsupported family review schema");
  const issues = [];
  const familyIds = new Set();
  const forceStates = progress ? Object.fromEntries(Object.entries(progress.forces).map(([force, state]) =>
    [force, { enabled: new Set(state.enabledRecipes), researched: new Set(state.researchedTechnologies) }])) : null;
  for (const family of families.families) {
    requireValue(typeof family.id === "string" && !familyIds.has(family.id) && family.evidence?.length &&
      Array.isArray(family.targets) && Array.isArray(family.recipes) && Array.isArray(family.technologies) &&
      [...family.targets, ...family.recipes].every(id => qualified.test(id)), "Invalid/duplicate source-reviewed family");
    familyIds.add(family.id);
    for (const id of family.recipes) requireValue(context.recipes[id], `${family.id}: unknown explicit recipe ${id}`);
  }
  if (progress) {
    requireValue(progress.modVersions, "Save readback has no mod-version evidence");
    const differences = versionDifferences(context.modVersions, progress.modVersions, context.versionNeutralMods);
    if (differences.length) issues.push({ kind: "save-mod-version-mismatch", differences });
    for (const key of ["recipePrototypeNames", "technologyPrototypeNames"]) {
      requireValue(JSON.stringify(sorted(progress[key])) === JSON.stringify(sorted(context[key])), `Save ${key} differ from reference; review relationship evidence before using this save`);
    }
  }
  const producerIndex = new Map();
  for (const recipe of Object.values(context.recipes)) {
    const consumed = new Map();
    for (const part of recipe.ingredients) consumed.set(`${part.type}/${part.name}`, (consumed.get(`${part.type}/${part.name}`) ?? 0) + part.amount);
    const products = new Map();
    for (const part of recipe.products) {
      const key = `${part.type}/${part.name}`;
      const previous = products.get(key);
      products.set(key, { amount: (previous?.amount ?? 0) + part.amount, targets: sorted([...(previous?.targets ?? []), ...part.targets]) });
    }
    for (const [key, part] of products) {
      if (part.amount <= (consumed.get(key) ?? 0)) continue;
      for (const target of part.targets) {
        if (!producerIndex.has(target)) producerIndex.set(target, new Set());
        producerIndex.get(target).add(recipe.id);
      }
    }
  }
  const familyRecipes = new Map(families.families.map(family => [family.id,
    new Set([...family.recipes, ...family.targets.flatMap(id => [...(producerIndex.get(id) ?? [])])]) ]));
  const selectedFamilies = new Set();
  const selectedRecipes = new Set();
  const roots = new Set();
  const seeds = flags.records.map(row => {
    const { record } = row;
    const differences = versionDifferences(context.modVersions, record.mod_versions, context.versionNeutralMods);
    if (differences.length) issues.push({ kind: "flag-mod-version-mismatch", line: row.line, differences });
    const id = record.target.id;
    const equivalentTargets = new Set([id]);
    for (const producer of producerIndex.get(id) ?? []) {
      for (const product of context.recipes[producer].products) {
        if (product.targets.includes(id)) for (const target of product.targets) equivalentTargets.add(target);
      }
    }
    const matches = families.families.filter(family => family.targets.some(target => equivalentTargets.has(target)) ||
      familyRecipes.get(family.id).has(id) || (id.startsWith("technology/") && family.technologies.includes(id.slice(11))));
    if (!matches.length) issues.push({ kind: "unreviewed-family", line: row.line, target: id });
    for (const family of matches) selectedFamilies.add(family.id);
    if (id.startsWith("recipe/")) {
      if (context.recipes[id]) selectedRecipes.add(id);
      else issues.push({ kind: "unresolved-seed-recipe", line: row.line, target: id });
    } else {
      for (const producer of producerIndex.get(id) ?? []) selectedRecipes.add(producer);
      if (id.startsWith("technology/")) roots.add(id.slice(11));
    }
    return { ...row, families: matches.map(family => family.id), disposition: "review-required" };
  });
  const flaggedForces = new Set(seeds.map(seed => seed.record.force));
  for (const family of families.families.filter(family => selectedFamilies.has(family.id))) {
    for (const id of familyRecipes.get(family.id)) selectedRecipes.add(id);
    for (const id of family.technologies) roots.add(id);
  }
  for (const id of selectedRecipes) for (const name of context.recipes[id].unlocks) roots.add(name);
  const selectedUpgrades = {};
  const familyEntities = new Set([...selectedRecipes].flatMap(id => context.recipes[id].products.flatMap(part => part.targets.slice(1).map(target => target.split("/")[1]))));
  for (const [name, upgrade] of Object.entries(context.upgradePackages ?? {})) {
    const recipes = Object.values(upgrade.choices).flat().filter(effect => effect.type === "unlock-recipe").map(effect => `recipe/${effect.recipe}`);
    if (!recipes.some(id => selectedRecipes.has(id)) && !upgrade.affectedEntities.some(name => familyEntities.has(name))) continue;
    selectedUpgrades[name] = upgrade;
    roots.add(name);
    for (const id of recipes) {
      if (context.recipes[id]) selectedRecipes.add(id);
      else issues.push({ kind: "unresolved-upgrade-recipe", upgrade: name, target: id });
    }
  }
  const closure = new Set();
  const visiting = new Set();
  function visit(name) {
    if (visiting.has(name)) throw new Error(`Technology prerequisite cycle at ${name}`);
    if (closure.has(name)) return;
    if (!Object.hasOwn(context.technologies, name)) {
      issues.push({ kind: "unresolved-technology-prerequisites", target: `technology/${name}` });
      closure.add(name);
      return;
    }
    visiting.add(name);
    for (const prerequisite of context.technologies[name]) visit(prerequisite);
    visiting.delete(name);
    closure.add(name);
  }
  for (const name of roots) visit(name);
  const familySet = new Set(selectedRecipes);
  // Upgrade-choice unlocks are runtime packages, not ordinary technology effects.
  // Include all sibling choices of every upgrade technology in the closure.
  for (let previousSize = -1; previousSize !== closure.size;) {
    previousSize = closure.size;
    for (const [name, upgrade] of Object.entries(context.upgradePackages ?? {})) {
      if (!closure.has(name) || selectedUpgrades[name]) continue;
      selectedUpgrades[name] = upgrade;
      for (const effect of Object.values(upgrade.choices).flat()) {
        if (effect.type !== "unlock-recipe") continue;
        const id = `recipe/${effect.recipe}`;
        if (!context.recipes[id]) {
          issues.push({ kind: "unresolved-upgrade-recipe", upgrade: name, target: id });
          continue;
        }
        selectedRecipes.add(id);
        for (const owner of context.recipes[id].unlocks) visit(owner);
      }
    }
  }
  for (const recipe of Object.values(context.recipes)) if (recipe.unlocks.some(name => closure.has(name))) selectedRecipes.add(recipe.id);
  const noteIndex = new Map(content.entries.flatMap(entry => entry.targets.map(target => [target, entry])));
  function notes(targets) {
    return [...new Set(targets.map(target => noteIndex.get(target)).filter(Boolean))].map(entry => ({
      id: entry.id,
      eligibility: entry.when?.mod && !context.modVersions[entry.when.mod] ? "inactive" :
        entry.when?.startup || entry.when?.featureFlag ? "condition-unverified" : "eligible",
    }));
  }
  const upgradeReasons = new Map();
  for (const [name, upgrade] of Object.entries(selectedUpgrades)) {
    for (const [choice, effects] of Object.entries(upgrade.choices)) {
      for (const effect of effects) {
        if (effect.type !== "unlock-recipe") continue;
        const id = `recipe/${effect.recipe}`;
        if (!upgradeReasons.has(id)) upgradeReasons.set(id, []);
        upgradeReasons.get(id).push(`upgrade/${name}/${choice}`);
      }
    }
  }
  const scopes = sorted(selectedRecipes).map(id => {
    const recipe = context.recipes[id];
    for (const part of [...recipe.ingredients, ...recipe.products]) if (part.id === null) issues.push({ kind: "unresolved-native-subtype", recipe: id, type: part.type, name: part.name });
    const cards = [{ kind: "process", targets: [id], notes: notes([id]) }, ...recipe.products.map(part => ({ kind: "product", targets: part.targets, notes: notes(part.targets) }))];
    const processNote = cards[0].notes.some(note => note.eligibility === "eligible");
    const productNote = cards.slice(1).some(card => card.notes.some(note => note.eligibility === "eligible"));
    const uncertain = cards.some(card => card.notes.some(note => note.eligibility === "condition-unverified"));
    const availableFor = progress ? Object.entries(forceStates).filter(([force, state]) =>
      flaggedForces.has(force) && state.enabled.has(id.slice(7)) && !recipe.hidden && !recipe.excludedFromCrafting).map(([force]) => force) : null;
    const scopeReasons = [
      ...[...selectedFamilies].filter(family => familyRecipes.get(family).has(id)).map(family => `family/${family}`),
      ...recipe.unlocks.filter(name => closure.has(name)).map(name => `technology/${name}`),
      ...(upgradeReasons.get(id) ?? []),
      ...seeds.filter(seed => seed.record.target.id === id).map(seed => `flag-line/${seed.line}`),
    ];
    return { ...recipe, family: familySet.has(id), scopeReasons, availableFor, cards,
      coverage: processNote ? productNote ? "process-and-product" : "process-only" : productNote ? "product-only" : uncertain ? "condition-unverified" : "no-note" };
  });
  if (progress) for (const force of sorted(seeds.map(seed => seed.record.force))) if (!progress.forces[force]) issues.push({ kind: "unresolved-player-force", force });
  const targetIDs = sorted([...closure].map(name => `technology/${name}`).concat(scopes.flatMap(recipe =>
    [recipe.id, ...recipe.ingredients.map(part => part.id).filter(Boolean), ...recipe.products.flatMap(part => part.targets)])));
  const targets = targetIDs.map(id => ({ id, notes: notes([id]) }));
  const noteIds = new Set(targets.flatMap(target => target.notes.map(note => note.id)));
  const current = scopes.filter(recipe => recipe.availableFor?.length);
  return {
    schemaVersion: 1, status: issues.length ? "incomplete-evidence" : "scope-mapped-quality-review-required",
    flags: flags.receipt, since: flags.since, seeds, issues,
    families: families.families.filter(family => selectedFamilies.has(family.id)), rootTechnologies: sorted(roots),
    technologies: sorted(closure).map(name => ({ id: `technology/${name}`, prerequisites: context.technologies[name] ?? null, notes: notes([`technology/${name}`]),
      researchedBy: progress ? Object.entries(forceStates).filter(([force, state]) => flaggedForces.has(force) && state.researched.has(name)).map(([force]) => force) : null })),
    upgradePackages: selectedUpgrades, recipes: scopes, targets,
    existingNotesToReview: content.entries.filter(entry => noteIds.has(entry.id)),
    summary: { flags: seeds.length, families: selectedFamilies.size, technologies: closure.size, recipes: scopes.length, targets: targets.length,
      familyRecipes: familySet.size, currentCraftingRecipes: progress ? current.length : null,
      currentWithoutLesson: progress ? current.filter(recipe => recipe.coverage === "no-note").length : null,
      currentConditionalUnknown: progress ? current.filter(recipe => recipe.coverage === "condition-unverified").length : null,
      currentFamilyRecipes: progress ? current.filter(recipe => recipe.family).length : null,
      existingNotesToReview: noteIds.size, evidenceIssues: issues.length },
    limits: ["Scope mapping and coverage are not scientific/editorial approval; every flag remains review-required.",
      "Relationship reference provenance is retained; matching mod versions do not constitute a new engine capture.",
      "Saved progression is point-in-time; absence of a current save never becomes a future/unlocked claim.",
      "Startup/feature-conditional notes are unverified unless independently observed; they are not counted as eligible coverage.",
      "Native tooltip rendering and current complete data-stage execution are not exercised."],
  };
}
