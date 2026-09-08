import { chmod, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

if (process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const packageRoot = resolve(dirname(require.resolve("node-pty")), "..");
  const helpers = [
    join(packageRoot, "prebuilds", `darwin-${process.arch}`, "spawn-helper"),
    join(packageRoot, "build", "Release", "spawn-helper"),
  ];

  for (const helper of helpers) {
    try {
      const metadata = await stat(helper);
      await chmod(helper, metadata.mode | 0o111);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}
