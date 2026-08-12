param(
  [string]$ChromePath = '',
  [int]$DebugPort = 9333,
  [int]$Retries = 1,
  [string]$ScreenshotDir = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $ScreenshotDir) {
  $ScreenshotDir = Join-Path $env:TEMP ('draftpulse_browser_verify_screenshots_' + [guid]::NewGuid().ToString('N'))
}
New-Item -ItemType Directory -Path $ScreenshotDir -Force | Out-Null

if (-not $ChromePath) {
  $candidates = @(
    (Join-Path $env:TEMP 'draftpulse_cft119\chrome-win64\chrome.exe'),
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  $ChromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $ChromePath -or -not (Test-Path -LiteralPath $ChromePath)) {
  Write-Error '未找到 Chrome/Edge 可执行文件。'
  exit 2
}

function Invoke-BrowserVerify {
  $profile = Join-Path $env:TEMP ('draftpulse_chrome_profile_' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $profile | Out-Null

  $args = @(
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--start-minimized',
    "--remote-debugging-port=$DebugPort",
    "--user-data-dir=$profile",
    "--load-extension=$root",
    'about:blank'
  )

  $env:CHROME_DEBUG_PORT = [string]$DebugPort
  $env:EXPECTED_EXTENSION_VERSION = (Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
  $env:DRAFTPULSE_SCREENSHOT_DIR = $ScreenshotDir

  $process = Start-Process -FilePath $ChromePath -ArgumentList $args -WindowStyle Hidden -PassThru
  try {
    & node (Join-Path $PSScriptRoot 'browser_verify.js') | ForEach-Object { Write-Host $_ }
    $script:verifyExitCode = $LASTEXITCODE
  } finally {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 300
    Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$attempt = 0
do {
  $attempt += 1
  Invoke-BrowserVerify
  $code = $script:verifyExitCode
  if ($code -eq 0) { exit 0 }
  if ($attempt -le $Retries) {
    Write-Host "browser_verify 第 $attempt 次失败（exit=$code），等待 5 秒后重试…"
    Start-Sleep -Seconds 5
  }
} while ($attempt -le $Retries)

exit 1
