$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskManifest = Get-Content -Raw -LiteralPath (Join-Path $taskRoot 'manifest.json') | ConvertFrom-Json
$taskStage = Join-Path ([System.IO.Path]::GetTempPath()) ('xmd-store-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $taskStage 'src') -Force | Out-Null
foreach ($taskFile in @('background.js','content.js','content.css','markdown.js','export.js',
    'popup.html','popup.css','popup.js','popup-layout.js')) {
    Copy-Item -LiteralPath (Join-Path $taskRoot ('src/' + $taskFile)) -Destination (Join-Path $taskStage 'src')
}
foreach ($taskFile in @('manifest.json','PRIVACY.md')) {
    Copy-Item -LiteralPath (Join-Path $taskRoot $taskFile) -Destination $taskStage
}
Copy-Item -LiteralPath (Join-Path $taskRoot 'assets') -Destination $taskStage -Recurse
$taskZip = Join-Path (Split-Path -Parent $taskRoot) ('x-post-markdown-webstore-v' + $taskManifest.version + '.zip')
Compress-Archive -Path (Join-Path $taskStage '*') -DestinationPath $taskZip -Force
Write-Output ('Release: ' + $taskZip)
Write-Output ('Unpacked: ' + $taskStage)
