[CmdletBinding()]
param(
    [string]$ComfyRoot = $env:COMFY_ROOT,
    [switch]$SkipComfyStart
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$localConfig = Join-Path $root 'local-comfy/settings.local.psd1'
$settings = if (Test-Path -LiteralPath $localConfig) { Import-PowerShellDataFile -LiteralPath $localConfig } else { @{} }
if (!$ComfyRoot) { $ComfyRoot = $settings.ComfyRoot }
$logs = Join-Path $root 'local-comfy/logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$nodeExe = (Get-Command node.exe).Source
if (!$env:PUBLIC_BASE_URL) { $env:PUBLIC_BASE_URL = 'http://127.0.0.1:5679' }
if (!$env:FFMPEG_BIN) { $env:FFMPEG_BIN = (Get-Command ffmpeg.exe).Source }
if (!$env:FFPROBE_BIN) { $env:FFPROBE_BIN = (Get-Command ffprobe.exe).Source }

function Start-LocalService($Name, $Port, $Directory, $Arguments) {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        Write-Host "$Name already listening on $Port"
        return
    }
    $p = Start-Process -FilePath $nodeExe -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs "$Name.stdout.log") -RedirectStandardError (Join-Path $logs "$Name.stderr.log")
    Write-Host "$Name started (PID $($p.Id), port $Port)"
}

if (!$SkipComfyStart -and !(Get-NetTCPConnection -State Listen -LocalPort 8188 -ErrorAction SilentlyContinue)) {
    if (!$ComfyRoot -or !(Test-Path -LiteralPath (Join-Path $ComfyRoot 'python_embeded/python.exe'))) {
        throw 'Set COMFY_ROOT or local-comfy/settings.local.psd1 to your ComfyUI portable directory, or use -SkipComfyStart with an existing ComfyUI server.'
    }
    $comfyArguments = '-s ComfyUI/main.py --windows-standalone-build --disable-auto-launch --listen 127.0.0.1 --port 8188'
    foreach ($kind in @('Input', 'Output', 'Temp')) {
        $directory = $settings["Comfy${kind}Directory"]
        if ($directory) {
            if ($directory.Contains('"')) { throw "Invalid ComfyUI $kind directory" }
            $comfyArguments += ' --' + $kind.ToLowerInvariant() + '-directory "' + $directory + '"'
        }
    }
    Start-Process -FilePath (Join-Path $ComfyRoot 'python_embeded/python.exe') -ArgumentList $comfyArguments -WorkingDirectory $ComfyRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'comfy.stdout.log') -RedirectStandardError (Join-Path $logs 'comfy.stderr.log') | Out-Null
}
$bridgePort = if ($env:H3_BRIDGE_PORT) { [int]$env:H3_BRIDGE_PORT } else { 8189 }
Start-LocalService 'h3-bridge' $bridgePort $root 'local-comfy/bridge.mjs'
Start-LocalService 'backend' 5679 (Join-Path $root 'backend') '--import tsx src/index.ts'
Start-LocalService 'frontend' 3013 (Join-Path $root 'frontend') 'node_modules/nuxt/bin/nuxt.mjs dev --host 127.0.0.1 --port 3013'
Write-Host 'Huobao Drama: http://localhost:3013'
