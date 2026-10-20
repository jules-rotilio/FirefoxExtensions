<#
.SYNOPSIS
    Stage, test, lint and build the Firefox extensions.

.DESCRIPTION
    For each selected extension, the script assembles a loadable copy in
    build/<extension>/ (the extension's own files, the files from shared/
    and an options.html generated from shared/options.template.html). It
    then runs the tests (once), runs web-ext lint, and zips the staged copy
    into archives/<extension>/<version>_<yyyy-MM-dd>/, pointing
    archives/<extension>/latest at that directory.

    Signing and git are handled by sign.ps1 and commit.ps1.

.PARAMETER Target
    Which extension to process: Reddit, Redgifs or Both (default).

.PARAMETER Major
    Increment the first version number in the target's manifest.json and
    reset the others to zero (1.4 -> 2.0). Needs -Target Reddit or -Target
    Redgifs. Cannot be combined with -Minor.

.PARAMETER Minor
    Increment the second version number in the target's manifest.json and
    reset any later ones to zero (1.4 -> 1.5). Needs -Target Reddit or
    -Target Redgifs. Cannot be combined with -Major.

.PARAMETER SkipTests
    Do not run the tests before building.

.PARAMETER StageOnly
    Only assemble build/<extension>/ for loading in Firefox: no version
    bump, tests, lint or archives.

.PARAMETER Help
    Show this help.

.EXAMPLE
    pwsh -File ./scripts/build.ps1
    Test, lint and build both extensions at their current versions.

.EXAMPLE
    pwsh -File ./scripts/build.ps1 -StageOnly -Target Redgifs
    Refresh build/Redgifs Video Downloader/ after editing, then click Reload
    in about:debugging.

.EXAMPLE
    pwsh -File ./scripts/build.ps1 -Target Reddit -Minor
    Bump Reddit Media Downloader's minor version, then test, lint and build
    it, ready for sign.ps1.
#>
[CmdletBinding(DefaultParameterSetName = "Build")]
param(
    [Parameter(ParameterSetName = "Build")]
    [Parameter(ParameterSetName = "BuildMajor")]
    [Parameter(ParameterSetName = "BuildMinor")]
    [Parameter(ParameterSetName = "Stage")]
    [ValidateSet("Reddit", "Redgifs", "Both")]
    [string] $Target = "Both",

    [Parameter(ParameterSetName = "BuildMajor", Mandatory)]
    [switch] $Major,

    [Parameter(ParameterSetName = "BuildMinor", Mandatory)]
    [switch] $Minor,

    [Parameter(ParameterSetName = "Build")]
    [Parameter(ParameterSetName = "BuildMajor")]
    [Parameter(ParameterSetName = "BuildMinor")]
    [switch] $SkipTests,

    [Parameter(ParameterSetName = "Stage", Mandatory)]
    [switch] $StageOnly,

    [Parameter(ParameterSetName = "Help", Mandatory)]
    [switch] $Help
)

. (Join-Path $PSScriptRoot "common.ps1")

if ($Help) {
    Get-Help -Name $PSCommandPath -Detailed
    return
}

# A rule the parameter sets cannot express.
if (($Major -or $Minor) -and $Target -eq "Both") {
    throw "Version bumps require a single target: use -Target Reddit or -Target Redgifs."
}

$sharedDir = Join-Path $RepoRoot "shared"
$optionsTemplatePath = Join-Path $sharedDir "options.template.html"
$sharedFiles = @(
    "redgifs-resolver.js",
    "debug.js",
    "download-dialog.js",
    "download-settings.js",
    "download-options.js",
    "isolated-download.js",
    "options-theme.js",
    "download-buttons.css"
)

# Increments one component of a numeric version and resets the later ones.
function Step-Version {
    param([string] $Version, [int] $Index, [string] $ManifestPath)
    $parts = @($Version -split "\.")
    if ($parts.Count -lt 2 -or ($parts | Where-Object { $_ -notmatch '^\d+$' })) {
        throw "Cannot bump non-numeric manifest version '$Version' in $ManifestPath"
    }
    $numbers = [System.Collections.Generic.List[long]]::new()
    foreach ($part in $parts) {
        $numbers.Add([long]::Parse($part, [Globalization.CultureInfo]::InvariantCulture))
    }
    $numbers[$Index]++
    for ($i = $Index + 1; $i -lt $numbers.Count; $i++) {
        $numbers[$i] = 0
    }
    return ($numbers | ForEach-Object {
        $_.ToString([Globalization.CultureInfo]::InvariantCulture)
    }) -join "."
}

# Writes the new version into manifest.json, keeping the rest of the file as is.
function Set-ManifestVersion {
    param([string] $ManifestPath, [string] $Version)
    $text = Get-Content -LiteralPath $ManifestPath -Raw
    $versionRegex = [regex]::new('("version"\s*:\s*")[^"]+(")')
    if (-not $versionRegex.IsMatch($text)) {
        throw "Could not locate the version property in $ManifestPath"
    }
    $text = $versionRegex.Replace($text, [System.Text.RegularExpressions.MatchEvaluator] {
        param($match)
        return "$($match.Groups[1].Value)$Version$($match.Groups[2].Value)"
    }, 1)
    [IO.File]::WriteAllText($ManifestPath, $text, [Text.UTF8Encoding]::new($false))
}

# Assembles the unpacked extension: its own files, the shared files and the
# generated options page. This is the directory to load in Firefox.
function New-StagedExtension {
    param($Extension)
    $extensionDir = Join-Path $RepoRoot $Extension.Directory
    $stageDir = Get-StageDir $Extension
    if (Test-Path -LiteralPath $stageDir) {
        Remove-Item -LiteralPath $stageDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
    Get-ChildItem -LiteralPath $extensionDir -Force |
        Copy-Item -Destination $stageDir -Recurse -Force

    $stageSharedDir = Join-Path $stageDir "shared"
    New-Item -ItemType Directory -Path $stageSharedDir -Force | Out-Null
    foreach ($file in $sharedFiles) {
        $source = Join-Path $sharedDir $file
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Shared source not found: $source"
        }
        Copy-Item -LiteralPath $source -Destination $stageSharedDir -Force
    }

    $name = [string] (Get-Content -LiteralPath (Get-ManifestPath $Extension) -Raw | ConvertFrom-Json).name
    $optionsHtml = (Get-Content -LiteralPath $optionsTemplatePath -Raw).
        Replace("{{NAME}}", $name).
        Replace("{{EXAMPLE_FOLDER_WINDOWS}}", $Extension.ExampleFolder.Replace("/", "\")).
        Replace("{{EXAMPLE_FOLDER}}", $Extension.ExampleFolder)
    if ($optionsHtml -match "\{\{\w+\}\}") {
        throw "Unfilled placeholder $($Matches[0]) in options.template.html"
    }
    [IO.File]::WriteAllText(
        (Join-Path $stageDir "options.html"),
        $optionsHtml,
        [Text.UTF8Encoding]::new($false)
    )
    Write-Host "Staged $($Extension.Directory): $stageDir"
    return $stageDir
}

# Points archives/<extension>/latest at the given build directory.
function Set-LatestLink {
    param($Extension, [string] $BuildDir)
    $latestPath = Get-LatestLinkPath $Extension
    $latestItem = Get-Item -LiteralPath $latestPath -Force -ErrorAction SilentlyContinue
    if ($null -ne $latestItem) {
        if (($latestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
            throw "Refusing to replace a non-link latest path: $latestPath"
        }
        [IO.Directory]::Delete($latestPath, $false)
    }
    if ($IsWindows) {
        New-Item -ItemType Junction -Path $latestPath -Target $BuildDir | Out-Null
    }
    else {
        New-Item -ItemType SymbolicLink -Path $latestPath -Target $BuildDir | Out-Null
    }
    Write-Host "Updated latest link: $latestPath"
}

$extensions = Get-TargetExtensions $Target

if ($StageOnly) {
    foreach ($extension in $extensions) {
        New-StagedExtension $extension | Out-Null
    }
    return
}

$webExt = Get-WebExt
if (-not $SkipTests) {
    Push-Location $RepoRoot
    try {
        Invoke-Native "node" @("--test", "tests/*.test.js")
    }
    finally {
        Pop-Location
    }
}

foreach ($extension in $extensions) {
    $manifestPath = Get-ManifestPath $extension
    $version = Get-ManifestVersion $manifestPath
    if ($Major -or $Minor) {
        $version = Step-Version $version $(if ($Major) { 0 } else { 1 }) $manifestPath
        Set-ManifestVersion $manifestPath $version
        Write-Host "Updated $($extension.Directory) version: $version"
    }

    $stageDir = New-StagedExtension $extension
    Invoke-Native $webExt @("lint", "--source-dir", $stageDir)

    $safeVersion = $version -replace "[^A-Za-z0-9._-]", "_"
    $date = Get-Date -Format "yyyy-MM-dd"
    $buildDir = Join-Path (Join-Path $ArchiveRoot $extension.Directory) "${safeVersion}_${date}"
    New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

    Invoke-Native $webExt @(
        "build",
        "--source-dir", $stageDir,
        "--artifacts-dir", $buildDir,
        "--filename", $extension.Archive,
        "--overwrite-dest"
    )
    Write-Host "Built $($extension.Directory): $(Join-Path $buildDir $extension.Archive)"
    Set-LatestLink $extension $buildDir
}
