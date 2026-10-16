# Set the version of everything in the repo: .\tools\set-version.ps1 0.7.0
# The VERSION file is the source; build.ps1 stamps it into the viewer pages, the landing
# page and the FigUI plugin, and checks the VS Code extension's package.json against it.
# Release by tagging the same version: git tag v0.7.0 (the release workflow checks they match).
param([Parameter(Mandatory = $true)][string]$Version)

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "Use a version like 0.7.0" -ForegroundColor Red
    exit 1
}
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object System.Text.UTF8Encoding($false)   # no BOM; works the same in Windows PowerShell 5
[IO.File]::WriteAllText((Join-Path $root "VERSION"), "$Version`n", $utf8)

# The VS Code extension's manifest: change only its "version" line, keep the formatting
$manifest = Join-Path $root "vscode-extension/package.json"
$text = [IO.File]::ReadAllText($manifest, $utf8)
$text = ([regex]'("version"\s*:\s*")[^"]*(")').Replace($text, "`${1}$Version`${2}", 1)
[IO.File]::WriteAllText($manifest, $text, $utf8)

Write-Host "Version set to $Version (VERSION, vscode-extension/package.json)" -ForegroundColor Green
Write-Host "Also add a '## $Version' section to vscode-extension/CHANGELOG.md" -ForegroundColor Yellow
