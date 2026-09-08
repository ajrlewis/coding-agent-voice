import { createInterface } from "node:readline";

import { CodexAgent, type CodingAgent } from "@coding-agent-voice/agents";
import {
  FfmpegRecorder,
  type AudioBackend,
  type AudioRecorder,
} from "@coding-agent-voice/audio";
import {
  NodePtyTerminal,
  type TerminalRunner,
} from "@coding-agent-voice/terminal";
import {
  OpenAITranscriptionProvider,
  type TranscriptionProvider,
} from "@coding-agent-voice/transcription";

export interface CliDependencies {
  agent: CodingAgent;
  cwd: string;
  environment: NodeJS.ProcessEnv;
  recorderFactory: (options: {
    backend?: AudioBackend;
    device?: string;
  }) => AudioRecorder;
  providerFactory: (
    environment: NodeJS.ProcessEnv,
  ) => TranscriptionProvider & { model: string };
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdin: NodeJS.ReadStream;
  stdout: Pick<NodeJS.WriteStream, "write">;
  terminal: TerminalRunner;
  waitForStop: () => Promise<void>;
}

const HELP = `Usage:
  voice codex [args...]
  voice test [--device <name>] [--backend <backend>] [--language <code>]

Backends:
  macOS: avfoundation
  Windows: dshow
  Linux: pulse (preferred) or alsa

Environment:
  OPENAI_API_KEY                Required; used only for the hosted API request
  OPENAI_TRANSCRIPTION_MODEL    Optional; defaults to gpt-4o-transcribe
  .env.local                    Optional; shell environment values take precedence
`;

export async function runCli(
  argv: string[],
  dependencies: Partial<CliDependencies> = {},
): Promise<number> {
  const deps = createDependencies(dependencies);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    deps.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  if (argv[0] === "codex") {
    const launch = deps.agent.launch(argv.slice(1));
    return await deps.terminal.run({
      args: launch.args,
      command: launch.command,
      cwd: deps.cwd,
      environment: deps.environment,
    });
  }
  if (argv[0] !== "test") {
    throw new Error(`Unknown command: ${argv[0]}. Run voice --help for usage.`);
  }

  const options = parseTestOptions(argv.slice(1));
  const provider = deps.providerFactory(deps.environment);
  const recorder = deps.recorderFactory({
    ...(options.backend === undefined ? {} : { backend: options.backend }),
    ...(options.device === undefined ? {} : { device: options.device }),
  });

  deps.stderr.write(
    `Hosted transcription: recorded audio will be sent to OpenAI using ${provider.model}.\n`,
  );
  deps.stderr.write("Recording... press Enter to stop.\n");
  const session = await recorder.start();

  try {
    await deps.waitForStop();
  } catch (error) {
    await session.cancel();
    throw error;
  }

  deps.stderr.write("Transcribing...\n");
  const audio = await session.stop();
  const transcript = await provider.transcribe(audio, {
    ...(options.language === undefined ? {} : { language: options.language }),
  });
  deps.stdout.write(`${transcript}\n`);
  return 0;
}

interface TestOptions {
  backend?: AudioBackend;
  device?: string;
  language?: string;
}

function parseTestOptions(argv: string[]): TestOptions {
  const result: TestOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (
      option !== "--device" &&
      option !== "--backend" &&
      option !== "--language"
    ) {
      throw new Error(
        `Unknown option: ${option ?? ""}. Run voice --help for usage.`,
      );
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${option} requires a value.`);
    }
    index += 1;
    if (option === "--device") result.device = value;
    if (option === "--language") result.language = value;
    if (option === "--backend") {
      if (!isAudioBackend(value)) {
        throw new Error(
          `Unsupported backend: ${value}. Run voice --help for supported backends.`,
        );
      }
      result.backend = value;
    }
  }
  return result;
}

function isAudioBackend(value: string): value is AudioBackend {
  return ["avfoundation", "dshow", "pulse", "alsa"].includes(value);
}

function createDependencies(
  overrides: Partial<CliDependencies>,
): CliDependencies {
  const stdin = overrides.stdin ?? process.stdin;
  const stderr = overrides.stderr ?? process.stderr;
  const stdout = overrides.stdout ?? process.stdout;
  return {
    agent: overrides.agent ?? new CodexAgent(),
    cwd: overrides.cwd ?? process.cwd(),
    environment: overrides.environment ?? process.env,
    recorderFactory:
      overrides.recorderFactory ?? ((options) => new FfmpegRecorder(options)),
    providerFactory:
      overrides.providerFactory ??
      ((environment) =>
        OpenAITranscriptionProvider.fromEnvironment(environment)),
    stderr,
    stdin,
    stdout,
    terminal: overrides.terminal ?? new NodePtyTerminal(),
    waitForStop:
      overrides.waitForStop ??
      (async () => {
        const prompt = createInterface({
          input: stdin,
          output: process.stderr,
          terminal: stdin.isTTY,
        });
        let stopped = false;
        let onInterrupt: (() => void) | undefined;
        try {
          await new Promise<void>((resolve, reject) => {
            const onLine = (): void => {
              stopped = true;
              resolve();
            };
            const onClose = (): void => {
              if (!stopped)
                reject(new Error("Recording cancelled before completion."));
            };
            onInterrupt = (): void => reject(new Error("Recording cancelled."));
            prompt.once("line", onLine);
            prompt.once("close", onClose);
            process.once("SIGINT", onInterrupt);
          });
        } finally {
          if (onInterrupt !== undefined) process.off("SIGINT", onInterrupt);
          prompt.close();
        }
      }),
  };
}
