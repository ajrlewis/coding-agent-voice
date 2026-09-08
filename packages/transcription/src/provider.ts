export interface TranscriptionAudio {
  data: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface TranscriptionOptions {
  language?: string;
  prompt?: string;
}

export interface TranscriptionProvider {
  transcribe(
    audio: TranscriptionAudio,
    options?: TranscriptionOptions,
  ): Promise<string>;
}

export class TranscriptionError extends Error {
  override name = "TranscriptionError";
}

export class MissingCredentialError extends TranscriptionError {
  override name = "MissingCredentialError";
}
