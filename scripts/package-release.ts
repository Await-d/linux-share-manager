import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { $ } from "bun"
import { APP_NAME, APP_VERSION } from "../src/shared/version"

type ReleaseManifest = {
  readonly name: string
  readonly version: string
  readonly builtAt: string
  readonly archive: string
  readonly source: {
    readonly commit: string
    readonly dirty: boolean
  }
  readonly installCommand: string
  readonly startCommand: string
  readonly contents: readonly string[]
}

const releaseRootFiles = [
  "package.json",
  "README.md",
  "README.zh-CN.md",
  "DOCKER_DEPLOYMENT.md",
  "Dockerfile",
  "docker-compose.yml",
] as const

const packageDirectory = "packages"
const packageBaseName = `${APP_NAME}-v${APP_VERSION}`
const archiveFileName = `${packageBaseName}.tar.gz`
const manifestFileName = `${packageBaseName}.json`
const archivePath = resolve(packageDirectory, archiveFileName)
const manifestPath = resolve(packageDirectory, manifestFileName)
const stageRoot = await mkdtemp(join(tmpdir(), `${APP_NAME}-release-`))
const releaseRoot = join(stageRoot, packageBaseName)

try {
  const sourceCommit = (await $`git rev-parse --short=12 HEAD`.quiet().text()).trim()
  const sourceStatus = (await $`git status --short`.quiet().text()).trim()
  const manifest: ReleaseManifest = {
    name: APP_NAME,
    version: APP_VERSION,
    builtAt: new Date().toISOString(),
    archive: archiveFileName,
    source: {
      commit: sourceCommit,
      dirty: sourceStatus.length > 0,
    },
    installCommand: "bun install --production",
    startCommand: "bun run start",
    contents: ["dist/server", "dist/web", "release-manifest.json", ...releaseRootFiles],
  }

  await mkdir(releaseRoot, { recursive: true })
  await cp("dist", join(releaseRoot, "dist"), { recursive: true })
  for (const file of releaseRootFiles) {
    await cp(file, join(releaseRoot, file))
  }

  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(join(releaseRoot, "release-manifest.json"), manifestJson)
  await mkdir(packageDirectory, { recursive: true })
  await rm(archivePath, { force: true })
  await rm(manifestPath, { force: true })
  await writeFile(manifestPath, manifestJson)
  await $`tar -C ${stageRoot} -czf ${archivePath} ${packageBaseName}`

  console.log(`Wrote ${packageDirectory}/${archiveFileName}`)
  console.log(`Wrote ${packageDirectory}/${manifestFileName}`)
} finally {
  await rm(stageRoot, { recursive: true, force: true })
}
