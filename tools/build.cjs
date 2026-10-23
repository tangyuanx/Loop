const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const projectReleaseDirectory = path.join(process.cwd(), "release");
const hasOutputOverride = args.some((arg) => arg.startsWith("--config.directories.output"));
const shouldUseInternalOutput =
  process.cwd().startsWith(`${path.sep}Volumes${path.sep}`) && !hasOutputOverride;
const platformName = args.includes("--win") ? "win" : args.includes("--mac") ? "mac" : "all";
const internalOutputDirectory = path.join(
  os.tmpdir(),
  `personal-task-track-release-${platformName}`,
);
const builderArgs = [...args];

if (shouldUseInternalOutput) {
  fs.rmSync(internalOutputDirectory, { force: true, recursive: true });
  builderArgs.push(`--config.directories.output=${internalOutputDirectory}`);
}

process.env.COPYFILE_DISABLE = "1";

const milkdownResult = spawnSync(process.execPath, ["tools/build-milkdown.cjs"], {
  env: process.env,
  stdio: "inherit",
});

if (milkdownResult.status !== 0) process.exit(milkdownResult.status ?? 1);
const knowledgeResult = spawnSync(process.execPath, ["tools/build-knowledge.cjs"], {env: process.env, stdio: "inherit"});
if (knowledgeResult.status !== 0) process.exit(knowledgeResult.status ?? 1);

const result = spawnSync(process.execPath, [require.resolve("electron-builder/cli.js"), ...builderArgs], {
  env: process.env,
  stdio: "inherit",
});

if (result.status === 0 && shouldUseInternalOutput) {
  copyReleaseArtifacts(internalOutputDirectory, projectReleaseDirectory);
}

removeAppleDoubleFiles(projectReleaseDirectory);

process.exit(result.status ?? 1);

function copyReleaseArtifacts(sourceDirectory, targetDirectory) {
  const releaseExtensions = new Set([".blockmap", ".dmg", ".exe", ".yml", ".zip"]);
  const updateMetadataFiles = new Set(["latest.yml", "latest-mac.yml"]);
  fs.mkdirSync(targetDirectory, { recursive: true });
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !releaseExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    if (path.extname(entry.name).toLowerCase() === ".yml" && !updateMetadataFiles.has(entry.name)) continue;
    fs.copyFileSync(
      path.join(sourceDirectory, entry.name),
      path.join(targetDirectory, entry.name),
    );
  }
}

function removeAppleDoubleFiles(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.name.startsWith("._")) {
      fs.rmSync(entryPath, { force: true, recursive: true });
      continue;
    }
    if (entry.isDirectory()) removeAppleDoubleFiles(entryPath);
  }
}
