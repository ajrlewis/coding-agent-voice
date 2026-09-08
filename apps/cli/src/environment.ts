import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

const TRANSCRIPTION_VARIABLES = [
  "OPENAI_API_KEY",
  "OPENAI_TRANSCRIPTION_MODEL",
] as const;

export async function loadLocalEnvironment(
  directory = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const path = join(directory, ".env.local");
  let contents: string;

  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return environment;
    throw new Error(`Could not read ${path}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  let parsed: NodeJS.Dict<string>;
  try {
    parsed = parseEnv(contents);
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  for (const name of TRANSCRIPTION_VARIABLES) {
    if (environment[name] === undefined && parsed[name] !== undefined) {
      environment[name] = parsed[name];
    }
  }
  return environment;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
