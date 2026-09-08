import {
  MissingCredentialError,
  TranscriptionError,
  type TranscriptionAudio,
  type TranscriptionOptions,
  type TranscriptionProvider,
} from "./provider.js";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

export interface OpenAITranscriptionProviderOptions {
  apiKey: string;
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
  model?: string;
}

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly model: string;

  constructor(options: OpenAITranscriptionProviderOptions) {
    if (options.apiKey.trim() === "") {
      throw new MissingCredentialError(
        "OPENAI_API_KEY is required for hosted transcription. Set it in your environment; do not save it in this repository.",
      );
    }
    this.#apiKey = options.apiKey;
    this.#endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.model = options.model ?? DEFAULT_OPENAI_TRANSCRIPTION_MODEL;
  }

  static fromEnvironment(
    environment: NodeJS.ProcessEnv,
    overrides: Omit<
      OpenAITranscriptionProviderOptions,
      "apiKey" | "model"
    > = {},
  ): OpenAITranscriptionProvider {
    return new OpenAITranscriptionProvider({
      apiKey: environment.OPENAI_API_KEY ?? "",
      model:
        environment.OPENAI_TRANSCRIPTION_MODEL ??
        DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
      ...overrides,
    });
  }

  async transcribe(
    audio: TranscriptionAudio,
    options: TranscriptionOptions = {},
  ): Promise<string> {
    const form = new FormData();
    const bytes = Uint8Array.from(audio.data);
    form.append(
      "file",
      new Blob([bytes], { type: audio.mimeType }),
      audio.filename,
    );
    form.append("model", this.model);
    if (options.language !== undefined)
      form.append("language", options.language);
    if (options.prompt !== undefined) form.append("prompt", options.prompt);

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        body: form,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new TranscriptionError(
        `OpenAI transcription request failed: ${detail}`,
      );
    }

    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 500);
      throw new TranscriptionError(
        `OpenAI transcription failed with HTTP ${response.status}${detail === "" ? "." : `: ${detail}`}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TranscriptionError(
        "OpenAI returned an invalid transcription response.",
      );
    }
    if (!isTranscriptionResponse(payload) || payload.text.trim() === "") {
      throw new TranscriptionError(
        "OpenAI returned a response without transcript text.",
      );
    }
    return payload.text.trim();
  }
}

function isTranscriptionResponse(value: unknown): value is { text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  );
}
