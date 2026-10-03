param(
    [ValidateSet("Reddit", "Redgifs", "Both")]
    [string] $Target = "Both",
    [switch] $Major,
    [switch] $Minor,
    # Only assemble build/<extension>/ for loading in Firefox; skip tests, lint and archives.
    [switch] $StageOnly,
    # Sign through addons.mozilla.org (unlisted). Needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET.
    [switch] $Sign,
    # Commit all changes and tag each built version; -Push also pushes to origin.
    [switch] $Commit,
    [switch] $Push,
    [string] $Message,
    [switch] $SkipTests
)




$ErrorActionPreference = "Stop"

if ($Major -and $Minor) {
    throw "Choose either -Major or -Minor, not both."
}
if (($Major -or $Minor) -and $Target -eq "Both") {
    throw "Version bumps require a single target: use -Target Reddit or -Target Redgifs."
}
if ($StageOnly -and ($Sign -or $Commit -or $Push)) {
    throw "-StageOnly cannot be combined with -Sign, -Commit or -Push."
}

# Load KEY=VALUE lines from .env (ignored by git) for this run only. Variables
# already set in the environment take precedence.
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path -LiteralPath $envFile -PathType Leaf) {
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

if ($Sign -and (-not $env:WEB_EXT_API_KEY -or -not $env:WEB_EXT_API_SECRET)) {
    throw "Signing needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET, in .env or the environment."
}

function Invoke-Native {
    param([string] $Command, [string[]] $Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

$rootDir = $PSScriptRoot
$sharedDir = Join-Path $rootDir "shared"
$buildRoot = Join-Path $rootDir "build"
$archiveRoot = Join-Path $rootDir "archives"
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
$extensions = @(
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

if ($Target -ne "Both") {
    $extensions = @($extensions | Where-Object Key -eq $Target)
}

if (-not $StageOnly -and -not $SkipTests) {
    Push-Location $rootDir
    try {
        Invoke-Native "node" @("--test", "tests/*.test.js")
    }
    finally {
        Pop-Location
    }
}

$built = @()
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

    # Assemble the unpacked extension: its own files, the shared files and the
    # generated options page. This is the directory to load in Firefox.
    $stageDir = Join-Path $buildRoot $extension.Directory
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

    $optionsHtml = (Get-Content -LiteralPath $optionsTemplatePath -Raw).
        Replace("{{NAME}}", [string] $manifest.name).
        Replace("{{EXAMPLE_FOLDER_WINDOWS}}", $extension.ExampleFolder.Replace("/", "\")).
        Replace("{{EXAMPLE_FOLDER}}", $extension.ExampleFolder)
    if ($optionsHtml -match "\{\{\w+\}\}") {
        throw "Unfilled placeholder $($Matches[0]) in options.template.html"
    }
    [IO.File]::WriteAllText(
        (Join-Path $stageDir "options.html"),
        $optionsHtml,
        [Text.UTF8Encoding]::new($false)
    )
    Write-Host "Staged $($extension.Directory): $stageDir"

    if ($StageOnly) {
        continue
    }

    Invoke-Native "web-ext" @("lint", "--source-dir", $stageDir)

    $safeVersion = $version -replace "[^A-Za-z0-9._-]", "_"
    $date = Get-Date -Format "yyyy-MM-dd"
    $extensionArchiveRoot = Join-Path $archiveRoot $extension.Directory
    $buildDir = Join-Path $extensionArchiveRoot "${safeVersion}_${date}"
    New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

    Invoke-Native "web-ext" @(
        "build",
        "--source-dir", $stageDir,
        "--artifacts-dir", $buildDir,
        "--filename", $extension.Archive,
        "--overwrite-dest"
    )
    Write-Host "Built $($extension.Directory): $(Join-Path $buildDir $extension.Archive)"

    if ($Sign) {
        Invoke-Native "web-ext" @(
            "sign",
            "--source-dir", $stageDir,
            "--artifacts-dir", $buildDir,
            "--channel", "unlisted"
        )
        Write-Host "Signed $($extension.Directory) into $buildDir"
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
    Write-Host "Updated latest link: $latestPath"

    $built += [pscustomobject]@{
        Name = $extension.Directory
        Version = $version
        Tag = "$($extension.TagPrefix)-v$version"
    }
}

if ($Commit -or $Push) {
    Push-Location $rootDir
    try {
        if ($Commit) {
            Invoke-Native "git" @("add", "--all")
            & git diff --cached --quiet
            if ($LASTEXITCODE -eq 1) {
                $commitMessage = if ($Message) {
                    $Message
                }
                else {
                    "Build " + (($built | ForEach-Object { "$($_.Name) $($_.Version)" }) -join ", ")
                }
                Invoke-Native "git" @("commit", "--message", $commitMessage)
            }
            elseif ($LASTEXITCODE -ne 0) {
                throw "git diff failed with exit code $LASTEXITCODE"
            }
            else {
                Write-Host "Nothing to commit."
            }

            foreach ($item in $built) {
                & git rev-parse --quiet --verify "refs/tags/$($item.Tag)" | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    Write-Warning "Tag $($item.Tag) already exists; leaving it unchanged."
                    continue
                }
                Invoke-Native "git" @("tag", "--annotate", $item.Tag, "--message", "$($item.Name) $($item.Version)")
                Write-Host "Tagged $($item.Tag)"
            }
        }

        if ($Push) {
            Invoke-Native "git" @("push", "--follow-tags", "origin", "HEAD")
        }
    }
    finally {
        Pop-Location
    }
}
