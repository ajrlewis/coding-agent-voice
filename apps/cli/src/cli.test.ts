import assert from "node:assert/strict";
import test from "node:test";

import type {
  AudioRecorder,
  RecordingSession,
} from "@coding-agent-voice/audio";
import type { TerminalRunRequest } from "@coding-agent-voice/terminal";
import type { TranscriptionProvider } from "@coding-agent-voice/transcription";

import { runCli, type CliDependencies } from "./cli.js";

function output(): {
  readonly chunks: string[];
  write: (chunk: string) => boolean;
} {
  const chunks: string[] = [];
  return { chunks, write: (chunk) => (chunks.push(chunk), true) };
}

test("voice test records, transcribes, and prints only the transcript to stdout", async () => {
  const events: string[] = [];
  const stdout = output();
  const stderr = output();
  let recorderOptions: Parameters<CliDependencies["recorderFactory"]>[0];
  let transcriptionLanguage: string | undefined;
  const session: RecordingSession = {
    stop: async () => {
      events.push("stop");
      return {
        data: new Uint8Array([1, 2, 3]),
        filename: "recording.wav",
        mimeType: "audio/wav",
      };
    },
    cancel: async () => undefined,
  };
  const recorder: AudioRecorder = {
    start: async () => {
      events.push("start");
      return session;
    },
  };
  const provider: TranscriptionProvider & { model: string } = {
    model: "test-model",
    transcribe: async (audio, options) => {
      events.push("transcribe");
      assert.deepEqual(audio.data, new Uint8Array([1, 2, 3]));
      transcriptionLanguage = options?.language;
      return "Refactor the authentication middleware.";
    },
  };

  const code = await runCli(
    ["test", "--backend", "avfoundation", "--device", "2", "--language", "en"],
    {
      environment: { OPENAI_API_KEY: "not-used-by-fake" },
      recorderFactory: (options) => {
        recorderOptions = options;
        return recorder;
      },
      providerFactory: () => provider,
      stderr,
      stdout,
      waitForStop: async () => {
        events.push("enter");
      },
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(events, ["start", "enter", "stop", "transcribe"]);
  assert.deepEqual(recorderOptions!, {
    backend: "avfoundation",
    device: "2",
  });
  assert.equal(transcriptionLanguage, "en");
  assert.deepEqual(stdout.chunks, [
    "Refactor the authentication middleware.\n",
  ]);
  assert.match(stderr.chunks.join(""), /audio will be sent to OpenAI/);
  assert.doesNotMatch(
    `${stdout.chunks.join("")}\n${stderr.chunks.join("")}`,
    /not-used-by-fake/,
  );
});

test("missing credentials fail before microphone capture", async () => {
  let recorderCreated = false;
  const dependencies: Partial<CliDependencies> = {
    environment: {},
    recorderFactory: () => {
      recorderCreated = true;
      throw new Error("must not run");
    },
  };

  await assert.rejects(runCli(["test"], dependencies), /OPENAI_API_KEY/);
  assert.equal(recorderCreated, false);
});

test("voice codex forwards arguments and the current directory", async () => {
  const stdout = output();
  const stderr = output();
  let request: TerminalRunRequest | undefined;

  const code = await runCli(["codex", "--resume", "session with spaces"], {
    agent: {
      launch: (args) => ({ command: "/tools/codex", args: [...args] }),
    },
    cwd: "/work/current-project",
    environment: { PATH: "/tools", SECRET_VALUE: "must-not-be-printed" },
    stderr,
    stdout,
    terminal: {
      run: async (runRequest) => {
        request = runRequest;
        return 23;
      },
    },
  });

  assert.equal(code, 23);
  assert.deepEqual(request, {
    args: ["--resume", "session with spaces"],
    command: "/tools/codex",
    cwd: "/work/current-project",
    environment: { PATH: "/tools", SECRET_VALUE: "must-not-be-printed" },
  });
  assert.equal(stdout.chunks.join(""), "");
  assert.equal(stderr.chunks.join(""), "");
});

test("cancels the recording when waiting for input fails", async () => {
  let cancelled = false;
  const recorder: AudioRecorder = {
    start: async () => ({
      stop: async () => {
        throw new Error("must not stop");
      },
      cancel: async () => {
        cancelled = true;
      },
    }),
  };

  await assert.rejects(
    runCli(["test"], {
      environment: { OPENAI_API_KEY: "not-used-by-fake" },
      recorderFactory: () => recorder,
      providerFactory: () => ({
        model: "test-model",
        transcribe: async () => "unused",
      }),
      waitForStop: async () => {
        throw new Error("Recording cancelled.");
      },
    }),
    /Recording cancelled/,
  );
  assert.equal(cancelled, true);
});

test("rejects unsupported commands and options", async () => {
  await assert.rejects(runCli(["claude"]), /Unknown command/);
  await assert.rejects(
    runCli(["test", "--backend", "coreaudio"]),
    /Unsupported backend/,
  );
});
