# Development Guidelines

## Scope and precedence

Use these guidelines for every change.

## Engineering principles

- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.
- When the same mistake recurs, propose preventing it with types, a lint rule, or a test instead of another written instruction.

## Code quality

### Readability

- Prioritize human readability over code compactness.
- Separate functions, classes, and distinct logical sections with appropriate blank lines.
- Break down dense expressions when meaningful intermediate variables improve clarity.

### Comments

- Apply the selected comment policy to software application code. Keep required explanations in the code; development documentation cannot replace them.
- Explain purpose, contracts, and non-obvious reasoning as required by the policy. Skip redundant narration of trivial code without omitting required explanations of contracts or business rules.
- Keep comments accurate when behavior changes.

### Consistency

- Follow repository conventions and enforced formatter settings.
- Preserve behavior and public interfaces outside the intended change; avoid unrelated refactoring.

## Required workflow

1. Read the task and identify the related source code, tests, documentation, public API, and configuration. Search the repository rather than relying on assumptions.
2. Decide how to implement the change, then create an ordered TODO list of small, independently completable tasks before editing. Keep the list updated as work progresses.
3. Work through the TODO list in dependency order. Read every related file before making a broad change. When a design needs extensive editing or can be substantially simplified, replacing the fully understood file is acceptable.
4. Keep each intermediate state buildable and behaviorally coherent. Add functionality incrementally and verify it as it is completed.
5. Update related documentation, exported types, and tests when the changed behavior requires them.

## Research and decisions

- Inspect relevant project documentation and code before selecting an approach.
- Use web research when project context, upstream behavior, security guidance, or dependency capabilities require verification. Prefer primary documentation.

## Validation

- Where a code-comment policy applies, review changed source against its requirements and exceptions without relying on development documentation.
- Run the verification commands listed in the applicable `AGENTS.md`, and any other configured lint, formatting, static analysis, and code-quality checks relevant to the changed files.
- Run the configured build, compile, type-check, or packaging commands as applicable to validate that the project produces its expected outputs successfully.
- Run the relevant tests for the changed behavior. Run the full configured test suite when the changes affect shared, cross-cutting, or broadly used behavior.
- Resolve validation failures caused by the change. Do not bypass them with compatibility workarounds, broad suppressions, disabled checks, or weakened validation rules.
