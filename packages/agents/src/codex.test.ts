import assert from "node:assert/strict";
import test from "node:test";

import { CodexAgent } from "./codex.js";

test("uses the Codex executable and forwards user arguments unchanged", () => {
  const agent = new CodexAgent({ executable: "/tools/codex" });
  const userArgs = ["--resume", "session with spaces", "--search"];

  assert.deepEqual(agent.launch(userArgs), {
    command: "/tools/codex",
    args: userArgs,
  });
});

test("defaults to resolving codex from PATH", () => {
  assert.equal(new CodexAgent().launch([]).command, "codex");
});
