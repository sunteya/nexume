import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const packageRoot = join(projectRoot, "node_modules", "electrobun");
const executableName = process.platform === "win32" ? "electrobun.exe" : "electrobun";
const cliPath = join(packageRoot, "bin", executableName);
const cachedCliPath = join(packageRoot, ".cache", executableName);
const args = process.argv.slice(2);

function run(command: string[], allowFailure = false): void {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: projectRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  if (!allowFailure && result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

if (!existsSync(cliPath)) {
  // The package wrapper downloads the platform CLI on its first invocation.
  // Electrobun 1.18.1 may report success even when macOS kills that first run.
  run(["bunx", "electrobun", "--version"], true);
}

if (!existsSync(cliPath)) {
  throw new Error("Electrobun CLI download did not produce an executable.");
}

if (process.platform === "darwin") {
  // Electrobun 1.18.1 ships a cross-machine ad-hoc signature rejected by
  // macOS 26. Strip provenance and apply a valid local ad-hoc signature.
  for (const path of [cliPath, cachedCliPath]) {
    if (!existsSync(path)) {
      continue;
    }

    run(["xattr", "-c", path]);
    run(["codesign", "--force", "--sign", "-", path]);
  }
}

const cli = Bun.spawn({
  cmd: [cliPath, ...args],
  cwd: projectRoot,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await cli.exited);
