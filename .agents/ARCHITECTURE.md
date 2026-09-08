# Architecture

`README.md` is the canonical product specification. Milestone 1 is complete, and
the first Milestone 2 slice adds `packages/agents` and `packages/terminal`.
`voice codex [args...]` now owns Codex in an interactive PTY in the current
directory. Voice capture, transcription, and transcript injection into that
session remain unimplemented. Milestone 1 has been manually verified on macOS.

## Target runtime

```text
microphone -> audio capture -> transcription -> deterministic processing
           -> terminal / PTY -> Codex or Claude Code -> active repository
```

The `voice` CLI owns the coding-agent child process and coordinates the runtime.
It is a voice-input layer, not a coding agent, orchestrator, repository knowledge
system, or LLM proxy.

## Intended boundaries

- `apps/cli` (implemented): parses `voice test` and `voice codex`, validates
  provider configuration for the test flow, coordinates runtime boundaries,
  owns user-facing output, and propagates Codex's exit status.
- `packages/audio` (implemented): defines recorder/session contracts and an FFmpeg
  recorder. Platform strategies use AVFoundation on macOS, DirectShow on Windows,
  and prefer PulseAudio over ALSA when those inputs are compiled into FFmpeg on
  Linux. Recordings are normalized to mono 16 kHz PCM WAV, read into memory, and
  removed from temporary storage before the provider receives them.
- `packages/transcription` (implemented): defines the provider contract and an
  OpenAI hosted implementation using the audio transcriptions endpoint. The API
  key comes from `OPENAI_API_KEY`, either exported by the shell or loaded from an
  ignored `.env.local` file. Exported values take precedence. The default model
  is `gpt-4o-transcribe` and can be changed with
  `OPENAI_TRANSCRIPTION_MODEL`.
- `packages/agents` (implemented for Codex): small executable and argument
  adapters that do not contain audio or transcription logic.
- `packages/terminal` (process management implemented): executable discovery and
  injected PTY/host-terminal boundaries backed by node-pty 1.1.0. It proxies I/O,
  resize events, and supported signals; propagates child exit status; restores
  terminal state; and removes listeners on exit. Transcript injection remains.

Dependencies should point inward through these contracts. Audio must not know
about agents or providers; agent adapters must not know about audio or
transcription; provider details must not leak into terminal behavior; the CLI
coordinates rather than accumulating domain logic.

The CLI depends on the audio and transcription packages. Those packages do not
depend on each other. FFmpeg is an explicit runtime dependency rather than a Node
package or platform-specific application build. Windows currently requires an
explicit DirectShow microphone name; macOS and Linux default to the system input.
The CLI also depends on the agents and terminal packages; those packages remain
independent of audio and transcription. node-pty is allowlisted as the sole pnpm
native build dependency, and the terminal package repairs the executable bit
missing from node-pty 1.1.0's bundled macOS spawn helper during installation.

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
  different slice; `voice test` is complete and Codex integration is next.
