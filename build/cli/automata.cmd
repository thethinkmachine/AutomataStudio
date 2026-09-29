@echo off
rem The automata command line, run by the desktop app's own executable as Node
rem (the way VS Code ships `code`). Put this folder on PATH to use `automata`.
rem The layout is electron-builder's: <install>\resources\cli\automata.cmd,
rem <install>\AutomataStudio.exe, and the CLI unpacked beside app.asar.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\AutomataStudio.exe" "%~dp0..\app.asar.unpacked\dist-cli\automata.mjs" %*
exit /b %ERRORLEVEL%
