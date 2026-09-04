param(
  [switch]$SkipApps,
  [switch]$NoFunnel,
  [switch]$SkipWanGP
)

$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$HomeDir = Join-Path $env:LOCALAPPDATA "NOVA-GPU"
$WanRoot = Join-Path $HomeDir "Wan2GP"
$BootstrapVenv = Join-Path $HomeDir "bootstrap-venv"
$BootstrapPython = Join-Path $BootstrapVenv "Scripts\python.exe"
$Supervisor = Join-Path $Repo "automation\permanent_gpu_worker.py"
$TaskName = "NOVA GPU Worker"

New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null

function Has-Cmd($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Winget-Install($id) {
  if (-not (Has-Cmd "winget")) { return $false }
  try {
    winget install --id $id -e --accept-package-agreements --accept-source-agreements --silent | Out-Host
    return $true
  } catch { return $false }
}

if (-not $SkipApps) {
  if (-not (Has-Cmd "git")) { Winget-Install "Git.Git" | Out-Null }
  if (-not (Has-Cmd "python")) { Winget-Install "Python.Python.3.11" | Out-Null }
  if (-not (Has-Cmd "ffmpeg")) { Winget-Install "Gyan.FFmpeg" | Out-Null }
  if (-not (Has-Cmd "blender")) { Winget-Install "BlenderFoundation.Blender" | Out-Null }
  if (-not (Has-Cmd "tailscale")) { Winget-Install "Tailscale.Tailscale" | Out-Null }
}

$env:Path += ";$env:LOCALAPPDATA\Microsoft\WinGet\Links;C:\Program Files\Git\cmd;C:\Program Files\Tailscale"

if (-not (Has-Cmd "python")) { throw "Python 3.11+ not found." }
if (-not (Has-Cmd "git")) { throw "Git not found." }

$WorkerPython = $null

if (-not $SkipWanGP) {
  if (-not (Test-Path (Join-Path $WanRoot ".git"))) {
    Write-Host "Cloning official WanGP..." -ForegroundColor Cyan
    git clone --depth 1 https://github.com/deepbeepmeep/Wan2GP.git $WanRoot
  } else {
    Write-Host "Updating official WanGP..." -ForegroundColor Cyan
    git -C $WanRoot pull --ff-only
  }

  Write-Host "Installing WanGP automatically for this GPU. This is the long one-time step..." -ForegroundColor Cyan
  Push-Location $WanRoot
  try {
    python setup.py install --env venv --auto
    $info = (python setup.py get_env_info 2>$null | Out-String)
    $line = ($info -split "`r?`n" | Where-Object { $_ -like "ENV_INFO|*" } | Select-Object -First 1)
    if ($line) {
      $parts = $line -split "\|"
      if ($parts.Count -ge 3) {
        $EnvPath = $parts[2].Trim()
        $candidate = Join-Path $EnvPath "Scripts\python.exe"
        if (Test-Path $candidate) { $WorkerPython = $candidate }
      }
    }
  } finally { Pop-Location }
}

if (-not $WorkerPython) {
  if (-not (Test-Path $BootstrapPython)) { python -m venv $BootstrapVenv }
  $WorkerPython = $BootstrapPython
}

& $WorkerPython -m pip install --upgrade pip
& $WorkerPython -m pip install fastapi uvicorn python-multipart mediapipe opencv-python-headless

if ((Has-Cmd "tailscale") -and -not $NoFunnel) {
  $status = ""
  try { $status = (tailscale status 2>&1 | Out-String) } catch {}
  if ($status -match "Logged out|not logged|NeedsLogin") {
    Write-Host ""
    Write-Host "ONE-TIME TAILSCALE LOGIN" -ForegroundColor Yellow
    Write-Host "Sign in once. After this there is no Colab and no Run all." -ForegroundColor Yellow
    tailscale up
  }
  try { tailscale funnel --bg --yes 7861 | Out-Host } catch {
    Write-Host "Funnel needs one-time approval in Tailscale. Worker will still start locally." -ForegroundColor Yellow
  }
}

$QuotedSupervisor = '"' + $Supervisor + '"'
$QuotedHome = '"' + $HomeDir + '"'
$Args = $QuotedSupervisor + " --home " + $QuotedHome
if ($NoFunnel) { $Args += " --no-funnel" }

$Action = New-ScheduledTaskAction -Execute $WorkerPython -Argument $Args -WorkingDirectory $Repo
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
try {
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Permanent NOVA GPU Worker" -Force | Out-Null
} catch {
  Write-Host "Scheduled Task could not be registered with current permissions. Starting worker now anyway." -ForegroundColor Yellow
}

Start-Process -FilePath $WorkerPython -ArgumentList $Args -WorkingDirectory $Repo -WindowStyle Hidden
Start-Sleep -Seconds 7

Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host "NOVA PERMANENT GPU WORKER STARTED" -ForegroundColor Green
Write-Host "WanGP + Blender + FFmpeg. No Colab. No Run all." -ForegroundColor Green
Write-Host "It starts automatically with Windows." -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""
$CodePath = Join-Path $HomeDir "NOVA_CONNECT_CODE.txt"
if (Test-Path $CodePath) {
  Write-Host "Paste this code into NOVA once:" -ForegroundColor Cyan
  Get-Content $CodePath | Out-Host
  try { Set-Clipboard -Value (Get-Content $CodePath -Raw) } catch {}
  Write-Host "The code was also copied to the clipboard." -ForegroundColor Cyan
} else {
  Write-Host "Worker started. Connect code will appear at:" -ForegroundColor Cyan
  Write-Host $CodePath
}
