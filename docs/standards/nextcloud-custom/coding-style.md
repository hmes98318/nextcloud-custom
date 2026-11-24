# Coding Style

## Style Authority

Variant: Google Style Guide (shell). Style authority: [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html).

Variant: Google Style Guide (typescript). Style authority: [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html).

## Toolchain

### shell

- Formatting: shfmt, configured in `.editorconfig`.
- Linting: ShellCheck, configured in `.shellcheckrc`.
- Type checking: none.
- Testing: none.

### typescript

- Formatting: Prettier, configured in `.prettierrc.json`.
- Linting: ESLint with typescript-eslint, configured in `eslint.config.mjs`.
- Type checking: TypeScript (`tsc --noEmit`), configured in `tsconfig.json`.
- Testing: none.

These tools and their configuration govern every concern listed above except testing.

## Code Comments

Policy: Concise. Briefly document public entry-point purposes and relevant contracts; explain non-obvious rules locally. Add internal explanations where intent or behavior remains unclear.

- Apply coverage to new or materially changed units and fill missing required explanations within those units.
- Use native documentation-comment syntax for contracts and nearby inline comments for implementation reasoning.
- Exclude generated and vendored code from manual additions. Meet license and tooling requirements for comments under every policy, including adding required notices, directives, or documentation comments.

Documentation comments use `#` comments.

Documentation comments use JSDoc `/** ... */` blocks.

## Style Rules

### shell

- Check the return value of every command that can fail with an informative message, and write error messages to standard error.
- Use arrays, not strings, for lists and command arguments, and expand them as `"${array[@]}"`.
- Declare function-local variables with `local`.
- Put all functions together near the top of the file after constants, and call `main "$@"` as the last line of scripts that contain at least one other function.
- Keep lines to at most 80 characters, put long literal strings in here-documents, and leave unsplittable paths and URLs on their own line.
- Name functions and variables in `lower_snake_case`, separate library names with `::`, and name constants and exported environment variables in `UPPER_SNAKE_CASE`, declared at the top of the file with `readonly` or `export`.
- Name source files in lowercase with underscores, not hyphens, as in `make_template`, not `make-template`.
- Use Bash for executable scripts (`#!/bin/bash`), keep shell for small utilities and wrappers, and rewrite a script that exceeds about 100 lines or uses complex control flow in a structured language.
- Test scripts as black boxes through Bats: `run` the executable, assert on exit status and output with `bats-assert`, and name each `@test` after the behavior and its expected outcome.
- Make each Bats test hermetic: use `$BATS_TEST_TMPDIR` for files, stub external commands with scripts on a temporary `PATH`, and never depend on the real home directory, network, clock, or locale.
- Use process substitution or `readarray` instead of piping into `while`.
- Do not use `eval` or aliases in scripts.
- Give executables a `.sh` extension or no extension, and give libraries a `.sh` extension without making them executable.
- Put `source` lines at the top of the script, after the header comment and `set` options, and give ShellCheck a `# shellcheck source=path` directive when the sourced path is computed.

### typescript

- Name namespace imports in `lowerCamelCase`, as in `import * as fooBar from './foo-bar.ts'`.
- Write implementation comments as `//` lines, never as multi-line `/* */` blocks.
- Export only the symbols that other modules use.
- Use type assertions only with a comment that explains why they are safe, unless the reason is obvious, and prefer a runtime check.
- Use `undefined` or `null` for absence as the surrounding API does, and do not put `|null` or `|undefined` in a type alias; add it where the alias is used.
- Keep getters pure so they never change observable state, and make a property public or `readonly` instead of writing a pass-through accessor.
- Prefer real implementations or in-memory fakes over mocks; mock only external boundaries, and assert on calls only when the call is the behavior under test.
- Test observable behavior through the public API, and name each test after the behavior and its expected outcome.
- Name things descriptively, and do not use ambiguous abbreviations or abbreviations that delete letters, except for variables in scope for 10 lines or fewer.
- Prefer small, focused functions, and consider splitting a function that exceeds about 40 lines.

## TypeScript Conventions

- Name TypeScript source files in kebab-case, as in `docker-compose.ts`.
- Never use `any`. Type unknown data as `unknown` and narrow it with type guards before use. Parse JSON and other external data into `unknown` first, then validate it.
- Do not use type assertions to get around the type checker. Use one only where a framework or API boundary requires it, with a comment that states why it is safe.
- Write only erasable TypeScript syntax, because Node.js runs the files directly by stripping the types: no `enum`, `namespace`, parameter properties, or `import x = require()`. Use `import type` for type-only imports, and write the `.ts` extension in relative imports. `erasableSyntaxOnly` in `tsconfig.json` enforces this.
- Prefer `interface` for object shapes and string-literal unions over enums, and prefer functions and plain objects over classes.
