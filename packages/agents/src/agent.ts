export interface AgentLaunch {
  command: string;
  args: string[];
}

export interface CodingAgent {
  launch(userArgs: readonly string[]): AgentLaunch;
}
