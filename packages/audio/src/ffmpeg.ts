import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  AudioRecorder,
  RecordedAudio,
  RecordingSession,
} from "./recorder.js";

const execFileAsync = promisify(execFile);
const SUPPORTED_BACKENDS = ["avfoundation", "dshow", "pulse", "alsa"] as const;

export type AudioBackend = (typeof SUPPORTED_BACKENDS)[number];

export interface FfmpegRecorderOptions {
  backend?: AudioBackend;
  device?: string;
  executable?: string;
  platform?: NodeJS.Platform;
}

export class AudioRecordingError extends Error {
  override name = "AudioRecordingError";
}

export function buildFfmpegInputArgs(
  platform: NodeJS.Platform,
  availableDevices: ReadonlySet<string>,
  options: Pick<FfmpegRecorderOptions, "backend" | "device"> = {},
): string[] {
  const backend = resolveBackend(platform, availableDevices, options.backend);
  const device = options.device;

  switch (backend) {
    case "avfoundation":
      return ["-f", backend, "-i", `:${device ?? "default"}`];
    case "dshow":
      if (device === undefined) {
        throw new AudioRecordingError(
          "Windows microphone capture requires --device <microphone name>. " +
            "List devices with: ffmpeg -list_devices true -f dshow -i dummy",
        );
      }
      return ["-f", backend, "-i", `audio=${device}`];
    case "pulse":
    case "alsa":
      return ["-f", backend, "-i", device ?? "default"];
  }
}

export class FfmpegRecorder implements AudioRecorder {
  readonly #executable: string;
  readonly #platform: NodeJS.Platform;
  readonly #options: Pick<FfmpegRecorderOptions, "backend" | "device">;

  constructor(options: FfmpegRecorderOptions = {}) {
    this.#executable = options.executable ?? "ffmpeg";
    this.#platform = options.platform ?? process.platform;
    this.#options = {
      ...(options.backend === undefined ? {} : { backend: options.backend }),
      ...(options.device === undefined ? {} : { device: options.device }),
    };
  }

  async start(): Promise<RecordingSession> {
    const devices = await inspectFfmpegDevices(this.#executable);
    const inputArgs = buildFfmpegInputArgs(
      this.#platform,
      devices,
      this.#options,
    );
    const directory = await mkdtemp(join(tmpdir(), "coding-agent-voice-"));
    const outputPath = join(directory, "recording.wav");
    const child = spawn(
      this.#executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...inputArgs,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        outputPath,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });

    const result = new Promise<{ code: number | null; error?: Error }>(
      (resolve) => {
        child.once("error", (error) => resolve({ code: null, error }));
        child.once("exit", (code) => resolve({ code }));
      },
    );

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    }).catch(async (error: unknown) => {
      await rm(directory, { force: true, recursive: true });
      const detail = error instanceof Error ? error.message : String(error);
      throw new AudioRecordingError(
        `Could not start FFmpeg (${this.#executable}): ${detail}. Install FFmpeg and ensure it is on PATH.`,
      );
    });

    let finished = false;
    const cleanup = async (): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    };

    return {
      stop: async (): Promise<RecordedAudio> => {
        if (finished) {
          throw new AudioRecordingError(
            "This recording session has already ended.",
          );
        }
        finished = true;
        child.stdin.end("q\n");
        const outcome = await result;
        if (outcome.error !== undefined || outcome.code !== 0) {
          await cleanup();
          const detail =
            (outcome.error?.message ?? stderr.trim()) ||
            "FFmpeg exited unexpectedly.";
          throw new AudioRecordingError(
            `Microphone recording failed: ${detail}`,
          );
        }

        try {
          const data = await readFile(outputPath);
          if (data.byteLength === 0) {
            throw new AudioRecordingError(
              "Microphone recording produced an empty audio file.",
            );
          }
          return { data, filename: "recording.wav", mimeType: "audio/wav" };
        } finally {
          await cleanup();
        }
      },
      cancel: async (): Promise<void> => {
        if (finished) return;
        finished = true;
        child.kill("SIGTERM");
        await result;
        await cleanup();
      },
    };
  }
}

function resolveBackend(
  platform: NodeJS.Platform,
  availableDevices: ReadonlySet<string>,
  requested?: AudioBackend,
): AudioBackend {
  const allowed: readonly AudioBackend[] =
    platform === "darwin"
      ? ["avfoundation"]
      : platform === "win32"
        ? ["dshow"]
        : platform === "linux"
          ? ["pulse", "alsa"]
          : [];

  if (allowed.length === 0) {
    throw new AudioRecordingError(
      `Microphone capture is not supported on platform ${platform}. Supported platforms: macOS, Windows, Linux.`,
    );
  }
  if (requested !== undefined && !allowed.includes(requested)) {
    throw new AudioRecordingError(
      `FFmpeg backend ${requested} is not valid on ${platform}. Expected: ${allowed.join(" or ")}.`,
    );
  }

  const backend =
    requested ?? allowed.find((candidate) => availableDevices.has(candidate));
  if (backend === undefined || !availableDevices.has(backend)) {
    throw new AudioRecordingError(
      `This FFmpeg installation does not provide a supported ${platform} microphone backend (${allowed.join(", ")}).`,
    );
  }
  return backend;
}

async function inspectFfmpegDevices(executable: string): Promise<Set<string>> {
  let output: string;
  try {
    const result = await execFileAsync(executable, [
      "-hide_banner",
      "-devices",
    ]);
    output = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AudioRecordingError(
      `Could not run FFmpeg (${executable}): ${detail}. Install FFmpeg and ensure it is on PATH.`,
    );
  }

  return new Set(
    SUPPORTED_BACKENDS.filter((backend) =>
      new RegExp(`^ .{2} ${backend}\\s`, "m").test(output),
    ),
  );
}
