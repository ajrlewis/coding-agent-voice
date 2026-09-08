import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, extname, isAbsolute, resolve } from "node:path";

import type { IPtyForkOptions, IPty } from "node-pty";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;

export interface Disposable {
  dispose(): void;
}

export interface PtyProcess {
  kill(signal?: string): void;
  onData(listener: (data: string) => void): Disposable;
  onExit(
    listener: (event: { exitCode: number; signal?: number }) => void,
  ): Disposable;
  resize(columns: number, rows: number): void;
  write(data: string): void;
}

export interface PtyFactory {
  spawn(
    command: string,
    args: string[],
    options: {
      cols: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
      name: string;
      rows: number;
    },
  ): PtyProcess;
}

export interface TerminalHost {
  getSize(): { columns: number; rows: number };
  isInputPaused(): boolean;
  isInputRaw(): boolean;
  isInteractive(): boolean;
  offInput(listener: (data: Buffer | string) => void): void;
  offResize(listener: () => void): void;
  offSignal(signal: NodeJS.Signals, listener: () => void): void;
  onInput(listener: (data: Buffer | string) => void): void;
  onResize(listener: () => void): void;
  onSignal(signal: NodeJS.Signals, listener: () => void): void;
  pauseInput(): void;
  resumeInput(): void;
  setInputRaw(enabled: boolean): void;
  writeOutput(data: string): void;
}

export interface TerminalRunRequest {
  args: string[];
  command: string;
  cwd: string;
  environment: NodeJS.ProcessEnv;
}

export interface TerminalRunner {
  run(request: TerminalRunRequest): Promise<number>;
}

export interface NodePtyTerminalOptions {
  executableLocator?: (
    command: string,
    cwd: string,
    environment: NodeJS.ProcessEnv,
  ) => Promise<string | undefined>;
  host?: TerminalHost;
  loadPty?: () => Promise<PtyFactory>;
}

export class TerminalProcessError extends Error {
  override name = "TerminalProcessError";
}

export class NodePtyTerminal implements TerminalRunner {
  readonly #executableLocator: NonNullable<
    NodePtyTerminalOptions["executableLocator"]
  >;
  readonly #host: TerminalHost;
  readonly #loadPty: NonNullable<NodePtyTerminalOptions["loadPty"]>;

  constructor(options: NodePtyTerminalOptions = {}) {
    this.#executableLocator = options.executableLocator ?? findExecutable;
    this.#host = options.host ?? new ProcessTerminalHost();
    this.#loadPty = options.loadPty ?? loadNodePty;
  }

  async run(request: TerminalRunRequest): Promise<number> {
    if (!this.#host.isInteractive()) {
      throw new TerminalProcessError(
        "An interactive terminal is required to start Codex. Run voice codex directly in a terminal.",
      );
    }

    const executable = await this.#executableLocator(
      request.command,
      request.cwd,
      request.environment,
    );
    if (executable === undefined) {
      throw new TerminalProcessError(
        `Could not find ${request.command}. Install Codex and ensure ${request.command} is on PATH.`,
      );
    }

    let factory: PtyFactory;
    try {
      factory = await this.#loadPty();
    } catch {
      throw new TerminalProcessError(
        "The node-pty runtime is unavailable. Reinstall dependencies and ensure native dependencies for this platform are available.",
      );
    }
    const size = this.#host.getSize();
    let child: PtyProcess;
    try {
      child = factory.spawn(executable, request.args, {
        cols: size.columns,
        cwd: request.cwd,
        env: request.environment,
        name: "xterm-256color",
        rows: size.rows,
      });
    } catch {
      throw new TerminalProcessError(
        `Could not start ${request.command}. Reinstall dependencies and verify Codex runs directly.`,
      );
    }

    return await this.#proxy(child);
  }

  async #proxy(child: PtyProcess): Promise<number> {
    const wasPaused = this.#host.isInputPaused();
    const wasRaw = this.#host.isInputRaw();
    let finished = false;
    const onInput = (data: Buffer | string): void => {
      child.write(typeof data === "string" ? data : data.toString("utf8"));
    };
    const onResize = (): void => {
      if (finished) return;
      const size = this.#host.getSize();
      try {
        child.resize(size.columns, size.rows);
      } catch {
        // The child may have exited between the event and this call.
      }
    };
    const signalListeners = FORWARDED_SIGNALS.map((signal) => {
      const listener = (): void => {
        if (!finished) {
          try {
            child.kill(signal);
          } catch {
            // The child may have exited between the signal and this call.
          }
        }
      };
      return { listener, signal };
    });
    let exitSubscription: Disposable | undefined;
    const exit = new Promise<number>((resolveExit) => {
      exitSubscription = child.onExit(({ exitCode }) => resolveExit(exitCode));
    });
    const dataSubscription = child.onData((data) => {
      this.#host.writeOutput(data);
    });

    this.#host.setInputRaw(true);
    this.#host.onInput(onInput);
    this.#host.onResize(onResize);
    for (const { listener, signal } of signalListeners) {
      this.#host.onSignal(signal, listener);
    }
    this.#host.resumeInput();

    try {
      return await exit;
    } finally {
      finished = true;
      dataSubscription.dispose();
      exitSubscription?.dispose();
      this.#host.offInput(onInput);
      this.#host.offResize(onResize);
      for (const { listener, signal } of signalListeners) {
        this.#host.offSignal(signal, listener);
      }
      this.#host.setInputRaw(wasRaw);
      if (wasPaused) this.#host.pauseInput();
    }
  }
}

export async function findExecutable(
  command: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const hasPath = command.includes("/") || command.includes("\\");
  const pathDelimiter = platform === "win32" ? ";" : delimiter;
  const directories = hasPath
    ? [isAbsolute(command) ? "" : cwd]
    : (environment.PATH ?? "").split(pathDelimiter);
  const extensions =
    platform === "win32" && extname(command) === ""
      ? (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];

  for (const directory of directories) {
    const base = directory === "" ? command : resolve(directory, command);
    for (const extension of extensions) {
      const candidate = `${base}${extension}`;
      try {
        await access(
          candidate,
          platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        return candidate;
      } catch {
        // Continue through PATH without exposing its contents in errors.
      }
    }
  }
  return undefined;
}

async function loadNodePty(): Promise<PtyFactory> {
  const nodePty = await import("node-pty");
  return {
    spawn: (command, args, options) =>
      nodePty.spawn(command, args, options as IPtyForkOptions) as IPty,
  };
}

class ProcessTerminalHost implements TerminalHost {
  getSize(): { columns: number; rows: number } {
    return {
      columns: Math.max(process.stdout.columns ?? 80, 1),
      rows: Math.max(process.stdout.rows ?? 24, 1),
    };
  }

  isInputPaused(): boolean {
    return process.stdin.isPaused();
  }

  isInputRaw(): boolean {
    return process.stdin.isRaw ?? false;
  }

  isInteractive(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
  }

  offInput(listener: (data: Buffer | string) => void): void {
    process.stdin.off("data", listener);
  }

  offResize(listener: () => void): void {
    process.stdout.off("resize", listener);
  }

  offSignal(signal: NodeJS.Signals, listener: () => void): void {
    process.off(signal, listener);
  }

  onInput(listener: (data: Buffer | string) => void): void {
    process.stdin.on("data", listener);
  }

  onResize(listener: () => void): void {
    process.stdout.on("resize", listener);
  }

  onSignal(signal: NodeJS.Signals, listener: () => void): void {
    process.on(signal, listener);
  }

  pauseInput(): void {
    process.stdin.pause();
  }

  resumeInput(): void {
    process.stdin.resume();
  }

  setInputRaw(enabled: boolean): void {
    process.stdin.setRawMode(enabled);
  }

  writeOutput(data: string): void {
    process.stdout.write(data);
  }
}
