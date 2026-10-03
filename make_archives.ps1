param(
    [ValidateSet("Reddit", "Redgifs", "Both")]
    [string] $Target = "Both",
    [switch] $Major,
    [switch] $Minor
)

$ErrorActionPreference = "Stop"

if ($Major -and $Minor) {
    throw "Choose either -Major or -Minor, not both."
}
if (($Major -or $Minor) -and $Target -eq "Both") {
    throw "Version bumps require a single target: use -Target Reddit or -Target Redgifs."
}

$rootDir = $PSScriptRoot
$sharedDir = Join-Path $rootDir "shared"
$archiveRoot = Join-Path $rootDir "archives"
$sharedFiles = @(
    "redgifs-resolver.js",
    "debug.js",
    "download-dialog.js",
    "download-settings.js",
    "download-options.js",
    "isolated-download.js",
    "download-buttons.css"
)
$extensions = @(
    [pscustomobject]@{
        Key = "Reddit"
        Directory = "Reddit Media Downloader"
        Archive = "reddit-media-downloader.zip"
    },
    [pscustomobject]@{
        Key = "Redgifs"
        Directory = "Redgifs Video Downloader"
        Archive = "redgifs-video-downloader.zip"
    }
)

if ($Target -ne "Both") {
    $extensions = @($extensions | Where-Object Key -eq $Target)
}

foreach ($extension in $extensions) {
    $extensionDir = Join-Path $rootDir $extension.Directory
    $manifestPath = Join-Path $extensionDir "manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Manifest not found: $manifestPath"
    }

    $manifestText = Get-Content -LiteralPath $manifestPath -Raw
    $manifest = $manifestText | ConvertFrom-Json
    $version = [string] $manifest.version
    if ([string]::IsNullOrWhiteSpace($version)) {
        throw "Manifest version is missing: $manifestPath"
    }

    if ($Major -or $Minor) {
        $versionParts = @($version -split "\.")
        if ($versionParts.Count -lt 2 -or ($versionParts | Where-Object { $_ -notmatch '^\d+$' })) {
            throw "Cannot bump non-numeric manifest version '$version' in $manifestPath"
        }

        $versionNumbers = [System.Collections.Generic.List[long]]::new()
        foreach ($part in $versionParts) {
            $versionNumbers.Add([long]::Parse($part, [Globalization.CultureInfo]::InvariantCulture))
        }

        $bumpIndex = if ($Major) { 0 } else { 1 }
        $versionNumbers[$bumpIndex]++
        for ($index = $bumpIndex + 1; $index -lt $versionNumbers.Count; $index++) {
            $versionNumbers[$index] = 0
        }
        $newVersion = ($versionNumbers | ForEach-Object {
            $_.ToString([Globalization.CultureInfo]::InvariantCulture)
        }) -join "."

        $versionRegex = [regex]::new('("version"\s*:\s*")[^"]+(")')
        if (-not $versionRegex.IsMatch($manifestText)) {
            throw "Could not locate the version property in $manifestPath"
        }
        $manifestText = $versionRegex.Replace($manifestText, [System.Text.RegularExpressions.MatchEvaluator] {
            param($match)
            return "$($match.Groups[1].Value)$newVersion$($match.Groups[2].Value)"
        }, 1)
        [IO.File]::WriteAllText($manifestPath, $manifestText, [Text.UTF8Encoding]::new($false))
        $version = $newVersion
        Write-Host "Updated $($extension.Directory) version: $version"
    }

    $safeVersion = $version -replace "[^A-Za-z0-9._-]", "_"
    $date = Get-Date -Format "yyyy-MM-dd"

    $packageSharedDir = Join-Path $extensionDir "shared"
    New-Item -ItemType Directory -Path $packageSharedDir -Force | Out-Null
    foreach ($file in $sharedFiles) {
        $source = Join-Path $sharedDir $file
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Shared source not found: $source"
        }
        Copy-Item -LiteralPath $source -Destination $packageSharedDir -Force
    }

    $extensionArchiveRoot = Join-Path $archiveRoot $extension.Directory
    $buildDir = Join-Path $extensionArchiveRoot "${safeVersion}_${date}"
    New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
    $archivePath = Join-Path $buildDir $extension.Archive

    Push-Location $extensionDir
    try {
        Compress-Archive -Path @(
            "manifest.json",
            "background.js",
            "content.js",
            "options.html",
            "shared",
            "icons",
            "README.md"
        ) -DestinationPath $archivePath -Force
    }
    finally {
        Pop-Location
    }

    $latestPath = Join-Path $extensionArchiveRoot "latest"
    $latestItem = Get-Item -LiteralPath $latestPath -Force -ErrorAction SilentlyContinue
    if ($null -ne $latestItem) {
        if (($latestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
            throw "Refusing to replace a non-link latest path: $latestPath"
        }
        [IO.Directory]::Delete($latestPath, $false)
    }

    if ([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
        [Runtime.InteropServices.OSPlatform]::Windows
    )) {
        New-Item -ItemType Junction -Path $latestPath -Target $buildDir | Out-Null
    }
    else {
        New-Item -ItemType SymbolicLink -Path $latestPath -Target $buildDir | Out-Null
    }

    Write-Host "Built $($extension.Directory): $archivePath"
    Write-Host "Updated latest link: $latestPath"
}