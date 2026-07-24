import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

declare const __NEXUME_APP_NAME__: string;
declare const __NEXUME_APP_VERSION__: string;
declare const __NEXUME_PAYLOAD_NAME__: string;
declare const __NEXUME_PAYLOAD_SHA256__: string;

const lockTimeoutMs = 30_000;
const staleLockMs = 120_000;

function getCacheRoot(): string {
  const parent = process.env.LOCALAPPDATA ?? process.env.TEMP;

  if (!parent) {
    throw new Error("Neither LOCALAPPDATA nor TEMP is available.");
  }

  return join(parent, __NEXUME_APP_NAME__, "runtime");
}

function getLogRoot(): string {
  return join(
    process.env.LOCALAPPDATA ?? process.env.TEMP ?? ".",
    __NEXUME_APP_NAME__,
  );
}

function isRuntimeReady(runtimeRoot: string, launcherPath: string): boolean {
  const markerPath = join(runtimeRoot, ".ready");

  if (!existsSync(markerPath) || !existsSync(launcherPath)) {
    return false;
  }

  return readFileSync(markerPath, "utf8").trim() === __NEXUME_PAYLOAD_SHA256__;
}

async function acquireLock(lockPath: string): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < lockTimeoutMs) {
    try {
      mkdirSync(lockPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== "EEXIST") {
        throw error;
      }

      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleLockMs) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }

      await Bun.sleep(100);
    }
  }

  throw new Error("Timed out while waiting for the runtime cache lock.");
}

async function ensureRuntime(
  runtimeRoot: string,
  launcherPath: string,
): Promise<void> {
  if (isRuntimeReady(runtimeRoot, launcherPath)) {
    return;
  }

  const cacheRoot = dirname(runtimeRoot);
  const lockPath = `${runtimeRoot}.lock`;
  const temporaryRoot = `${runtimeRoot}.tmp-${process.pid}`;

  mkdirSync(cacheRoot, { recursive: true });
  await acquireLock(lockPath);

  try {
    if (isRuntimeReady(runtimeRoot, launcherPath)) {
      return;
    }

    const [payload] = Bun.embeddedFiles;

    if (!payload) {
      throw new Error(`Embedded payload ${__NEXUME_PAYLOAD_NAME__} is missing.`);
    }

    rmSync(temporaryRoot, { recursive: true, force: true });
    mkdirSync(temporaryRoot, { recursive: true });

    const compressedBytes = new Uint8Array(await payload.arrayBuffer());
    const actualHash = new Bun.CryptoHasher("sha256")
      .update(compressedBytes)
      .digest("hex");

    if (actualHash !== __NEXUME_PAYLOAD_SHA256__) {
      throw new Error("The embedded runtime payload failed integrity validation.");
    }

    const tarBytes = await Bun.zstdDecompress(compressedBytes);
    await new Bun.Archive(tarBytes).extract(temporaryRoot);

    const temporaryLauncherPath = join(
      temporaryRoot,
      __NEXUME_APP_NAME__,
      "bin",
      "launcher.exe",
    );

    if (!existsSync(temporaryLauncherPath)) {
      throw new Error("The extracted Electrobun launcher is missing.");
    }

    rmSync(runtimeRoot, { recursive: true, force: true });
    renameSync(temporaryRoot, runtimeRoot);
    writeFileSync(join(runtimeRoot, ".ready"), __NEXUME_PAYLOAD_SHA256__);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
    rmSync(lockPath, { recursive: true, force: true });
  }
}

async function showError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const logRoot = getLogRoot();

  mkdirSync(logRoot, { recursive: true });
  writeFileSync(
    join(logRoot, "portable-error.log"),
    `${new Date().toISOString()} ${message}\n`,
  );

  const escapedMessage = message.replaceAll("'", "''");
  const escapedTitle = __NEXUME_APP_NAME__.replaceAll("'", "''");
  const dialog = Bun.spawn({
    cmd: [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${escapedMessage}', '${escapedTitle}')`,
    ],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

  await dialog.exited;
}

async function main(): Promise<void> {
  const cacheRoot = getCacheRoot();
  const runtimeKey = `${__NEXUME_APP_VERSION__}-${__NEXUME_PAYLOAD_SHA256__.slice(0, 12)}`;
  const runtimeRoot = join(cacheRoot, runtimeKey);
  const launcherPath = join(
    runtimeRoot,
    __NEXUME_APP_NAME__,
    "bin",
    "launcher.exe",
  );

  await ensureRuntime(runtimeRoot, launcherPath);

  const child = Bun.spawn({
    cmd: [launcherPath, ...process.argv.slice(2)],
    cwd: dirname(launcherPath),
    env: {
      ...process.env,
      NEXUME_PORTABLE_EXECUTABLE: process.execPath,
      NEXUME_PORTABLE_ROOT: dirname(process.execPath),
      ...(process.env.NEXUME_PORTABLE_DEBUG === "1"
        ? { ELECTROBUN_CONSOLE: "1" }
        : {}),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const exitCode = await child.exited;
  const output = await Promise.all([stdout, stderr]);

  if (process.env.NEXUME_PORTABLE_DEBUG === "1" || exitCode !== 0) {
    const logRoot = getLogRoot();
    const launcherLogPath = join(logRoot, "launcher.log");

    mkdirSync(logRoot, { recursive: true });
    writeFileSync(
      launcherLogPath,
      `${new Date().toISOString()} launcher exited with code ${exitCode}\n\nstdout:\n${output[0]}\n\nstderr:\n${output[1]}\n`,
    );

    if (exitCode !== 0) {
      throw new Error(
        `The Nexume launcher exited with code ${exitCode}. See ${launcherLogPath} for details.`,
      );
    }
  }
}

try {
  await main();
} catch (error) {
  await showError(error);
  process.exitCode = 1;
}
