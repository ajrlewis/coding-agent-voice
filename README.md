# coding-agent-voice

Voice input for terminal-based coding agents.

`coding-agent-voice` is a TypeScript CLI that adds push-to-talk voice input to coding agents such as Codex and Claude Code.

The primary interface is intentionally simple:

```bash
cd my-project
voice codex
```

or:

```bash
cd my-project
voice claude
```

`voice` launches the requested coding agent in the current repository, captures microphone input on demand, transcribes speech, and delivers the resulting text to the active agent session.

The coding agent itself remains responsible for understanding the repository, reasoning about the task, editing files, running commands, and interacting with its normal tools.

`coding-agent-voice` is only responsible for turning speech into high-quality coding-agent input.

## Status

Milestone 1 is implemented. The maintainer has exercised the complete
`voice test` flow on macOS with a real microphone and the OpenAI transcription
API:

```text
microphone
    ↓
audio capture
    ↓
speech-to-text
    ↓
transcript
    ↓
stdout
```

The current workspace contains the CLI, audio, and transcription packages needed
for that slice. Codex, Claude Code, and PTY integration are not implemented yet;
Milestone 2 is the next product milestone.

## Quick start

Requirements:

* Node.js 22 or newer
* pnpm 10.29.2
* FFmpeg with AVFoundation on macOS, DirectShow on Windows, or PulseAudio/ALSA
  on Linux
* an OpenAI API key

Install, configure, and build:

```bash
pnpm install
cp .env.example .env.local
# Add OPENAI_API_KEY to .env.local.
pnpm build
```

Then test the microphone-to-transcript flow:

```bash
node apps/cli/dist/main.js test
```

Recording starts immediately. Press Enter to stop recording and send the audio
to OpenAI for transcription. Status and privacy messages go to stderr; only the
transcript is written to stdout. `.env.local` is ignored by Git, and an exported
`OPENAI_API_KEY` takes precedence over the file.

## Goals

The project aims to provide:

* push-to-talk voice input for terminal coding agents
* a single wrapper command for starting voice-enabled agent sessions
* high-quality transcription of software-development terminology
* low-latency interaction
* support for multiple coding agents
* configurable transcription providers
* optional repository-aware transcription context
* clean separation between audio, transcription, terminal, and agent concerns
* a foundation for local transcription in addition to hosted APIs

The desired experience is:

```bash
cd ~/code/my-project
voice codex
```

Then, while Codex is running:

```text
[push-to-talk]

"look at the authentication package and figure out
why the refresh token tests are failing"

        ↓

Look at the authentication package and figure out
why the refresh token tests are failing.

        ↓

Codex receives the prompt
```

The same workflow should work with Claude Code:

```bash
voice claude
```

## Non-goals

`coding-agent-voice` is not:

* a coding agent
* an agent orchestrator
* a replacement for Codex or Claude Code
* a repository knowledge system
* a general-purpose voice assistant
* an MCP server as its primary interaction model
* an LLM proxy between the user and the coding agent

The project should avoid duplicating functionality already provided by the underlying coding agent.

In particular, the voice layer should not reason about coding tasks. Its job is to faithfully turn spoken intent into text and deliver that text to the agent.

## Core design principle

Keep the runtime pipeline simple:

```text
speech
  ↓
transcription
  ↓
minimal deterministic processing
  ↓
coding agent
```

Do not introduce an additional general-purpose LLM call between transcription and the coding agent unless there is a clear need.

The coding agent is already the reasoning layer.

## CLI

The currently implemented command is:

```bash
voice test
```

The planned primary commands are:

```bash
voice codex
voice claude
```

Additional planned utility commands may include:

```bash
voice doctor
voice config
```

### `voice codex`

Starts Codex with voice input enabled.

```bash
cd ~/code/project
voice codex
```

Arguments after the agent command should be forwarded to the underlying executable where practical.

For example:

```bash
voice codex --resume
```

should behave conceptually like:

```bash
codex --resume
```

while retaining voice support.

### `voice claude`

Starts Claude Code with voice input enabled.

```bash
voice claude
```

### `voice test`

Tests the microphone and transcription pipeline without starting a coding agent.

Current behavior:

```bash
voice test

# recording...
# transcribing...

Refactor the authentication middleware and run the tests.
```

### `voice doctor`

Checks common runtime requirements such as:

* microphone access
* transcription provider configuration
* API credentials
* Codex installation
* Claude Code installation
* audio capture dependencies
* terminal/PTY support

## Runtime architecture

The preferred runtime model is for `voice` to own the coding-agent process.

```text
Terminal
   │
   ▼
┌──────────────────────────┐
│ voice CLI                │
│                          │
│ ┌──────────────────────┐ │
│ │ audio capture        │ │
│ └──────────┬───────────┘ │
│            ↓             │
│ ┌──────────────────────┐ │
│ │ transcription        │ │
│ └──────────┬───────────┘ │
│            ↓             │
│ ┌──────────────────────┐ │
│ │ terminal / PTY       │ │
│ └──────────┬───────────┘ │
│            ↓             │
│      Codex / Claude      │
└────────────┬─────────────┘
             │
             ▼
         repository
```

This is preferred over requiring users to manually start a separate daemon.

Instead of:

```bash
voice_daemon &
codex
```

the normal workflow should simply be:

```bash
voice codex
```

A standalone daemon may be added later if global voice input or multiple-session routing becomes useful.

## Process model

The coding agent should run as a child process of `voice`.

Conceptually:

```ts
voice
  ├── initialize audio
  ├── initialize transcription provider
  ├── spawn coding agent
  ├── proxy terminal interaction
  ├── handle push-to-talk
  ├── transcribe recordings
  ├── deliver transcripts to agent
  └── clean up when agent exits
```

Codex and Claude Code are interactive terminal applications, so implementation will likely require a pseudo-terminal (PTY) rather than ordinary stdin/stdout pipes.

PTY-specific behavior should be isolated behind a terminal/process abstraction.

## Push-to-talk

The intended interaction is push-to-talk rather than continuous recording.

Conceptually:

```text
key down
   ↓
start recording
   ↓
user speaks
   ↓
key up
   ↓
stop recording
   ↓
transcribe
   ↓
insert transcript
```

The exact hotkey mechanism is intentionally not fixed yet.

The first implementation should prioritize reliability and portability over sophisticated global keyboard handling.

Possible future interactions include:

* terminal-local keyboard shortcuts
* configurable global hotkeys
* automatic voice activity detection
* explicit start/stop recording commands

## Transcription

Transcription must be provider-based.

The core package exposes a provider interface equivalent to:

```ts
export interface TranscriptionProvider {
  transcribe(
    audio: TranscriptionAudio,
    options?: TranscriptionOptions,
  ): Promise<string>;
}
```

The implemented provider uses the OpenAI transcription API. Its default model is:

```text
gpt-4o-transcribe
```

The OpenAI provider uses the standard:

```text
OPENAI_API_KEY
```

environment variable.

The architecture must not require OpenAI permanently.

Future providers may include:

* OpenAI hosted transcription
* local Whisper
* whisper.cpp
* MLX-based Whisper on Apple Silicon
* other speech-to-text providers

The rest of the application should not care which provider performs transcription.

## Repository-aware transcription

Software repositories contain vocabulary that generic speech recognition may interpret incorrectly.

Examples include:

```text
Drizzle
tRPC
pnpm
Supabase
PostgreSQL
Vitest
getUserById
OrganizationMember
```

Where supported by the transcription provider, `coding-agent-voice` should be able to provide a small amount of repository-specific vocabulary as transcription context.

Potential sources include:

```text
package.json
pyproject.toml
Cargo.toml
go.mod
README.md
AGENTS.md
.agents/ARCHITECTURE.md
.agents/COMMANDS.md
```

This feature must remain bounded.

The voice layer should extract useful vocabulary, not attempt to independently understand the entire repository.

## Integration with coding-agent-bootstrap

`coding-agent-voice` complements `coding-agent-bootstrap`, but the projects should remain independent.

Their responsibilities are different:

```text
coding-agent-bootstrap
        │
        │ prepares durable repository context
        ▼
     repository
        │
        ▼
 Codex / Claude Code
        ▲
        │
        │ runtime prompts
        │
coding-agent-voice
        ▲
        │
     microphone
```

`coding-agent-bootstrap` prepares a repository for coding agents.

`coding-agent-voice` provides a runtime human-to-agent voice interface.

If bootstrap-generated files are present, `coding-agent-voice` may consume a small amount of information from them for transcription vocabulary.

It should not own or modify those files.

The projects must not require each other.

A repository that has never used `coding-agent-bootstrap` should still support:

```bash
voice codex
```

## Monorepo

The project is a TypeScript monorepo using pnpm workspaces.

Implemented structure:

```text
coding-agent-voice/
├── apps/
│   └── cli/
│
├── packages/
│   ├── audio/
│   └── transcription/
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

The monorepo should remain intentionally small.

Additional packages should only be introduced when a clear architectural boundary exists.

## Packages

### `apps/cli` (implemented)

The user-facing `voice` executable.

Responsibilities:

* command parsing
* configuration loading
* selecting the coding agent
* selecting the transcription provider
* coordinating runtime services
* lifecycle and signal handling
* user-facing errors and diagnostics

It should contain orchestration rather than implementation-heavy domain logic.

### `packages/audio` (implemented)

Audio capture primitives.

Responsibilities may include:

* microphone discovery
* recording
* audio format normalization
* temporary recording management
* start/stop semantics
* eventual voice activity detection

The package should not know anything about Codex, Claude, or transcription providers.

### `packages/transcription` (implemented)

Speech-to-text abstraction and implementations.

Initial shape:

```text
transcription/
├── provider.ts
├── openai.ts
└── index.ts
```

Responsibilities:

* transcription provider interface
* OpenAI implementation
* transcription options
* provider errors
* transcription context/prompt support

Future local Whisper implementations should conform to the same abstraction.

### `packages/agents` (planned for Milestones 2 and 3)

Coding-agent adapters.

Initial agents:

```text
Codex
Claude Code
```

An adapter should describe how to:

* locate or invoke the agent
* construct command-line arguments
* forward user arguments
* identify agent-specific runtime requirements

The interface should remain small.

Conceptually:

```ts
export interface CodingAgent {
  name: string;
  command: string;

  args(userArgs: string[]): string[];
}
```

Agent adapters must not contain transcription or audio logic.

### `packages/terminal` (planned for Milestone 2)

Interactive terminal process management.

Responsibilities:

* spawning the coding agent
* PTY management
* forwarding terminal input/output
* injecting transcribed text
* resize handling
* process lifecycle
* signal handling

This package provides the boundary between the voice system and interactive coding-agent TUIs.

## Possible future packages

Do not create these until they are justified.

Potential examples include:

```text
packages/repo-context
packages/config
packages/mcp
```

`repo-context` may become useful if repository vocabulary extraction grows beyond a small utility.

`mcp` may eventually expose audio/transcription operations to coding agents themselves, but MCP is not required for the primary voice-input workflow.

## Configuration

Configuration should eventually support both global defaults and optional repository overrides.

A possible global location is:

```text
~/.config/coding-agent-voice/config.toml
```

Example:

```toml
[transcription]
provider = "openai"
model = "gpt-4o-transcribe"
language = "en"

[voice]
push_to_talk = true
```

Repository-local configuration may eventually be supported, for example:

```text
.voice.toml
```

but should not be required for normal use.

Environment variables should be used for secrets.

For example:

```bash
export OPENAI_API_KEY="..."
```

For local development, the CLI also loads `OPENAI_API_KEY` and
`OPENAI_TRANSCRIPTION_MODEL` from an ignored `.env.local` file. Copy
`.env.example` to `.env.local` and fill in the key; values explicitly exported
by the shell take precedence.

API keys must never be stored in repository configuration by default.

## Technology

Primary implementation:

```text
TypeScript
Node.js
pnpm
pnpm workspaces
```

The project should prefer Node APIs and small focused dependencies.

Native or platform-specific dependencies are acceptable where necessary for:

* microphone capture
* global keyboard shortcuts
* PTY support
* local speech recognition

Platform-specific behavior should be isolated behind interfaces where practical.

## Development principles

### Keep the voice layer thin

The coding agent already performs reasoning.

Avoid building another agent inside the voice layer.

### Prefer deterministic transformations

After transcription, small transformations such as whitespace normalization or explicit spoken commands are acceptable.

Avoid silently rewriting the user's intent.

### Provider independence

Audio capture should not depend on OpenAI.

Agent adapters should not depend on transcription providers.

Transcription providers should not depend on terminal behavior.

### Agent independence

Codex and Claude Code should be adapters over the same core runtime.

Adding another coding agent should not require changing audio or transcription code.

### Repository independence

The tool should work in any repository.

Repository-aware vocabulary is an enhancement, not a requirement.

### Fail visibly

Microphone failures, missing API credentials, unavailable agent executables, and transcription errors should produce clear actionable errors.

Do not silently discard recordings or prompts.

## Spoken commands

A small deterministic command vocabulary may eventually be useful.

Examples:

```text
"new line"
"new paragraph"
"cancel"
"scratch that"
"send it"
```

These should be implemented conservatively.

Normal software-development speech must not accidentally trigger control commands.

Explicit interaction design should be established before expanding this feature.

## Security and privacy

Audio may contain source-code details, credentials spoken aloud, customer information, or other sensitive material.

The project should clearly document when audio leaves the local machine.

Hosted transcription providers must be opt-in through configuration and credentials.

Local transcription should eventually provide a path where recorded audio does not need to leave the machine.

Temporary audio files should be deleted promptly after transcription unless the user explicitly enables retention for debugging.

Secrets must not be written into repository configuration or logs.

## MCP

MCP is a possible future extension, not the primary architecture.

The primary direction is:

```text
human
  ↓
voice
  ↓
coding agent
```

MCP generally enables the reverse interaction:

```text
coding agent
  ↓
MCP tool
  ↓
audio/transcription capability
```

A future MCP server could expose tools such as:

```text
transcribe_file
get_last_transcript
transcribe_recording
```

This should remain separate from the core push-to-talk interaction.

## Milestones

### Milestone 1 — transcription (complete)

Make this work reliably:

```bash
voice test
```

Flow:

```text
microphone
   ↓
record
   ↓
OpenAI transcription
   ↓
stdout
```

No Codex or Claude integration is required for this milestone.

Implemented with FFmpeg audio capture, an OpenAI provider boundary, explicit
hosted-processing disclosure, temporary-file cleanup, `.env.local` support, and
automated boundary/orchestration tests. The maintainer manually verified the
complete flow on macOS with a real microphone and API credential.

### Milestone 2 — Codex (next)

Make this work:

```bash
cd project
voice codex
```

Requirements:

* launch Codex in the current directory
* preserve normal interactive Codex behavior
* capture push-to-talk audio
* transcribe it
* insert the resulting text into the Codex session
* cleanly exit when Codex exits

This is the first complete product milestone.

### Milestone 3 — Claude Code

Add:

```bash
voice claude
```

using the same runtime abstractions.

No audio or transcription logic should need to change.

### Milestone 4 — configuration and diagnostics

Add:

```bash
voice config
voice doctor
```

Improve:

* configuration
* errors
* installation diagnostics
* microphone selection
* provider selection

### Milestone 5 — repository vocabulary

Extract a bounded vocabulary from the active repository and use it to improve transcription.

Support bootstrap-generated repository context when available without creating a dependency on `coding-agent-bootstrap`.

### Milestone 6 — local transcription

Add at least one local Whisper-compatible transcription provider.

The desired result is:

```text
microphone
   ↓
local model
   ↓
transcript
   ↓
coding agent
```

without requiring a transcription API key.

## Future possibilities

Once the core experience is reliable, possible extensions include:

* configurable global push-to-talk
* voice activity detection
* local Whisper
* automatic repository vocabulary extraction
* per-repository pronunciation dictionaries
* multiple simultaneous coding-agent sessions
* session targeting
* tmux integration
* transcript history
* optional transcript preview before submission
* MCP transcription tools
* Linux/macOS platform integrations
* additional coding-agent adapters

These are deliberately secondary to making:

```bash
voice codex
```

fast, reliable, and pleasant to use.

## Relationship to coding agents

`coding-agent-voice` should treat coding agents as external tools.

It should not fork, patch, or depend on the internal implementation of Codex or Claude Code unless unavoidable.

The preferred integration boundary is the terminal process.

This keeps the project useful across agent versions and allows new agents to be added through small adapters.

## Philosophy

Coding agents have made the terminal conversational, but typing remains the primary input mechanism.

For many development tasks, describing intent aloud is faster and more natural:

> Look at the changes on this branch, find anything that isn't covered by tests, and add the missing tests without changing production behavior.

`coding-agent-voice` exists to make that interaction feel native.

The project should do one thing well:

**let a developer talk to the coding agent already working in their repository.**
