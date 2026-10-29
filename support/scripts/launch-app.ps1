param(
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$url = "http://localhost:3000"
$probeUrl = "http://127.0.0.1:3000"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$runner = Join-Path $PSScriptRoot "dev-with-media.mjs"
$logDir = Join-Path $root ".runtime"
$stdoutLog = Join-Path $logDir "content-flow.out.log"
$stderrLog = Join-Path $logDir "content-flow.err.log"

function Test-ContentFlowReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $probeUrl -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500 -and $response.Content -match "Content Flow"
  } catch {
    return $false
  }
}

function Open-ContentFlow {
  if (-not $NoOpen) { Start-Process $url }
}

if (Test-ContentFlowReady) {
  Open-ContentFlow
  exit 0
}

if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "Khong tim thay Node.js tai $nodeExe. Hay cai Node.js LTS roi mo lai Run_App.bat."
}

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
  Write-Host "Dang cai dat thu vien lan dau..."
  & "C:\Program Files\nodejs\npm.cmd" install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "Khong cai dat duoc thu vien cua app." }
}

if (-not (Test-Path -LiteralPath (Join-Path $root "dist\server\index.js"))) {
  Write-Host "Dang chuan bi ban chay lan dau..."
  & "C:\Program Files\nodejs\npm.cmd" run build
  if ($LASTEXITCODE -ne 0) { throw "Khong build duoc app." }
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Content -LiteralPath $stdoutLog -Value ""
Set-Content -LiteralPath $stderrLog -Value ""
Write-Host "Content Flow dang khoi dong..."
$process = Start-Process -FilePath $nodeExe -ArgumentList "`"$runner`" start" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru

for ($attempt = 1; $attempt -le 100; $attempt += 1) {
  if (Test-ContentFlowReady) {
    Open-ContentFlow
    exit 0
  }
  if ($process.HasExited) {
    $details = (Get-Content -LiteralPath $stderrLog -Raw -ErrorAction SilentlyContinue).Trim()
    if (-not $details) { $details = (Get-Content -LiteralPath $stdoutLog -Raw -ErrorAction SilentlyContinue).Trim() }
    throw "Content Flow khong khoi dong duoc. $details"
  }
  Start-Sleep -Milliseconds 200
}

throw "Content Flow khoi dong qua lau. Kiem tra log tai $stderrLog"
