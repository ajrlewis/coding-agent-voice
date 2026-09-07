# Coding Agent Rules

## 1. Think Before Coding
Do not assume. Surface ambiguity. Understand existing code and context before changing it.

## 2. Keep It Simple
Write the minimum code necessary. Avoid speculative abstractions, unnecessary flexibility, and premature generalization.

## 3. Make Surgical Changes
Change only what the task requires. Preserve existing patterns. Do not refactor unrelated code.

## 4. Work Toward Verifiable Outcomes
Define success. Test the result. Do not declare completion without evidence.

## Where To Look

- `.agents/WORKFLOW.md` - the project's development process.
- `.agents/COMMANDS.md` - canonical verified commands.
- `.agents/ARCHITECTURE.md` - system boundaries and invariants.
- `.agents/TODO.md` - persistent agent-managed follow-up work.
- `.agents/presets/` - adopted engineering conventions.
- `.agents/skills/` - recurring specialized procedures, when the project defines them.
- `.agents/mcp/` - desired external capabilities.

If `.agents/BOOTSTRAP.md` exists, complete it before normal project work.

## Definition Of Done

Run relevant checks from `.agents/COMMANDS.md`, verify the requested outcome, review the diff, update agent-managed context if facts changed, and record discovered out-of-scope work in `.agents/TODO.md`. Never claim a check passed unless it was run.
