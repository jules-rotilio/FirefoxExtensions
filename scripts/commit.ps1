<#
.SYNOPSIS
    Commit all changes, optionally tag the extension versions, and push.

.DESCRIPTION
    Stages every change in the repository and commits it. With -Tag, it
    also adds an annotated tag per selected extension, named after the
    version in its manifest.json (reddit-v1.3, redgifs-v1.2); existing tags
    are left unchanged. With -Push, the current branch and its tags are
    pushed to origin.

    All changes are included, so check git status first. Files ignored by
    git (build/, archives/, .env) are never committed.

.PARAMETER Message
    The commit message. Required without -Tag; with -Tag it defaults to
    "Release <extension> <version>".

.PARAMETER Tag
    Tag the current version of each selected extension.

.PARAMETER Target
    Which extensions to tag with -Tag: Reddit, Redgifs or Both (default).

.PARAMETER Push
    Push the current branch and its tags to origin after committing.

.PARAMETER Help
    Show this help.

.EXAMPLE
    pwsh -File ./scripts/commit.ps1 -Message "Fix crosspost galleries"
    Commit all changes.

.EXAMPLE
    pwsh -File ./scripts/commit.ps1 -Tag -Target Reddit -Push
    Commit as "Release Reddit Media Downloader <version>", tag it, and push.
#>
[CmdletBinding(DefaultParameterSetName = "Commit")]
param(
    [Parameter(ParameterSetName = "Commit", Mandatory)]
    [Parameter(ParameterSetName = "Tag")]
    [ValidateNotNullOrEmpty()]
    [string] $Message,

    [Parameter(ParameterSetName = "Tag", Mandatory)]
    [switch] $Tag,

    [Parameter(ParameterSetName = "Tag")]
    [ValidateSet("Reddit", "Redgifs", "Both")]
    [string] $Target = "Both",

    [Parameter(ParameterSetName = "Commit")]
    [Parameter(ParameterSetName = "Tag")]
    [switch] $Push,

    [Parameter(ParameterSetName = "Help", Mandatory)]
    [switch] $Help
)

. (Join-Path $PSScriptRoot "common.ps1")

if ($Help) {
    Get-Help -Name $PSCommandPath -Detailed
    return
}

$releases = if ($Tag) {
    @(Get-TargetExtensions $Target | ForEach-Object {
        $version = Get-ManifestVersion (Get-ManifestPath $_)
        [pscustomobject]@{
            Name = $_.Directory
            Version = $version
            Tag = "$($_.TagPrefix)-v$version"
        }
    })
}
else {
    @()
}

Push-Location $RepoRoot
try {
    Invoke-Native "git" @("add", "--all")
    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 1) {
        $commitMessage = if ($Message) {
            $Message
        }
        else {
            "Release " + (($releases | ForEach-Object { "$($_.Name) $($_.Version)" }) -join ", ")
        }
        Invoke-Native "git" @("commit", "--message", $commitMessage)
    }
    elseif ($LASTEXITCODE -ne 0) {
        throw "git diff failed with exit code $LASTEXITCODE"
    }
    else {
        Write-Host "Nothing to commit."
    }

    foreach ($release in $releases) {
        & git rev-parse --quiet --verify "refs/tags/$($release.Tag)" | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Warning "Tag $($release.Tag) already exists; leaving it unchanged."
            continue
        }
        Invoke-Native "git" @("tag", "--annotate", $release.Tag, "--message", "$($release.Name) $($release.Version)")
        Write-Host "Tagged $($release.Tag)"
    }

    if ($Push) {
        Invoke-Native "git" @("push", "--follow-tags", "origin", "HEAD")
    }
}
finally {
    Pop-Location
}
