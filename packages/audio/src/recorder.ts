export interface RecordedAudio {
  data: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface RecordingSession {
  stop(): Promise<RecordedAudio>;
  cancel(): Promise<void>;
}

export interface AudioRecorder {
  start(): Promise<RecordingSession>;
}
