@echo off
setlocal
if not defined __MAVIS_ALRAN_TOOLS_RUNTIME_EXECUTABLE (
  echo Alran alran-tools runtime is unavailable. Restart Alran. 1>&2
  exit /b 1
)
"%__MAVIS_ALRAN_TOOLS_RUNTIME_EXECUTABLE%" "%~dp0..\alran-tools.js" %*
exit /b %errorlevel%
