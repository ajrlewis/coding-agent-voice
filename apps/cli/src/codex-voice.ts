import type {
  AudioRecorder,
  RecordingSession,
} from "@coding-agent-voice/audio";
import type { TerminalSession } from "@coding-agent-voice/terminal";
import type { TranscriptionProvider } from "@coding-agent-voice/transcription";

const F2_SEQUENCE =
  // Terminal key sequences necessarily contain the ESC control byte.
  // eslint-disable-next-line no-control-regex
  /\x1b(?:OQ|\[(?:Q|1(?:;1(?::[123])?)?Q|12(?:;1(?::[123])?)?~))/g;

export type VoiceStatusLevel = "error" | "status";

export interface CodexVoiceControllerOptions {
  providerFactory: () => TranscriptionProvider & { model: string };
  recorderFactory: () => AudioRecorder;
  secrets?: readonly string[];
  status: (message: string, level: VoiceStatusLevel) => void;
}

type VoiceState = "idle" | "recording" | "starting" | "transcribing";

export class CodexVoiceController {
  readonly #options: CodexVoiceControllerOptions;
  #cancelStart = false;
  #closed = false;
  #operation = Promise.resolve();
  #provider: (TranscriptionProvider & { model: string }) | undefined;
  #recording: RecordingSession | undefined;
  #state: VoiceState = "idle";

  constructor(options: CodexVoiceControllerOptions) {
    this.#options = options;
  }

  filterInput(data: string, session: TerminalSession): string {
    return data.replace(F2_SEQUENCE, (sequence) => {
      if (!sequence.includes(":2") && !sequence.includes(":3")) {
        this.#activate(session);
      }
      return "";
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    const recording = this.#recording;
    this.#recording = undefined;
    this.#cancelStart = true;
    this.#closed = true;
    if (recording !== undefined) {
      try {
        await recording.cancel();
      } catch {
        // The owned child has exited, so there is nowhere useful to report this.
      }
    }
  }

  async settled(): Promise<void> {
    await this.#operation;
  }

  #activate(session: TerminalSession): void {
    if (this.#closed) return;
    if (this.#state === "idle") {
      this.#operation = this.#start();
      return;
    }
    if (this.#state === "starting") {
      this.#cancelStart = true;
      this.#status("Recording cancelled.", "status");
      return;
    }
    if (this.#state === "recording") {
      this.#operation = this.#stopAndTranscribe(session);
      return;
    }
    if (this.#state === "transcribing") {
      this.#status("Transcription is already in progress.", "status");
    }
  }

  async #start(): Promise<void> {
    this.#state = "starting";
    this.#cancelStart = false;
    this.#status("Starting microphone…", "status");
    try {
      this.#provider ??= this.#options.providerFactory();
      const recording = await this.#options.recorderFactory().start();
      if (this.#closed || this.#cancelStart) {
        await recording.cancel();
        if (!this.#closed) this.#state = "idle";
        return;
      }
      this.#recording = recording;
      this.#state = "recording";
      this.#status(
        `Recording; press F2 to stop. Audio will be sent to OpenAI using ${this.#provider.model}.`,
        "status",
      );
    } catch (error) {
      if (!this.#closed) {
        this.#state = "idle";
        this.#report(error);
      }
    }
  }

  async #stopAndTranscribe(session: TerminalSession): Promise<void> {
    const recording = this.#recording;
    const provider = this.#provider;
    if (recording === undefined || provider === undefined) return;
    this.#recording = undefined;
    this.#state = "transcribing";
    this.#status("Transcribing…", "status");
    try {
      const audio = await recording.stop();
      if (this.#closed) return;
      const transcript = await provider.transcribe(audio);
      if (this.#closed) return;
      const input = codexComposerInput(transcript);
      if (input === "") {
        this.#status("No speech was transcribed; ready.", "status");
      } else if (session.inject(input)) {
        this.#status(
          "Transcript inserted; review it in Codex and press Enter to submit.",
          "status",
        );
      }
    } catch (error) {
      if (!this.#closed) this.#report(error);
    } finally {
      if (!this.#closed) this.#state = "idle";
    }
  }

  #report(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#status(message, "error");
  }

  #status(message: string, level: VoiceStatusLevel): void {
    for (const secret of this.#options.secrets ?? []) {
      if (secret !== "") message = message.replaceAll(secret, "[redacted]");
    }
    this.#options.status(
      // Keep provider and environment text from controlling the host terminal.
      // eslint-disable-next-line no-control-regex
      message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""),
      level,
    );
  }
}

export function codexComposerInput(transcript: string): string {
  const safe = transcript
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    // Prevent a transcript from injecting terminal control sequences.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  return safe === "" ? "" : `\x1b[200~${safe}\x1b[201~`;
}
