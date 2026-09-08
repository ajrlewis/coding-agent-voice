import assert from "node:assert/strict";
import test from "node:test";

import type {
  AudioRecorder,
  RecordingSession,
} from "@coding-agent-voice/audio";
import type { TerminalSession } from "@coding-agent-voice/terminal";
import type { TranscriptionProvider } from "@coding-agent-voice/transcription";

import {
  CodexVoiceController,
  codexComposerInput,
  type VoiceStatusLevel,
} from "./codex-voice.js";

const F2 = "\x1bOQ";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => (resolve = done)), resolve };
}

function terminal(): TerminalSession & { writes: string[] } {
  const writes: string[] = [];
  return {
    inject: (data) => (writes.push(data), true),
    writes,
  };
}

function setup(
  overrides: {
    provider?: TranscriptionProvider & { model: string };
    recorder?: AudioRecorder;
    secret?: string;
  } = {},
): {
  controller: CodexVoiceController;
  events: string[];
  statuses: Array<[string, VoiceStatusLevel]>;
} {
  const events: string[] = [];
  const statuses: Array<[string, VoiceStatusLevel]> = [];
  const recording: RecordingSession = {
    cancel: async () => {
      events.push("cancel");
    },
    stop: async () => {
      events.push("stop");
      return {
        data: new Uint8Array([1]),
        filename: "recording.wav",
        mimeType: "audio/wav",
      };
    },
  };
  const recorder: AudioRecorder = overrides.recorder ?? {
    start: async () => {
      events.push("start");
      return recording;
    },
  };
  const provider = overrides.provider ?? {
    model: "test-model",
    transcribe: async () => {
      events.push("transcribe");
      return "Run the tests.";
    },
  };
  return {
    controller: new CodexVoiceController({
      providerFactory: () => provider,
      recorderFactory: () => recorder,
      secrets: [overrides.secret ?? ""],
      status: (message, level) => statuses.push([message, level]),
    }),
    events,
    statuses,
  };
}

test("F2 starts, stops, transcribes, and inserts into the same session", async () => {
  const { controller, events, statuses } = setup();
  const session = terminal();

  assert.equal(
    controller.filterInput(`before${F2}after`, session),
    "beforeafter",
  );
  await controller.settled();
  assert.equal(controller.filterInput(F2, session), "");
  await controller.settled();

  assert.deepEqual(events, ["start", "stop", "transcribe"]);
  assert.deepEqual(session.writes, ["\x1b[200~Run the tests.\x1b[201~"]);
  assert.match(statuses.at(-1)?.[0] ?? "", /inserted.*press Enter/i);
});

test("ordinary keyboard input and F2 release events continue correctly", () => {
  const { controller } = setup();
  const session = terminal();

  assert.equal(controller.filterInput("hello\r", session), "hello\r");
  assert.equal(controller.filterInput("\x1b[1;1:3Q", session), "");
});

test("a repeated activation while starting cancels the recording", async () => {
  const started = deferred<RecordingSession>();
  let cancelled = 0;
  const { controller } = setup({
    recorder: { start: async () => await started.promise },
  });
  const session = terminal();

  controller.filterInput(F2, session);
  controller.filterInput(F2, session);
  started.resolve({
    cancel: async () => {
      cancelled += 1;
    },
    stop: async () => {
      throw new Error("must not stop");
    },
  });
  await controller.settled();

  assert.equal(cancelled, 1);
  assert.deepEqual(session.writes, []);
});

test("transcription failures are reported without exposing credentials", async () => {
  const secret = "super-secret-key";
  const { controller, statuses } = setup({
    provider: {
      model: "test-model",
      transcribe: async () => {
        throw new Error(`request failed with ${secret}`);
      },
    },
    secret,
  });
  const session = terminal();

  controller.filterInput(F2, session);
  await controller.settled();
  controller.filterInput(F2, session);
  await controller.settled();

  assert.deepEqual(session.writes, []);
  assert.equal(statuses.at(-1)?.[1], "error");
  assert.doesNotMatch(statuses.flat().join("\n"), new RegExp(secret));
  assert.match(statuses.at(-1)?.[0] ?? "", /\[redacted\]/);
});

test("child exit cancels an active recording", async () => {
  let cancelled = 0;
  const { controller } = setup({
    recorder: {
      start: async () => ({
        cancel: async () => {
          cancelled += 1;
        },
        stop: async () => {
          throw new Error("must not stop");
        },
      }),
    },
  });

  controller.filterInput(F2, terminal());
  await controller.settled();
  await controller.close();

  assert.equal(cancelled, 1);
});

test("child exit during microphone startup cancels the late recording", async () => {
  const started = deferred<RecordingSession>();
  let cancelled = 0;
  const { controller } = setup({
    recorder: { start: async () => await started.promise },
  });

  controller.filterInput(F2, terminal());
  await controller.close();
  started.resolve({
    cancel: async () => {
      cancelled += 1;
    },
    stop: async () => {
      throw new Error("must not stop");
    },
  });
  await controller.settled();

  assert.equal(cancelled, 1);
});

test("child exit during stop or transcription prevents late injection", async () => {
  const stopped = deferred<{
    data: Uint8Array;
    filename: string;
    mimeType: string;
  }>();
  const transcribed = deferred<string>();
  let transcribeCalls = 0;
  const { controller } = setup({
    recorder: {
      start: async () => ({
        cancel: async () => undefined,
        stop: async () => await stopped.promise,
      }),
    },
    provider: {
      model: "test-model",
      transcribe: async () => {
        transcribeCalls += 1;
        return await transcribed.promise;
      },
    },
  });
  const session = terminal();

  controller.filterInput(F2, session);
  await controller.settled();
  controller.filterInput(F2, session);
  await controller.close();
  stopped.resolve({
    data: new Uint8Array([1]),
    filename: "recording.wav",
    mimeType: "audio/wav",
  });
  await controller.settled();
  assert.equal(transcribeCalls, 0);
  assert.deepEqual(session.writes, []);

  const second = setup({
    provider: {
      model: "test-model",
      transcribe: async () => await transcribed.promise,
    },
  });
  const secondSession = terminal();
  second.controller.filterInput(F2, secondSession);
  await second.controller.settled();
  second.controller.filterInput(F2, secondSession);
  await new Promise((resolve) => setImmediate(resolve));
  await second.controller.close();
  transcribed.resolve("Do not inject this.");
  await second.controller.settled();
  assert.deepEqual(secondSession.writes, []);
});

test("composer input removes terminal controls and never submits", () => {
  assert.equal(
    codexComposerInput("  first\r\nsecond\x1b[201~\u0000  "),
    "\x1b[200~first\nsecond[201~\x1b[201~",
  );
  assert.equal(codexComposerInput("\x00\x1b"), "");
});
