<#
.SYNOPSIS
    Sign the built Firefox extensions through addons.mozilla.org.

.DESCRIPTION
    Submits the staged copy in build/<extension>/ to addons.mozilla.org as
    an unlisted (self-distributed) version and saves the signed .xpi in
    archives/<extension>/latest/, next to the .zip from build.ps1.

    Run build.ps1 first. The script refuses to sign when the staged copy is
    missing or differs from the sources, or when the latest archive was
    built for another version, so what is signed is what was tested.

    Needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET, read from a .env file at
    the repository root or from the environment (the environment wins).
    AMO refuses a version number it has already signed, so bump the version
    with build.ps1 -Major or -Minor before signing again.

.PARAMETER Target
    Which extension to sign: Reddit, Redgifs or Both (default).

.PARAMETER Help
    Show this help.

.EXAMPLE
    pwsh -File ./scripts/sign.ps1 -Target Reddit
    Sign the Reddit Media Downloader version that build.ps1 just built.
#>
[CmdletBinding(DefaultParameterSetName = "Sign")]
param(
    [Parameter(ParameterSetName = "Sign")]
    [ValidateSet("Reddit", "Redgifs", "Both")]
    [string] $Target = "Both",

    [Parameter(ParameterSetName = "Help", Mandatory)]
    [switch] $Help
)

. (Join-Path $PSScriptRoot "common.ps1")

if ($Help) {
    Get-Help -Name $PSCommandPath -Detailed
    return
}

Import-DotEnv
if (-not $env:WEB_EXT_API_KEY -or -not $env:WEB_EXT_API_SECRET) {
    throw "Signing needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET, in .env or the environment."
}

# Throws unless build/<extension>/ holds the current sources: every file of
# the extension and of shared/ must have an identical staged copy.
function Assert-StageCurrent {
    param($Extension, [string] $StageDir)
    $hint = "run build.ps1 -Target $($Extension.Key) first"
    if (-not (Test-Path -LiteralPath (Join-Path $StageDir "manifest.json") -PathType Leaf)) {
        throw "$($Extension.Directory) has not been built: $hint."
    }

    $sources = @(
        @{ Dir = Join-Path $RepoRoot $Extension.Directory; Prefix = "" },
        @{ Dir = Join-Path $RepoRoot "shared"; Prefix = "shared" }
    )
    foreach ($source in $sources) {
        foreach ($file in Get-ChildItem -LiteralPath $source.Dir -File -Recurse -Force) {
            if ($file.Name -eq "options.template.html") { continue }
            $relative = [IO.Path]::GetRelativePath($source.Dir, $file.FullName)
            $staged = Join-Path (Join-Path $StageDir $source.Prefix) $relative
            if (-not (Test-Path -LiteralPath $staged -PathType Leaf) -or
                (Get-FileHash -LiteralPath $staged).Hash -ne (Get-FileHash -LiteralPath $file.FullName).Hash) {
                throw "The build of $($Extension.Directory) is out of date ($relative changed): $hint."
            }
        }
    }
}

$webExt = Get-WebExt
foreach ($extension in Get-TargetExtensions $Target) {
    $version = Get-ManifestVersion (Get-ManifestPath $extension)
    $stageDir = Get-StageDir $extension
    Assert-StageCurrent $extension $stageDir

    $latestPath = Get-LatestLinkPath $extension
    $latestItem = Get-Item -LiteralPath $latestPath -Force -ErrorAction SilentlyContinue
    $buildDir = if ($latestItem) { $latestItem.ResolveLinkTarget($true).FullName }
    $safeVersion = $version -replace "[^A-Za-z0-9._-]", "_"
    if (-not $buildDir -or -not (Split-Path -Leaf $buildDir).StartsWith("${safeVersion}_")) {
        throw "No archive of $($extension.Directory) ${version}: run build.ps1 -Target $($extension.Key) first."
    }

    Invoke-Native $webExt @(
        "sign",
        "--source-dir", $stageDir,
        "--artifacts-dir", $buildDir,
        "--channel", "unlisted"
    )
    Write-Host "Signed $($extension.Directory) $version into $buildDir"
}
