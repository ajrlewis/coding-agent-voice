import type { AgentLaunch, CodingAgent } from "./agent.js";

export interface CodexAgentOptions {
  executable?: string;
}

export class CodexAgent implements CodingAgent {
  readonly #executable: string;

  constructor(options: CodexAgentOptions = {}) {
    this.#executable = options.executable ?? "codex";
  }

  launch(userArgs: readonly string[]): AgentLaunch {
    return {
      command: this.#executable,
      args: [...userArgs],
    };
  }
}
