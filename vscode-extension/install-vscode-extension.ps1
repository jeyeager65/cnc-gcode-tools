# install-vscode-extension.ps1
# Copies the CNC GCode Tools for FluidNC extension into VS Code's extensions
# directory so it loads automatically next time VS Code starts.
# Run from the repo root:  .\vscode-extension\install-vscode-extension.ps1

$SourceDir     = Join-Path $PSScriptRoot "."     # the vscode-extension/ folder itself
$Manifest      = Get-Content (Join-Path $SourceDir "package.json") -Raw | ConvertFrom-Json
$ExtensionId   = "$($Manifest.publisher).$($Manifest.name)"
$ExtensionName = "$ExtensionId-$($Manifest.version)"
$ExtensionsDir = Join-Path $env:USERPROFILE ".vscode\extensions"
$TargetDir     = Join-Path $ExtensionsDir $ExtensionName

Write-Host "`nCNC GCode Tools for FluidNC - VS Code Extension Installer" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

# Confirm VS Code extensions directory exists
if (-not (Test-Path $ExtensionsDir)) {
    Write-Host "VS Code extensions directory not found at: $ExtensionsDir" -ForegroundColor Red
    Write-Host "Is VS Code installed? Exiting." -ForegroundColor Red
    exit 1
}

# Remove previous installations, including ones installed under an older version number
Get-ChildItem $ExtensionsDir -Directory -Filter "$ExtensionId-*" | ForEach-Object {
    Write-Host "Removing previous installation at $($_.FullName) ..." -ForegroundColor Yellow
    Remove-Item $_.FullName -Recurse -Force
}

# Copy extension files
Write-Host "Installing to $TargetDir ..." -ForegroundColor Cyan
Copy-Item -Path $SourceDir -Destination $TargetDir -Recurse -Force

# Copy viewer JS/CSS from src/ into the installed extension's viewer/ subfolder
$SrcJsDir  = Join-Path $PSScriptRoot "..\src\js"
$SrcCssDir = Join-Path $PSScriptRoot "..\src\css"
$ViewerDir = Join-Path $TargetDir "viewer"
New-Item -ItemType Directory -Force -Path $ViewerDir | Out-Null
'gcode-expander.js','parser.js','camera.js','renderer2d.js','renderer3d.js','animator.js','controller.js' | ForEach-Object {
    Copy-Item (Join-Path $SrcJsDir $_) $ViewerDir -Force
}
Copy-Item (Join-Path $SrcCssDir "common.css") $ViewerDir -Force
Write-Host "Copied viewer files to: $ViewerDir" -ForegroundColor Cyan

Write-Host "`nInstalled successfully!" -ForegroundColor Green
Write-Host "Restart VS Code (or run 'Developer: Reload Window') to activate." -ForegroundColor Green
Write-Host ""
Write-Host "To use the matching color theme:" -ForegroundColor Cyan
Write-Host "  Ctrl+K Ctrl+T  ->  select 'CNC GCode Dark' or 'CNC GCode Light'" -ForegroundColor White
Write-Host ""
Write-Host "To uninstall, delete: $TargetDir" -ForegroundColor DarkGray
