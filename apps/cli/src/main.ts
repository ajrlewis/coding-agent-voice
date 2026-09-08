#!/usr/bin/env node

import { runCli } from "./cli.js";
import { loadLocalEnvironment } from "./environment.js";

try {
  const environment = await loadLocalEnvironment();
  process.exitCode = await runCli(process.argv.slice(2), { environment });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`voice: ${message}\n`);
  process.exitCode = 1;
}
