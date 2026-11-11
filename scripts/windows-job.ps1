param([string]$Configuration,[string]$ConfigurationFile)
$ErrorActionPreference = 'Stop'

try {
  $assembly = Join-Path $PSScriptRoot 'windows-job.dll'
  if (-not (Test-Path -LiteralPath $assembly)) { $assembly = Join-Path $PSScriptRoot '..\dist\windows-job.dll' }
  if (-not (Test-Path -LiteralPath $assembly)) { throw 'Missing precompiled process guard. Run npm run build.' }
  # Load the build-owned assembly as bytes; CLR LoadFrom rejects low-integrity
  # development paths even when the process may read them. No runtime compilation.
  [void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes($assembly))
  # Long launch specs arrive through a file: the base64 payload would otherwise
  # exceed the Windows command-line limit once the spec is encoded.
  if (-not $Configuration -and $ConfigurationFile) { $Configuration = (Get-Content -LiteralPath $ConfigurationFile -Raw).Trim() }
  if (-not $Configuration) { throw 'Missing job configuration.' }
  $spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Configuration)) | ConvertFrom-Json
  $result = [HiveLabWindowsJob]::Run([string]$spec.command,[string[]]$spec.args,[string]$spec.cwd,[uint32]$spec.parentPid)
  exit $result
} catch {
  [Console]::Error.WriteLine('[HiveLab process guard] ' + $_.Exception.Message)
  exit 125
}
