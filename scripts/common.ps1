# Shared helpers for build.ps1, sign.ps1 and commit.ps1. Dot-source it:
#     . (Join-Path $PSScriptRoot "common.ps1")

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BuildRoot = Join-Path $RepoRoot "build"
$ArchiveRoot = Join-Path $RepoRoot "archives"

$AllExtensions = @(
    [pscustomobject]@{
        Key = "Reddit"
        Directory = "Reddit Media Downloader"
        Archive = "reddit-media-downloader.zip"
        TagPrefix = "reddit"
        ExampleFolder = "Media/Reddit"
    },
    [pscustomobject]@{
        Key = "Redgifs"
        Directory = "Redgifs Video Downloader"
        Archive = "redgifs-video-downloader.zip"
        TagPrefix = "redgifs"
        ExampleFolder = "Media/Redgifs"
    }
)

# The extensions selected by -Target (Reddit, Redgifs or Both).
function Get-TargetExtensions {
    param([string] $Target)
    if ($Target -eq "Both") { return $AllExtensions }
    return @($AllExtensions | Where-Object Key -eq $Target)
}

function Get-ManifestPath {
    param($Extension)
    return Join-Path (Join-Path $RepoRoot $Extension.Directory) "manifest.json"
}

function Get-ManifestVersion {
    param([string] $ManifestPath)
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "Manifest not found: $ManifestPath"
    }
    $version = [string] (Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json).version
    if ([string]::IsNullOrWhiteSpace($version)) {
        throw "Manifest version is missing: $ManifestPath"
    }
    return $version
}

function Get-StageDir {
    param($Extension)
    return Join-Path $BuildRoot $Extension.Directory
}

function Get-LatestLinkPath {
    param($Extension)
    return Join-Path (Join-Path $ArchiveRoot $Extension.Directory) "latest"
}

# Runs a native command and stops the script if it fails.
function Invoke-Native {
    param([string] $Command, [string[]] $Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

# The project's own web-ext (npm install), or a globally installed one.
function Get-WebExt {
    $local = Join-Path $RepoRoot "node_modules/.bin/web-ext"
    if ($IsWindows) { $local += ".cmd" }
    if (Test-Path -LiteralPath $local -PathType Leaf) { return $local }
    if (Get-Command "web-ext" -ErrorAction SilentlyContinue) { return "web-ext" }
    throw "web-ext not found: run 'npm install' in $RepoRoot."
}

# Loads KEY=VALUE lines from .env (ignored by git) for this run only. Blank
# lines and # comments are skipped, surrounding quotes are removed, and
# variables already set in the environment take precedence.
function Import-DotEnv {
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { return }
    foreach ($line in Get-Content -LiteralPath $envFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
            continue
        }
        $name, $value = $trimmed -split "=", 2
        $name = $name.Trim()
        $value = $value.Trim()
        if ($value.Length -ge 2 -and $value[0] -eq $value[-1] -and $value[0] -in @('"', "'")) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if (-not [Environment]::GetEnvironmentVariable($name)) {
            [Environment]::SetEnvironmentVariable($name, $value)
        }
    }
}
