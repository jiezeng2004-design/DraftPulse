param(
  [string]$ZipPath = '',
  [switch]$IncludeBrowserVerify
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $ZipPath) {
  $ZipPath = Join-Path (Split-Path -Parent $root) 'draftpulse_v2.0.zip'
}
$log = Join-Path $root 'test.log'
if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }

function Log([string]$text) {
  Add-Content -LiteralPath $log -Value $text
  Write-Host $text
}

$allOk = $true
Log '== DraftPulse v2.0 verification =='
Log ("run at: " + (Get-Date -Format o))
Log ("node: " + (node --version))
Log ("workdir: " + $root)

Log ''
Log '-- 1. syntax check: node --check (all JS) --'
$jsFiles = Get-ChildItem -LiteralPath $root -Recurse -Filter *.js
foreach ($file in $jsFiles) {
  node --check $file.FullName 2>&1 | ForEach-Object { Log ("    " + $_) }
  $code = $LASTEXITCODE
  Log ("node --check " + $file.FullName.Substring($root.Length + 1) + " exit=" + $code)
  if ($code -ne 0) { $allOk = $false }
}

Log ''
Log '-- 1b. powershell syntax parse --'
$psFiles = Get-ChildItem -LiteralPath $root -Recurse -Filter *.ps1
foreach ($file in $psFiles) {
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) {
    foreach ($parseError in $parseErrors) {
      Log ("    " + $file.Name + " 语法错误: " + $parseError.Message)
    }
    $allOk = $false
  } else {
    Log ("PS parse " + $file.FullName.Substring($root.Length + 1) + " errors=0 PASS")
  }
}

Log ''
Log '-- 2. unit tests: node tests/run_tests.js --'
$testOutput = & node (Join-Path $root 'tests\run_tests.js') 2>&1
$testCode = $LASTEXITCODE
$testOutput | ForEach-Object { Log ("    " + $_) }
Log ("node tests/run_tests.js exit=" + $testCode)
if ($testCode -ne 0) { $allOk = $false }

Log ''
Log '-- 3. manifest JSON parse --'
$jsonOutput = & node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log('manifest JSON OK, version=' + JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version)" (Join-Path $root 'manifest.json') 2>&1
$jsonCode = $LASTEXITCODE
$jsonOutput | ForEach-Object { Log ("    " + $_) }
Log ("manifest parse exit=" + $jsonCode)
if ($jsonCode -ne 0) { $allOk = $false }

Log ''
Log '-- 4. forbidden patterns: eval( / new Function / http:// --'
foreach ($pattern in @('eval\s*\(', 'new\s+Function', 'http://')) {
  $hits = rg -n $pattern $root --glob '*.js' --glob '*.html' --glob '*.json' --glob '!**/tests/**' --glob '!**/tools/**' --glob '!*.log' 2>&1
  $code = $LASTEXITCODE
  if ($code -eq 1) {
    Log ("rg '" + $pattern + "' exit=1 (no matches) PASS")
  } else {
    Log ("rg '" + $pattern + "' exit=" + $code + " (found matches)")
    $hits | ForEach-Object { Log ("    " + $_) }
    $allOk = $false
  }
}

Log ''
Log '-- 5. zip integrity --'
if ($ZipPath -and (Test-Path -LiteralPath $ZipPath)) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  Log ("zip: " + $ZipPath)
  Log ("zip entries: " + $zip.Entries.Count)
  $temp = Join-Path $env:TEMP ('draftpulse_zip_check_' + [guid]::NewGuid().ToString('N'))
  [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $temp)
  $mismatches = @()
  foreach ($entry in $zip.Entries) {
    $rel = $entry.FullName -replace '^draftpulse_v\d+\.\d+\.\d+[/\\]?', ''
    if (-not $rel) { continue }
    $source = Join-Path $root $rel
    $extracted = Join-Path $temp $entry.FullName
    if (-not (Test-Path -LiteralPath $source)) {
      $mismatches += ("source missing: " + $rel)
      continue
    }
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $extractedHash = (Get-FileHash -LiteralPath $extracted -Algorithm SHA256).Hash
    if ($sourceHash -ne $extractedHash) {
      $mismatches += ("hash mismatch: " + $rel)
    }
  }
  $zip.Dispose()
  if ($mismatches.Count -gt 0) {
    $mismatches | ForEach-Object { Log ("    " + $_) }
    $allOk = $false
  } else {
    Log 'all zip entries match source SHA-256'
  }
  Remove-Item -LiteralPath $temp -Recurse -Force
  $zipHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash
  Log ("SHA-256: " + $zipHash)
} else {
  Log 'zip not found, skipped'
  $allOk = $false
}

Log ''
if ($IncludeBrowserVerify) {
  Log '-- 6. real browser verification (Chrome for Testing 119) --'
  $verifyScript = Join-Path $root 'tools\browser_verify.ps1'
  $cftChrome = Join-Path $env:TEMP 'draftpulse_cft119\chrome-win64\chrome.exe'
  if (Test-Path -LiteralPath $cftChrome) {
    & $verifyScript 2>&1 | ForEach-Object { Log ("    " + $_) }
    Log ("browser_verify exit=" + $LASTEXITCODE)
    if ($LASTEXITCODE -ne 0) { $allOk = $false }
  } else {
    Log 'Chrome for Testing 119 不存在，浏览器验证跳过（下载地址见 README）'
  }
  Log ''
}

if ($allOk) {
  Log 'RESULT: PASS'
  exit 0
} else {
  Log 'RESULT: FAIL'
  exit 1
}
