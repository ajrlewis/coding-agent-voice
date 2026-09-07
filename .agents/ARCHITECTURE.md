# Architecture

`README.md` is the canonical product specification. The repository is currently
README-first: the target architecture below is declared intent, not implemented
state.

## Target runtime

```text
microphone -> audio capture -> transcription -> deterministic processing
           -> terminal / PTY -> Codex or Claude Code -> active repository
```

The `voice` CLI owns the coding-agent child process and coordinates the runtime.
It is a voice-input layer, not a coding agent, orchestrator, repository knowledge
system, or LLM proxy.

## Intended boundaries

- `apps/cli`: parsing, configuration, orchestration, lifecycle, and diagnostics.
- `packages/audio`: recording, device access, normalization, and temporary audio.
- `packages/transcription`: provider contract and hosted or local implementations.
- `packages/agents`: small executable and argument adapters for coding agents.
- `packages/terminal`: PTY spawning, I/O proxying, transcript injection, resize,
  signals, and child-process lifecycle.

Dependencies should point inward through these contracts. Audio must not know
about agents or providers; agent adapters must not know about audio or
transcription; provider details must not leak into terminal behavior; the CLI
coordinates rather than accumulating domain logic.

## Invariants

- Keep the voice layer thin. Do not add another general-purpose reasoning model
  between transcription and the coding agent without a demonstrated need.
- Prefer minimal deterministic transcript processing that preserves user intent.
- Provider, agent, and repository independence are requirements.
- Isolate native and platform-specific audio or PTY behavior behind interfaces.
- Fail visibly for microphone, credential, provider, executable, and PTY errors.
- Secrets remain in environment variables and must not be logged.
- Disclose hosted processing; delete temporary audio promptly by default.
- Repository vocabulary is optional and bounded. Runtime code may read useful
  bootstrap context but must not own or modify it.
- Implement the README milestones in order unless a task explicitly requires a
  different slice; `voice test` is the first product milestone.
