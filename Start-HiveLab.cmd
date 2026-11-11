@echo off
setlocal
set ELECTRON_RUN_AS_NODE=
rem npm run deploy updates the desktop folder; the installer defaults to LOCALAPPDATA\Programs.
set "HIVELAB_INSTALLED="
for %%D in ("%~dp0..\runtime" "%HIVELAB_RUNTIME_DIR%" "%USERPROFILE%\Desktop\HiveLab" "%OneDrive%\Desktop\HiveLab" "%LOCALAPPDATA%\Programs\HiveLab" "%USERPROFILE%\HiveLab") do (
  if not defined HIVELAB_INSTALLED if exist "%%~D\HiveLab.exe" set "HIVELAB_INSTALLED=%%~D"
)
if not defined HIVELAB_INSTALLED (
  if exist "%~dp0Start-HiveLab-Dev.cmd" (
    call "%~dp0Start-HiveLab-Dev.cmd"
    exit /b
  )
  echo HiveLab desktop installation was not found. Please install HiveLab first.
  pause
  exit /b 1
)
if not defined HIVELAB_DATA_DIR set "HIVELAB_DATA_DIR=%USERPROFILE%\.hivelab\data"
set "TEMP=%HIVELAB_INSTALLED%\launch-temp"
set "TMP=%TEMP%"
if not exist "%TEMP%" mkdir "%TEMP%"
start "" /d "%HIVELAB_INSTALLED%" "%HIVELAB_INSTALLED%\HiveLab.exe"
exit /b 0
