$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskManifest = Get-Content -Raw -LiteralPath (Join-Path $taskRoot 'manifest.json') | ConvertFrom-Json
$taskStage = Join-Path ([System.IO.Path]::GetTempPath()) ('xmd-free-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $taskStage 'src') -Force | Out-Null
$taskRuntimeFiles = @(
    'background.js', 'content.js', 'content.css', 'markdown.js',
    'export.js', 'popup.html', 'popup.css', 'popup.js', 'popup-layout.js'
)
foreach ($taskFile in $taskRuntimeFiles) {
    Copy-Item -LiteralPath (Join-Path $taskRoot ('src/' + $taskFile)) -Destination (Join-Path $taskStage 'src')
}
foreach ($taskFile in @('manifest.json', 'README.md', 'DESIGN.md')) {
    Copy-Item -LiteralPath (Join-Path $taskRoot $taskFile) -Destination $taskStage
}
Copy-Item -LiteralPath (Join-Path $taskRoot 'assets') -Destination $taskStage -Recurse
$taskZip = Join-Path (Split-Path -Parent $taskRoot) ('x-post-markdown-v' + $taskManifest.version + '-free.zip')
Compress-Archive -Path (Join-Path $taskStage '*') -DestinationPath $taskZip -Force
Write-Output ('Release: ' + $taskZip)
Write-Output ('Unpacked: ' + $taskStage)
