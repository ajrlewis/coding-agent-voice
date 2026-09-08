import assert from "node:assert/strict";
import test from "node:test";

import { OpenAITranscriptionProvider } from "./openai.js";
import { MissingCredentialError, TranscriptionError } from "./provider.js";

const audio = {
  data: new Uint8Array([1, 2, 3]),
  filename: "recording.wav",
  mimeType: "audio/wav",
};

test("requires an environment credential", () => {
  assert.throws(
    () => OpenAITranscriptionProvider.fromEnvironment({}),
    (error: unknown) =>
      error instanceof MissingCredentialError &&
      error.message.includes("OPENAI_API_KEY"),
  );
});

test("sends multipart audio and returns trimmed transcript text", async () => {
  let endpoint: string | URL | Request | undefined;
  let request: RequestInit | undefined;
  const provider = new OpenAITranscriptionProvider({
    apiKey: "test-key",
    fetch: async (input, init) => {
      endpoint = input;
      request = init;
      return new Response(JSON.stringify({ text: "  Run the tests.  " }), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  const transcript = await provider.transcribe(audio, {
    language: "en",
    prompt: "Vitest",
  });

  assert.equal(transcript, "Run the tests.");
  assert.equal(endpoint, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(request?.method, "POST");
  assert.deepEqual(request?.headers, { Authorization: "Bearer test-key" });
  assert.ok(request?.body instanceof FormData);
  const body = request.body as FormData;
  assert.equal(body.get("model"), "gpt-4o-transcribe");
  assert.equal(body.get("language"), "en");
  assert.equal(body.get("prompt"), "Vitest");
  const file = body.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, "recording.wav");
});

test("reports an invalid success response clearly", async () => {
  const provider = new OpenAITranscriptionProvider({
    apiKey: "test-key",
    fetch: async () => new Response("not json"),
  });

  await assert.rejects(
    provider.transcribe(audio),
    (error: unknown) =>
      error instanceof TranscriptionError &&
      error.message.includes("invalid transcription response"),
  );
});

test("returns a bounded provider error without exposing the credential", async () => {
  const credential = "do-not-print-this";
  const provider = new OpenAITranscriptionProvider({
    apiKey: credential,
    fetch: async () =>
      new Response(`invalid audio for ${credential}`, { status: 400 }),
  });

  await assert.rejects(
    provider.transcribe(audio),
    (error: unknown) =>
      error instanceof TranscriptionError &&
      error.message.includes("HTTP 400") &&
      error.message.includes("[redacted]") &&
      !error.message.includes(credential),
  );
});

test("redacts the credential from transport failures", async () => {
  const credential = "do-not-print-this";
  const provider = new OpenAITranscriptionProvider({
    apiKey: credential,
    fetch: async () => {
      throw new Error(`transport rejected ${credential}`);
    },
  });

  await assert.rejects(
    provider.transcribe(audio),
    (error: unknown) =>
      error instanceof TranscriptionError &&
      error.message.includes("[redacted]") &&
      !error.message.includes(credential),
  );
});
