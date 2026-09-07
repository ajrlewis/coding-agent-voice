# Workflow

## Current development process

`README.md` is the source of truth for product scope, constraints, target
architecture, and milestone order. Separate its target state from the repository's
implemented state.

For each change:

1. Read the relevant README sections and `.agents/ARCHITECTURE.md`.
2. Inspect the actual repository state before assuming a component exists.
3. Define a narrow, verifiable outcome within the earliest relevant milestone.
4. Make the minimum surgical change while preserving package boundaries.
5. Run applicable commands from `.agents/COMMANDS.md`.
6. Review the diff and update durable context only when repository facts changed.
7. Record genuine out-of-scope agent setup work in `.agents/TODO.md`; do not use
   it as a task plan or product backlog.

## Git

The repository uses GitHub and currently has no documented project-specific Git
policy, so `.agents/presets/git/github-flow.md` is adopted. Work on focused
branches, sync and verify before push or pull-request updates, and do not push
directly to `main`.

## Quality baseline

The repository has no implementation or quality toolchain yet. Establishing the
TypeScript scaffold, dependencies, tests, static checks, and CI is a material
implementation decision rather than part of documentation bootstrap. Once
approved and implemented, use ecosystem-native tools, verify every canonical
command, and update `.agents/COMMANDS.md`.

Application code should ultimately have automated behavior verification plus
typechecking, formatting/linting, and build validation. Audio, transcription,
process lifecycle, cleanup, privacy, and failure paths require explicit coverage.
