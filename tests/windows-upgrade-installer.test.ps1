param(
    [Parameter(Mandatory = $true)]
    [string]$CandidateInstaller,
    [switch]$AllowLocal
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $IsWindows) {
    throw "The Windows installer upgrade test must run on Windows."
}
if (-not $AllowLocal -and $env:GITHUB_ACTIONS -ne "true") {
    throw "This destructive installer test is restricted to GitHub Actions. Pass -AllowLocal only on an expendable Windows test account."
}

$candidate = (Resolve-Path -LiteralPath $CandidateInstaller).Path
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
$expectedVersion = [string]$packageJson.version
if ($expectedVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    throw "Invalid candidate version in package.json: $expectedVersion"
}
$fixtureRoot = Join-Path $env:RUNNER_TEMP "loop-upgrade-installer-fixture"
$installDir = Join-Path $fixtureRoot "PersonalTaskTrackInstall"
$downloadDir = Join-Path $fixtureRoot "installers"
$userDataDir = Join-Path $env:APPDATA "Personal Task Track"
$installerBackup = Join-Path $env:APPDATA "Personal Task Track Upgrade Backups\installer-pre-$expectedVersion"
$installRegistryKey = "HKCU:\Software\202fcf38-9bdb-57df-9a48-40d277bbfed9"
$uninstallRegistryKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\202fcf38-9bdb-57df-9a48-40d277bbfed9"

if (-not $fixtureRoot.StartsWith($env:RUNNER_TEMP, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe fixture root: $fixtureRoot"
}

function Invoke-Installer([string]$Path, [string[]]$ExtraArguments = @()) {
    $arguments = @("/S") + $ExtraArguments + @("/D=$installDir")
    $process = Start-Process -FilePath $Path -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Installer failed with exit code $($process.ExitCode): $Path"
    }
}

function Remove-InstalledLoop {
    $uninstaller = Join-Path $installDir "Uninstall Loop.exe"
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList @("/S", "/currentuser") -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw "Fixture uninstaller failed with exit code $($process.ExitCode)."
        }
    }
    Remove-Item -LiteralPath $installRegistryKey -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $uninstallRegistryKey -Recurse -Force -ErrorAction SilentlyContinue
}

function Reset-Fixture([string]$TargetVersion) {
    Remove-InstalledLoop
    $quarantine = "$installDir.legacy-loop-backups-pre-$TargetVersion"
    Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $quarantine -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $fixtureRoot -Directory -Filter "PersonalTaskTrackInstall.legacy-loop-backups-pre-$TargetVersion-*" -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force
    Remove-Item -LiteralPath $userDataDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $installerBackup -Recurse -Force -ErrorAction SilentlyContinue
}

function Test-InstalledUpgradeVerification([string]$Executable, [string]$ExpectedStatus, [string]$Attempt = "attempt-1") {
    $process = Start-Process -FilePath $Executable -PassThru
    try {
        $reportPath = Join-Path $userDataDir ".loop-upgrade-report.json"
        $deadline = [DateTime]::UtcNow.AddSeconds(45)
        do {
            if (Test-Path -LiteralPath $reportPath -PathType Leaf) {
                $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
                if ($report.installerAttempt -eq $Attempt -and $report.status -ne "checked") {
                    if ($report.status -ne $ExpectedStatus -or $report.version -ne $expectedVersion) {
                        throw "Unexpected startup verification result: $($report.status) $($report.message)"
                    }
                    return
                }
            }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $deadline)
        throw "Loop did not finish upgrade verification."
    } finally {
        if (-not $process.HasExited) {
            [void]$process.CloseMainWindow()
            if (-not $process.WaitForExit(5000)) {
                Stop-Process -Id $process.Id -Force
                [void]$process.WaitForExit(5000)
            }
        }
    }
}

function New-LegacyBackupTree([string]$InstalledVersion) {
    $backupRoot = Join-Path $installDir "Loop Data Backups"
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    if ($InstalledVersion -eq "0.1.151") {
        $cursor = $backupRoot
        foreach ($depth in 1..12) {
            $cursor = Join-Path $cursor "installer-pre-$depth\previous-install-backups"
            New-Item -ItemType Directory -Path $cursor -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $cursor "legacy-$depth.json") -Value "{`"depth`":$depth}" -Encoding UTF8
        }
    } else {
        $normal = Join-Path $backupRoot "installer-pre-$InstalledVersion\Personal Task Track"
        New-Item -ItemType Directory -Path $normal -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $normal "task-data.json") -Value "{`"version`":`"$InstalledVersion`"}" -Encoding UTF8
    }
}

New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null

try {
    foreach ($installedVersion in @("0.1.151", "0.1.152", "0.1.153")) {
        Reset-Fixture -TargetVersion $expectedVersion
        $oldInstaller = Join-Path $downloadDir "Loop-$installedVersion-x64-setup.exe"
        if (-not (Test-Path -LiteralPath $oldInstaller -PathType Leaf)) {
            $uri = "https://github.com/tangyuanx/Loop/releases/download/v$installedVersion/Loop-$installedVersion-x64-setup.exe"
            Invoke-WebRequest -Uri $uri -OutFile $oldInstaller
        }

        Invoke-Installer -Path $oldInstaller
        $loopExecutable = Join-Path $installDir "Loop.exe"
        if (-not (Test-Path -LiteralPath $loopExecutable -PathType Leaf)) {
            throw "Old installer did not create Loop.exe for v$installedVersion."
        }

        New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null
        $marker = "upgrade-$installedVersion-to-$expectedVersion"
        $taskDataPath = Join-Path $userDataDir "task-data.json"
        $sourceData = @{ version = 4; marker = $marker; tasks = @() } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($taskDataPath, $sourceData)
        $beforeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $taskDataPath).Hash
        $assets = @{
            'task-share-assets\task_178a2e09-1c92-4170-a8b2-3b20c30d27ef\attachment.txt' = [Text.Encoding]::UTF8.GetBytes("Loop attachment $marker")
            'task-data.workspace' = [Text.Encoding]::UTF8.GetBytes("Loop workspace`n")
            'image-assets\fb11969ac3320e69612bb70436840c9d189fe7429cea9eea9238db500c30c130.png' = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nFkAAAAASUVORK5CYII=')
            'workspace-notes\a65153a625984069abd82673f69d6def\测试笔记.md' = [Text.Encoding]::UTF8.GetBytes("# 知识笔记 $marker")
            'workspace-notes\a65153a625984069abd82673f69d6def\附件\记录.txt' = [Text.Encoding]::UTF8.GetBytes("笔记附件 $marker")
        }
        $assetHashes = @{}
        foreach ($asset in $assets.GetEnumerator()) {
            $assetPath = Join-Path $userDataDir $asset.Key
            New-Item -ItemType Directory -Path (Split-Path -Parent $assetPath) -Force | Out-Null
            [IO.File]::WriteAllBytes($assetPath, $asset.Value)
            $assetHashes[$asset.Key] = (Get-FileHash -Algorithm SHA256 -LiteralPath $assetPath).Hash
        }
        New-LegacyBackupTree -InstalledVersion $installedVersion

        Invoke-Installer -Path $candidate -ExtraArguments @("--updated")

        if (-not (Test-Path -LiteralPath $loopExecutable -PathType Leaf)) {
            throw "Candidate installer did not leave Loop.exe installed after upgrading v$installedVersion."
        }
        $productVersion = (Get-Item -LiteralPath $loopExecutable).VersionInfo.ProductVersion
        if (-not $productVersion.StartsWith($expectedVersion, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Unexpected installed version after upgrading v${installedVersion}: $productVersion"
        }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $taskDataPath).Hash -ne $beforeHash) {
            throw "Task data changed while upgrading v$installedVersion."
        }

        $legacySource = Join-Path $installDir "Loop Data Backups"
        $quarantine = "$installDir.legacy-loop-backups-pre-$expectedVersion"
        if (-not (Test-Path -LiteralPath $quarantine -PathType Container)) {
            throw "Legacy backup quarantine was not created while upgrading v$installedVersion."
        }
        if ($installedVersion -eq "0.1.151") {
            $quarantinedLegacyFile = Join-Path $quarantine "installer-pre-1\previous-install-backups\legacy-1.json"
            if (-not (Test-Path -LiteralPath $quarantinedLegacyFile -PathType Leaf)) {
                throw "Recursive v0.1.151 backup content was not preserved in quarantine."
            }
        }
        $attempt = Join-Path $installerBackup "attempt-1"
        $mirrorAttempt = Join-Path $legacySource "installer-pre-$expectedVersion\attempt-1"
        if (-not (Test-Path -LiteralPath $mirrorAttempt -PathType Container)) {
            throw "The candidate did not create a fresh non-recursive installer backup for v$installedVersion."
        }
        if (Get-ChildItem -LiteralPath $legacySource -Directory -Recurse -Filter "previous-install-backups") {
            throw "The candidate copied historical installation backups into the fresh backup tree."
        }
        $markerFile = Join-Path $attempt "legacy-install-backups-location.txt"
        $profileLabel = Split-Path -Leaf $userDataDir
        $stableBackup = Join-Path $attempt $profileLabel
        $installedBackup = Join-Path $mirrorAttempt $profileLabel
        foreach ($asset in $assetHashes.GetEnumerator()) {
            foreach ($root in @($userDataDir, $stableBackup, $installedBackup)) {
                $saved = Join-Path $root $asset.Key
                if (-not (Test-Path -LiteralPath $saved -PathType Leaf) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $saved).Hash -ne $asset.Value) {
                    throw "Managed file '$($asset.Key)' was not preserved at '$root' while upgrading v$installedVersion."
                }
            }
        }
        if (-not (Test-Path -LiteralPath $markerFile -PathType Leaf)) {
            throw "The quarantine marker is missing after upgrading v$installedVersion."
        }
        if ((Get-Content -LiteralPath $markerFile -Raw).Trim() -ne $quarantine) {
            throw "The quarantine marker contains an unexpected path after upgrading v$installedVersion."
        }

        $upgradeCheckMarker = Join-Path $attempt ".loop-install-check"
        if (-not (Test-Path -LiteralPath $upgradeCheckMarker -PathType Leaf)) {
            throw "The installer did not mark the new upgrade snapshot."
        }
        if ($installedVersion -eq "0.1.153") {
            [IO.File]::WriteAllText($taskDataPath, '{"version":4,"tasks":[]}')
            Test-InstalledUpgradeVerification -Executable $loopExecutable -ExpectedStatus "failed"
            if (-not (Test-Path -LiteralPath $stableBackup) -or -not (Test-Path -LiteralPath $installedBackup)) {
                throw "A workspace mismatch removed pre-upgrade backups."
            }
        } else {
            Test-InstalledUpgradeVerification -Executable $loopExecutable -ExpectedStatus "passed"
            if (-not (Test-Path -LiteralPath $stableBackup) -or (Test-Path -LiteralPath $installedBackup)) {
                throw "First launch did not retain the AppData backup and clean its verified mirror."
            }
        }
        if (-not (Test-Path -LiteralPath $quarantine -PathType Container)) {
            throw "Startup verification touched historical backup quarantine."
        }

        if ($installedVersion -eq "0.1.153") {
            $historyFile = Join-Path $quarantine "installer-pre-$installedVersion\Personal Task Track\task-data.json"
            $historyHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $historyFile).Hash
            $interrupted = Join-Path $installerBackup "attempt-3"
            New-Item -ItemType Directory -Path $interrupted | Out-Null
            Set-Content -LiteralPath (Join-Path $interrupted ".loop-install-pending") -Value "incomplete"

            $retryNode = @{ id = "node-same-version-retry"; title = "Keep this step"; note = "Step notes before retry" }
            $retryTask = @{ id = "task-same-version-retry"; title = "Keep this task"; notes = "Task notes before retry"; nodes = @($retryNode) }
            $retryData = @{ version = 4; tasks = @($retryTask) } | ConvertTo-Json -Depth 8 -Compress
            [IO.File]::WriteAllText($taskDataPath, $retryData)
            $retryHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $taskDataPath).Hash
            Invoke-Installer -Path $candidate -ExtraArguments @("--updated")

            $retryArchive = "$quarantine-1"
            $archivedMirror = Join-Path $retryArchive "installer-pre-$expectedVersion\attempt-1\$profileLabel\task-data.json"
            $retryAttempt = Join-Path $installerBackup "attempt-4"
            $retryBackup = Join-Path $retryAttempt "$profileLabel\task-data.json"
            $retryMarker = Join-Path $retryAttempt "legacy-install-backups-location.txt"
            if ((Get-Content -LiteralPath $retryMarker -Raw).Trim() -ne $retryArchive) {
                throw "The retry did not record its separate quarantine location."
            }
            if ((Get-FileHash -Algorithm SHA256 -LiteralPath $historyFile).Hash -ne $historyHash -or
                (Get-FileHash -Algorithm SHA256 -LiteralPath $archivedMirror).Hash -ne $beforeHash -or
                (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stableBackup "task-data.json")).Hash -ne $beforeHash) {
                throw "Same-version retry replaced historical backup contents."
            }
            if ((Get-FileHash -Algorithm SHA256 -LiteralPath $taskDataPath).Hash -ne $retryHash -or
                (Get-FileHash -Algorithm SHA256 -LiteralPath $retryBackup).Hash -ne $retryHash -or
                -not (Test-Path -LiteralPath (Join-Path $interrupted ".loop-install-pending") -PathType Leaf)) {
                throw "Same-version retry did not preserve the workspace and interrupted attempt and create its own snapshot."
            }
            Test-InstalledUpgradeVerification -Executable $loopExecutable -ExpectedStatus "passed" -Attempt "attempt-4"
            # Graceful shutdown can rewrite the JSON with normalized defaults and formatting.
            $workspace = Get-Content -LiteralPath $taskDataPath -Raw | ConvertFrom-Json
            if (@($workspace.tasks).Count -ne 1 -or $workspace.tasks[0].id -ne $retryTask.id -or
                $workspace.tasks[0].title -ne $retryTask.title -or $workspace.tasks[0].notes -ne $retryTask.notes -or
                @($workspace.tasks[0].nodes).Count -ne 1 -or $workspace.tasks[0].nodes[0].id -ne $retryNode.id -or
                $workspace.tasks[0].nodes[0].title -ne $retryNode.title -or $workspace.tasks[0].nodes[0].note -ne $retryNode.note) {
                throw "First launch and shutdown did not preserve the task, step and notes from the retried workspace."
            }
            if ((Get-FileHash -Algorithm SHA256 -LiteralPath $retryBackup).Hash -ne $retryHash) {
                throw "First launch did not retain the original bytes of the new AppData backup."
            }
            Write-Host "Verified same-version retry, preserved historical copies, and verified first launch against attempt-4."
        }

        Write-Host "Verified Windows installer upgrade v$installedVersion -> v$expectedVersion"
    }
} finally {
    Reset-Fixture -TargetVersion $expectedVersion
}
