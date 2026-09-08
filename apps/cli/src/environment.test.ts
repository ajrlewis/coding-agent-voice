import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadLocalEnvironment } from "./environment.js";

test("loads supported transcription settings from .env.local", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "voice-environment-test-"));
  context.after(async () => rm(directory, { force: true, recursive: true }));
  await writeFile(
    join(directory, ".env.local"),
    [
      "OPENAI_API_KEY=local-key",
      "OPENAI_TRANSCRIPTION_MODEL=local-model",
      "UNRELATED_SETTING=ignored",
    ].join("\n"),
  );
  const environment: NodeJS.ProcessEnv = {};

  await loadLocalEnvironment(directory, environment);

  assert.deepEqual(environment, {
    OPENAI_API_KEY: "local-key",
    OPENAI_TRANSCRIPTION_MODEL: "local-model",
  });
});

test("keeps explicitly exported environment settings", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "voice-environment-test-"));
  context.after(async () => rm(directory, { force: true, recursive: true }));
  await writeFile(
    join(directory, ".env.local"),
    "OPENAI_API_KEY=local-key\nOPENAI_TRANSCRIPTION_MODEL=local-model\n",
  );
  const environment = {
    OPENAI_API_KEY: "shell-key",
    OPENAI_TRANSCRIPTION_MODEL: "shell-model",
  };

  await loadLocalEnvironment(directory, environment);

  assert.deepEqual(environment, {
    OPENAI_API_KEY: "shell-key",
    OPENAI_TRANSCRIPTION_MODEL: "shell-model",
  });
});

test("does nothing when .env.local does not exist", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "voice-environment-test-"));
  context.after(async () => rm(directory, { force: true, recursive: true }));
  const environment = { EXISTING_SETTING: "preserved" };

  const result = await loadLocalEnvironment(directory, environment);

  assert.equal(result, environment);
  assert.deepEqual(environment, { EXISTING_SETTING: "preserved" });
});
