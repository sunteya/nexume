import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

import electrobunConfig from "../electrobun.config"

function markAsWindowsGuiExecutable(path: string): void {
  const bytes = readFileSync(path)
  const peOffset = bytes.readUInt32LE(0x3c)
  const optionalHeaderOffset = peOffset + 24
  const optionalHeaderMagic = bytes.readUInt16LE(optionalHeaderOffset)

  if (bytes.subarray(0, 2).toString("ascii") !== "MZ") {
    throw new Error("Portable executable is missing the DOS header.")
  }

  if (
    bytes.subarray(peOffset, peOffset + 4).toString("ascii") !== "PE\0\0" ||
    optionalHeaderMagic !== 0x20b
  ) {
    throw new Error("Portable executable is not a 64-bit Windows PE file.")
  }

  // Bun 1.3.13 writes Windows metadata but leaves the PE subsystem as console.
  bytes.writeUInt16LE(2, optionalHeaderOffset + 68)
  writeFileSync(path, new Uint8Array(bytes))
}

if (process.platform !== "win32") {
  throw new Error("The portable executable must be packaged on Windows.")
}

const projectRoot = resolve(import.meta.dir, "..")
const artifactDirectory = join(projectRoot, "artifacts")
const payloadName = readdirSync(artifactDirectory).find(
  (name) =>
    name.startsWith("stable-win-x64-") &&
    name.endsWith(".tar.zst") &&
    !name.includes("Setup"),
)

if (!payloadName) {
  throw new Error(
    "Electrobun's stable Windows payload was not found. Run the stable build first.",
  )
}

const payloadPath = join(artifactDirectory, payloadName)
const payloadBytes = await Bun.file(payloadPath).bytes()
const payloadHash = new Bun.CryptoHasher("sha256")
  .update(payloadBytes)
  .digest("hex")
const outputDirectory = join(artifactDirectory, "portable")
const outputPath = join(outputDirectory, `${electrobunConfig.app.name}.exe`)

mkdirSync(outputDirectory, { recursive: true })

const result = await Bun.build({
  entrypoints: [join(projectRoot, "src/portable/index.ts"), payloadPath],
  compile: {
    outfile: outputPath,
    windows: {
      hideConsole: true,
      title: electrobunConfig.app.name,
      publisher: "Nexume",
      version: electrobunConfig.app.version,
      description: "Nexume portable desktop application",
    },
  },
  define: {
    __NEXUME_APP_NAME__: JSON.stringify(electrobunConfig.app.name),
    __NEXUME_APP_VERSION__: JSON.stringify(electrobunConfig.app.version),
    __NEXUME_PAYLOAD_NAME__: JSON.stringify(basename(payloadPath)),
    __NEXUME_PAYLOAD_SHA256__: JSON.stringify(payloadHash),
  },
  loader: {
    ".zst": "file",
  },
  minify: true,
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  throw new Error("Failed to compile the portable executable.")
}

markAsWindowsGuiExecutable(outputPath)

console.log(`Portable executable created: ${outputPath}`)
