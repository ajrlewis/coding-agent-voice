import assert from "node:assert/strict";
import test from "node:test";

import {
  AudioRecordingError,
  FfmpegRecorder,
  buildFfmpegInputArgs,
} from "./ffmpeg.js";

test("uses the default AVFoundation microphone on macOS", () => {
  assert.deepEqual(buildFfmpegInputArgs("darwin", new Set(["avfoundation"])), [
    "-f",
    "avfoundation",
    "-i",
    ":default",
  ]);
});

test("uses an explicitly named DirectShow microphone on Windows", () => {
  assert.deepEqual(
    buildFfmpegInputArgs("win32", new Set(["dshow"]), {
      device: "USB Microphone",
    }),
    ["-f", "dshow", "-i", "audio=USB Microphone"],
  );
});

test("explains how to select a Windows microphone", () => {
  assert.throws(
    () => buildFfmpegInputArgs("win32", new Set(["dshow"])),
    (error: unknown) =>
      error instanceof AudioRecordingError &&
      error.message.includes("--device <microphone name>"),
  );
});

test("prefers PulseAudio and falls back to ALSA on Linux", () => {
  assert.deepEqual(buildFfmpegInputArgs("linux", new Set(["pulse", "alsa"])), [
    "-f",
    "pulse",
    "-i",
    "default",
  ]);
  assert.deepEqual(buildFfmpegInputArgs("linux", new Set(["alsa"])), [
    "-f",
    "alsa",
    "-i",
    "default",
  ]);
});

test("rejects platform-incompatible backends", () => {
  assert.throws(
    () =>
      buildFfmpegInputArgs("darwin", new Set(["avfoundation"]), {
        backend: "alsa",
      }),
    /not valid on darwin/,
  );
});

test("reports a missing FFmpeg executable clearly", async () => {
  const recorder = new FfmpegRecorder({
    executable: "coding-agent-voice-missing-ffmpeg",
  });

  await assert.rejects(
    recorder.start(),
    /Install FFmpeg and ensure it is on PATH/,
  );
});
