import { rmSync } from "node:fs"
import { join } from "node:path"

const packageRoot = join(import.meta.dir, "..")
const repositoryRoot = join(packageRoot, "../..")
const outdir = join(packageRoot, "dist")

rmSync(outdir, { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: [join(packageRoot, "src/index.ts")],
  outdir,
  target: "bun",
  format: "esm",
  packages: "bundle",
  sourcemap: "none",
  banner: "#!/usr/bin/env bun",
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await Bun.write(join(outdir, "LICENSE"), Bun.file(join(repositoryRoot, "LICENSE")))
