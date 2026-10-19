# Factorio mod workshop

## Canonical boundaries

- `mods/<mod-id>/info.json` owns product identity and dependencies. Discover products through `tools/projects.ts`; never infer a default product or maintain a second registry.
- `tools/cli.ts` is the Effect CLI entrypoint. Mise tasks only forward arguments. Keep orchestration in Bun + Effect and runtime contracts in Effect Schema; derive types from those contracts.
- Shared tooling, dependency pins and formatting configuration belong at root. Runtime, locales, sprites, storage types, test scenes and product-specific rules remain with their product.
- Keep archive, provisioning and offline-save boundaries in Bun with the canonical Effect contracts. Do not introduce a second interpreter, duplicate validators, silent fallbacks or automatic retries of mutations.
- Read the selected product's guidance and documentation for its ownership and behavior constraints. Preserve attribution and packaged licenses.

## Development and verification

- Follow `tools/README.md` for explicit bootstrap. Help and invalid CLI invocations must not install dependencies, start Factorio or allocate work.
- Use `mise run format -- <mod>` or `--all` for formatting; `check` is read-only. Run `mise run verify -- <mod>` for the declared full product coverage, not merely source-quality checks.
- Native scenes and presentation assets use the explicit standalone full client. Presentation captures must use Extreme. Record actual viewport, locale and scale; never relax capture checks to hide a display mismatch.
- Use the canonical owned-process, logs and source-seal boundaries. Keep generated state under ignored `.factorio-test/`; never signal unrelated Factorio processes or use normal saves as disposable fixtures.
- Changed shared tooling affects its consumers. A stale or incomplete receipt is not current evidence, and an engine suite is not equivalent to a test-framework-free exact-package smoke.
- The migration and verification checklists distinguish implemented behavior, observed proof and pending gates. Update evidence honestly; do not mark intended behavior as passed.

## Authority

Verification and local release preparation do not authorize normal-profile installation, commits, source pushes or Portal publication. Keep these operations separate and perform them only within the user's explicit scope. See the developer guide for checkpoint staging, publication uncertainty and reversible local installation contracts.
