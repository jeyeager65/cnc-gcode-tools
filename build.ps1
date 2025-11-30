# Build script for GCode Visualizer
# Minifies and compresses the source files

Write-Host "Building GCode Visualizer..." -ForegroundColor Cyan

# Create dist directory
$distDir = "dist"
if (Test-Path $distDir) {
    Remove-Item $distDir -Recurse -Force
}
New-Item -ItemType Directory -Path $distDir | Out-Null

# Check if terser is installed
$terserInstalled = $null -ne (Get-Command terser -ErrorAction SilentlyContinue)
if (-not $terserInstalled) {
    Write-Host "Terser not found. Installing..." -ForegroundColor Yellow
    npm install -g terser
}

# Version from git or default
$version = "dev"
try {
    $gitTag = git describe --tags --abbrev=0 2>$null
    if ($gitTag) {
        $version = $gitTag
    }
} catch {
    Write-Host "No git tags found, using version: $version" -ForegroundColor Yellow
}

Write-Host "Version: $version" -ForegroundColor Green

# Build configurations
$builds = @(
    @{
        Name = "FluidNC Extension"
        SourceHtml = "src/fluidnc.html"
        OutputName = "gcodeviewer"
        JsFiles = @(
            "src/js/fluidnc-api.js",
            "src/js/parser.js",
            "src/js/camera.js",
            "src/js/renderer2d.js",
            "src/js/renderer3d.js",
            "src/js/animator.js",
            "src/js/controller.js",
            "src/js/fluidnc-controller.js"
        )
        ScriptTags = @"
    <script src="js/fluidnc-api.js"></script>
    <script src="js/parser.js"></script>
    <script src="js/camera.js"></script>
    <script src="js/renderer2d.js"></script>
    <script src="js/renderer3d.js"></script>
    <script src="js/animator.js"></script>
    <script src="js/controller.js"></script>
    <script src="js/fluidnc-controller.js"></script>
"@
    },
    @{
        Name = "Standalone Version"
        SourceHtml = "src/index.html"
        OutputName = "standalone"
        JsFiles = @(
            "src/js/parser.js",
            "src/js/camera.js",
            "src/js/renderer2d.js",
            "src/js/renderer3d.js",
            "src/js/animator.js",
            "src/js/controller.js"
        )
        ScriptTags = @"
    <script src="js/parser.js"></script>
    <script src="js/camera.js"></script>
    <script src="js/renderer2d.js"></script>
    <script src="js/renderer3d.js"></script>
    <script src="js/animator.js"></script>
    <script src="js/controller.js"></script>
"@
    }
)

foreach ($build in $builds) {
    Write-Host "`nBuilding $($build.Name)..." -ForegroundColor Cyan
    
    # Copy and process HTML
    Write-Host "Processing HTML..." -ForegroundColor Cyan
    $html = Get-Content $build.SourceHtml -Raw
    $html = $html -replace '{{VERSION}}', $version

    # Inline CSS
    Write-Host "Inlining CSS..." -ForegroundColor Cyan
    
    # Inline common.css
    $commonCssFile = "src/css/common.css"
    if (Test-Path $commonCssFile) {
        $cssContent = Get-Content $commonCssFile -Raw
        # Remove CSS comments
        $cssContent = $cssContent -replace '/\*[\s\S]*?\*/', ''
        # Remove extra whitespace
        $cssContent = $cssContent -replace '\s+', ' ' -replace '\s*([{}:;,])\s*', '$1'
        $cssLink = '<link rel="stylesheet" href="css/common.css">'
        $inlineStyle = "<style>$cssContent</style>"
        $html = $html -replace [regex]::Escape($cssLink), $inlineStyle
    }
    
    # Inline fluidnc.css if it exists in the HTML
    $fluidncCssFile = "src/css/fluidnc.css"
    if (Test-Path $fluidncCssFile) {
        $fluidncCssContent = Get-Content $fluidncCssFile -Raw
        # Remove CSS comments
        $fluidncCssContent = $fluidncCssContent -replace '/\*[\s\S]*?\*/', ''
        # Remove extra whitespace
        $fluidncCssContent = $fluidncCssContent -replace '\s+', ' ' -replace '\s*([{}:;,])\s*', '$1'
        $fluidncCssLink = '<link rel="stylesheet" href="css/fluidnc.css">'
        if ($html -match [regex]::Escape($fluidncCssLink)) {
            $inlineFluidncStyle = "<style>$fluidncCssContent</style>"
            $html = $html -replace [regex]::Escape($fluidncCssLink), $inlineFluidncStyle
        }
    }

    # Inline and minify JavaScript
    Write-Host "Minifying JavaScript..." -ForegroundColor Cyan
    
    $tempCombined = "dist/temp_combined_$($build.OutputName).js"
    $combinedContent = ""
    foreach ($file in $build.JsFiles) {
        if (Test-Path $file) {
            $combinedContent += Get-Content $file -Raw
            $combinedContent += "`n`n"
        }
    }
    Set-Content -Path $tempCombined -Value $combinedContent

    # Minify combined JS
    $minJsFile = "dist/$($build.OutputName).min.js"
    terser $tempCombined --compress passes=3 --mangle --output $minJsFile
    Remove-Item $tempCombined

    $minifiedJs = Get-Content $minJsFile -Raw

    # Replace script tags with inline minified JS
    $inlineScript = "<script>$minifiedJs</script>"
    $html = $html -replace [regex]::Escape($build.ScriptTags), $inlineScript

    # Minify HTML - remove comments and extra whitespace
    $html = $html -replace '<!--[\s\S]*?-->', ''
    $html = $html -replace '>\s+<', '><'
    $html = $html -replace '\s{2,}', ' '

    # Save final HTML
    $outputHtml = "dist/$($build.OutputName).html"
    Set-Content -Path $outputHtml -Value $html

    # Calculate sizes
    $originalSize = 0
    foreach ($file in $build.JsFiles) {
        if (Test-Path $file) {
            $originalSize += (Get-Item $file).Length
        }
    }
    $originalSize += (Get-Item $build.SourceHtml).Length

    $minifiedSize = (Get-Item $outputHtml).Length

    # Compress with gzip
    Write-Host "Compressing with gzip..." -ForegroundColor Cyan
    $compressedFile = "$outputHtml.gz"

    $fileStream = [System.IO.File]::OpenRead($outputHtml)
    $outputStream = [System.IO.File]::Create($compressedFile)
    $gzipStream = New-Object System.IO.Compression.GZipStream($outputStream, [System.IO.Compression.CompressionMode]::Compress)

    $fileStream.CopyTo($gzipStream)

    $gzipStream.Close()
    $outputStream.Close()
    $fileStream.Close()

    $gzipSize = (Get-Item $compressedFile).Length
    $compressionRatio = [math]::Round(($gzipSize / $minifiedSize) * 100, 2)

    # Report
    Write-Host "`n$($build.Name) Build Complete!" -ForegroundColor Green
    Write-Host "  Output: $outputHtml" -ForegroundColor Yellow
    Write-Host "  Original size: $([math]::Round($originalSize/1KB, 2)) KB"
    Write-Host "  Minified size: $([math]::Round($minifiedSize/1KB, 2)) KB"
    Write-Host "  Compressed size: $([math]::Round($gzipSize/1KB, 2)) KB (gzip)"
    Write-Host "  Compression ratio: $compressionRatio%"

    # Clean up temp file
    Remove-Item $minJsFile -ErrorAction SilentlyContinue
}

Write-Host "`nAll builds completed successfully!" -ForegroundColor Green

# Create .nojekyll file for GitHub Pages
Write-Host "Creating .nojekyll file..." -ForegroundColor Cyan
New-Item -Path "dist/.nojekyll" -ItemType File -Force | Out-Null

# Copy standalone.html to index.html for GitHub Pages
Write-Host "Creating index.html for GitHub Pages..." -ForegroundColor Cyan
Copy-Item -Path "dist/standalone.html" -Destination "dist/index.html"
