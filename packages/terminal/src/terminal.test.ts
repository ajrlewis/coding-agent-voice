import assert from "node:assert/strict";
import test from "node:test";

import {
  NodePtyTerminal,
  type Disposable,
  type PtyFactory,
  type PtyProcess,
  type TerminalHost,
} from "./terminal.js";

class FakePty implements PtyProcess {
  readonly kills: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  readonly writes: string[] = [];
  dataListener: ((data: string) => void) | undefined;
  exitListener:
    ((event: { exitCode: number; signal?: number }) => void) | undefined;
  disposedData = false;
  disposedExit = false;

  kill(signal?: string): void {
    this.kills.push(signal ?? "SIGTERM");
  }

  onData(listener: (data: string) => void): Disposable {
    this.dataListener = listener;
    return { dispose: () => (this.disposedData = true) };
  }

  onExit(
    listener: (event: { exitCode: number; signal?: number }) => void,
  ): Disposable {
    this.exitListener = listener;
    return { dispose: () => (this.disposedExit = true) };
  }

  resize(columns: number, rows: number): void {
    this.resizes.push([columns, rows]);
  }

  write(data: string): void {
    this.writes.push(data);
  }
}

class FakeHost implements TerminalHost {
  readonly output: string[] = [];
  readonly rawChanges: boolean[] = [];
  inputListener: ((data: Buffer | string) => void) | undefined;
  resizeListener: (() => void) | undefined;
  size = { columns: 100, rows: 40 };
  paused = true;
  raw = false;
  signals = new Map<NodeJS.Signals, () => void>();

  getSize(): { columns: number; rows: number } {
    return this.size;
  }

  isInputRaw(): boolean {
    return this.raw;
  }

  isInteractive(): boolean {
    return true;
  }

  offInput(listener: (data: Buffer | string) => void): void {
    if (this.inputListener === listener) this.inputListener = undefined;
  }

  offResize(listener: () => void): void {
    if (this.resizeListener === listener) this.resizeListener = undefined;
  }

  offSignal(signal: NodeJS.Signals, listener: () => void): void {
    if (this.signals.get(signal) === listener) this.signals.delete(signal);
  }

  onInput(listener: (data: Buffer | string) => void): void {
    this.inputListener = listener;
  }

  onResize(listener: () => void): void {
    this.resizeListener = listener;
  }

  onSignal(signal: NodeJS.Signals, listener: () => void): void {
    this.signals.set(signal, listener);
  }

  pauseInput(): void {
    this.paused = true;
  }

  resumeInput(): void {
    this.paused = false;
  }

  setInputRaw(enabled: boolean): void {
    this.rawChanges.push(enabled);
    this.raw = enabled;
  }

  writeOutput(data: string): void {
    this.output.push(data);
  }
}

test("spawns in the requested directory and proxies terminal lifecycle", async () => {
  const child = new FakePty();
  const host = new FakeHost();
  host.paused = false;
  let spawnCall: Parameters<PtyFactory["spawn"]> | undefined;
  let notifySpawned!: () => void;
  const spawned = new Promise<void>((resolve) => (notifySpawned = resolve));
  const terminal = new NodePtyTerminal({
    executableLocator: async () => "/usr/local/bin/codex",
    host,
    loadPty: async () => ({
      spawn: (...parameters) => {
        spawnCall = parameters;
        notifySpawned();
        return child;
      },
    }),
  });

  const result = terminal.run({
    args: ["--resume", "session with spaces"],
    command: "codex",
    cwd: "/work/project",
    environment: { PATH: "/usr/local/bin" },
  });
  await spawned;

  assert.deepEqual(spawnCall, [
    "/usr/local/bin/codex",
    ["--resume", "session with spaces"],
    {
      cols: 100,
      cwd: "/work/project",
      env: { PATH: "/usr/local/bin" },
      name: "xterm-256color",
      rows: 40,
    },
  ]);
  host.inputListener?.(Buffer.from("hello\r"));
  child.dataListener?.("agent output");
  host.size = { columns: 120, rows: 50 };
  host.resizeListener?.();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const) {
    host.signals.get(signal)?.();
  }

  assert.deepEqual(child.writes, ["hello\r"]);
  assert.deepEqual(host.output, ["agent output"]);
  assert.deepEqual(child.resizes, [[120, 50]]);
  assert.deepEqual(child.kills, ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]);

  child.exitListener?.({ exitCode: 7 });
  assert.equal(await result, 7);
  assert.deepEqual(host.rawChanges, [true, false]);
  assert.equal(host.paused, true);
  assert.equal(host.inputListener, undefined);
  assert.equal(host.resizeListener, undefined);
  assert.equal(host.signals.size, 0);
  assert.equal(child.disposedData, true);
  assert.equal(child.disposedExit, true);
});

test("filters host input and exposes active-session injection", async () => {
  const child = new FakePty();
  const host = new FakeHost();
  let notifySpawned!: () => void;
  const spawned = new Promise<void>((resolve) => (notifySpawned = resolve));
  const terminal = new NodePtyTerminal({
    executableLocator: async () => "/usr/local/bin/codex",
    host,
    loadPty: async () => ({
      spawn: () => {
        notifySpawned();
        return child;
      },
    }),
  });
  let inject: ((data: string) => boolean) | undefined;

  const result = terminal.run({
    args: [],
    command: "codex",
    cwd: "/work/project",
    environment: {},
    inputFilter: (data, session) => {
      inject = session.inject;
      return data.replace("<voice>", "");
    },
  });
  await spawned;

  host.inputListener?.("ordinary<voice>input");
  assert.equal(inject?.("transcript"), true);
  assert.deepEqual(child.writes, ["ordinaryinput", "transcript"]);

  child.exitListener?.({ exitCode: 0 });
  assert.equal(await result, 0);
  assert.equal(inject?.("too late"), false);
  assert.deepEqual(child.writes, ["ordinaryinput", "transcript"]);
});

test("fails before loading the PTY when the executable is unavailable", async () => {
  let loaded = false;
  const terminal = new NodePtyTerminal({
    executableLocator: async () => undefined,
    host: new FakeHost(),
    loadPty: async () => {
      loaded = true;
      throw new Error("must not load");
    },
  });

  await assert.rejects(
    terminal.run({
      args: [],
      command: "codex",
      cwd: "/work/project",
      environment: {},
    }),
    /Install Codex.*PATH/,
  );
  assert.equal(loaded, false);
});

test("reports unavailable PTY runtime dependencies actionably", async () => {
  const terminal = new NodePtyTerminal({
    executableLocator: async () => "/usr/local/bin/codex",
    host: new FakeHost(),
    loadPty: async () => {
      throw new Error("native binding unavailable");
    },
  });

  await assert.rejects(
    terminal.run({
      args: [],
      command: "codex",
      cwd: "/work/project",
      environment: {},
    }),
    /node-pty runtime is unavailable.*Reinstall dependencies/,
  );
});

test("requires an interactive terminal", async () => {
  const host = new FakeHost();
  host.isInteractive = () => false;
  const terminal = new NodePtyTerminal({ host });

  await assert.rejects(
    terminal.run({
      args: [],
      command: "codex",
      cwd: "/work/project",
      environment: {},
    }),
    /interactive terminal is required/,
  );
});
