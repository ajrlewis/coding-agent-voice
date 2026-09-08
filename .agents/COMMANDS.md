# Commands

## Requirements

- Node.js 22 or newer.
- pnpm 10.29.2, pinned by the root `packageManager` field.
- FFmpeg with the platform capture backend needed at runtime: AVFoundation on
  macOS, DirectShow on Windows, or PulseAudio/ALSA on Linux.

## Setup

```sh
pnpm install

# Optional local credentials. This file is ignored by Git.
cp .env.example .env.local
```

## Development and validation

```sh
# Compile all workspace projects.
pnpm build

# Strict TypeScript project-reference check.
pnpm typecheck

# Lint TypeScript and JavaScript.
pnpm lint

# Check or apply source/config formatting.
pnpm format:check
pnpm format

# Build and run all unit/integration-boundary tests.
pnpm test

# Run one package's tests after compiling.
pnpm build
pnpm --filter @coding-agent-voice/audio test

# Run every required local check.
pnpm check
```

## CLI

```sh
pnpm build
node apps/cli/dist/main.js --help

# Sends the completed recording to OpenAI. Set OPENAI_API_KEY in the shell or
# the ignored .env.local file.
OPENAI_API_KEY=... node apps/cli/dist/main.js test
node apps/cli/dist/main.js test

# Windows requires an explicit DirectShow microphone name.
OPENAI_API_KEY=... node apps/cli/dist/main.js test --device "Microphone name"
```

Do not claim microphone or hosted API behavior passed based only on automated
tests; exercise those integrations explicitly and report the tested platform.
