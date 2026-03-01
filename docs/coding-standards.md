# Coding Standards

## Language and typing

- Use TypeScript (ESM).
- Keep strict typing; avoid `any`.
- Do not use `@ts-nocheck`.
- Do not bypass typing rules to silence errors; fix root causes.

## Quality checks

- Use project checks before commits:
  - `npm run check`
- This runs:
  - formatting check (`prettier --check`)
  - lint (`eslint`)
  - typecheck (`tsc --noEmit`)
  - tests (`vitest`)

## Class and composition patterns

- Do not share class behavior via prototype mutation.
- Avoid patterns like:
  - `Object.defineProperty(SomeClass.prototype, ...)`
  - runtime mixin merging via `.prototype`
- Prefer explicit inheritance or composition with typed helpers.

## Test conventions

- Prefer per-instance stubs/mocks in tests.
- Avoid prototype-level monkey patching unless explicitly justified in the test.

## Code readability

- Add brief comments for non-obvious logic.
- Keep files focused and concise.
- Extract helpers instead of creating duplicate "V2" implementations.
- Target roughly under 700 LOC per file when practical (guideline, not a hard limit).
