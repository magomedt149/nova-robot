param(
  [switch]$SkipApps,
  [switch]$NoFunnel
)

$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$HomeDir = Join-Path $env:LOCALAPPDATA "NOVA-GPU"
$Venv = Join-Path $HomeDir "venv"
$Python = Join-Path $Venv "Scripts\python.exe"
$Supervisor = Join-Path $Repo "automation\permanent_gpu_worker.py"
$TaskName = "NOVA GPU Worker"

New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null

function Has-Cmd($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Winget-Install($id) {
  if (-not (Has-Cmd "winget")) { return $false }
  try {
    winget install --id $id -e --accept-package-agreements --accept-source-agreements --silent | Out-Host
    return $true
  } catch {
    return $false
  }
}

if (-not $SkipApps) {
  if (-not (Has-Cmd "python")) {
    Write-Host "Installing Python..." -ForegroundColor Cyan
    Winget-Install "Python.Python.3.12" | Out-Null
    $env:Path += ";$env:LOCALAPPDATA\Programs\Python\Python312;$env:LOCALAPPDATA\Programs\Python\Python312\Scripts"
  }
  if (-not (Has-Cmd "ffmpeg")) {
    Write-Host "Installing FFmpeg..." -ForegroundColor Cyan
    Winget-Install "Gyan.FFmpeg" | Out-Null
  }
  if (-not (Has-Cmd "blender")) {
    Write-Host "Installing Blender..." -ForegroundColor Cyan
    Winget-Install "BlenderFoundation.Blender" | Out-Null
  }
  if (-not (Has-Cmd "tailscale")) {
    Write-Host "Installing Tailscale..." -ForegroundColor Cyan
    Winget-Install "Tailscale.Tailscale" | Out-Null
  }
}

if (-not (Has-Cmd "python")) {
  throw "Python not found. Install Python 3.11+ and run this installer again."
}

if (-not (Test-Path $Python)) {
  python -m venv $Venv
}
& $Python -m pip install --upgrade pip
& $Python -m pip install fastapi uvicorn python-multipart mediapipe opencv-python-headless

if ((Has-Cmd "tailscale") -and -not $NoFunnel) {
  $status = ""
  try { $status = (tailscale status 2>&1 | Out-String) } catch {}
  if ($status -match "Logged out|not logged|NeedsLogin") {
    Write-Host ""
    Write-Host "ONE-TIME TAILSCALE LOGIN REQUIRED" -ForegroundColor Yellow
    Write-Host "Sign in once. No Colab Run all will be needed later." -ForegroundColor Yellow
    tailscale up
  }
  try {
    tailscale funnel --bg 7861 | Out-Host
  } catch {
    Write-Host "Tailscale Funnel is not enabled yet. The worker will still run locally." -ForegroundColor Yellow
  }
}

$QuotedSupervisor = '"' + $Supervisor + '"'
$QuotedHome = '"' + $HomeDir + '"'
$Args = $QuotedSupervisor + " --home " + $QuotedHome
if ($NoFunnel) { $Args += " --no-funnel" }

$Action = New-ScheduledTaskAction -Execute $Python -Argument $Args -WorkingDirectory $Repo
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
try {
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Permanent NOVA GPU Worker" -Force | Out-Null
} catch {
  Write-Host "Could not register Scheduled Task with current permissions; starting worker for this session." -ForegroundColor Yellow
}

Start-Process -FilePath $Python -ArgumentList $Args -WorkingDirectory $Repo -WindowStyle Hidden
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host "NOVA PERMANENT GPU WORKER STARTED" -ForegroundColor Green
Write-Host "No Colab. No Run all. Starts automatically." -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Write-Host ""
$CodePath = Join-Path $HomeDir "NOVA_CONNECT_CODE.txt"
if (Test-Path $CodePath) {
  Write-Host "Paste this once into NOVA > Heavy AI / Permanent GPU:" -ForegroundColor Cyan
  Get-Content $CodePath | Out-Host
} else {
  Write-Host "Worker is starting. If Funnel is enabled, the connect code will appear in:" -ForegroundColor Cyan
  Write-Host $CodePath
}
