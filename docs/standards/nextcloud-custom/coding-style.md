# Coding Style

## Style Authority

Variant: Google Style Guide. Style authority: [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html).

## Toolchain

- Formatting: shfmt, configured in `.editorconfig`.
- Linting: ShellCheck, configured in `.shellcheckrc`.
- Type checking: none.
- Testing: none.

These tools and their configuration govern every concern listed above except testing.

## Code Comments

Policy: Concise. Briefly document public entry-point purposes and relevant contracts; explain non-obvious rules locally. Add internal explanations where intent or behavior remains unclear.

- Apply coverage to new or materially changed units and fill missing required explanations within those units.
- Use native documentation-comment syntax for contracts and nearby inline comments for implementation reasoning.
- Exclude generated and vendored code from manual additions. Meet license and tooling requirements for comments under every policy, including adding required notices, directives, or documentation comments.

Documentation comments use `#` comments.

## Style Rules

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
