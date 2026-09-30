; Windows installer hooks (electron-builder's NSIS include, package.json build.nsis.include).
;
; Puts the `automata` command line on the user's PATH: install adds
; $INSTDIR\resources\cli (which holds automata.cmd) and uninstall takes it off.
; The editing is done by resources\cli-path.ps1 rather than in NSIS, whose
; strings stop at 1024 characters, so a long PATH read into one would come back
; truncated and the user would lose entries.
;
; The install is per-user (one-click), so this is the user's PATH, in HKCU, and
; needs no elevation. A failure is logged and never fails the install: the app
; works without the command line, and the docs say how to add it by hand.

!macro automataCliPath ARGS
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli-path.ps1" -Dir "$INSTDIR\resources\cli" ${ARGS}'
  Pop $0
  ${if} $0 != 0
    DetailPrint "Could not update PATH for the automata command line (exit $0)."
  ${endif}
  ; WM_SETTINGCHANGE to every top-level window, so Explorer (and so every
  ; terminal started from now on) picks up the new PATH without a sign-out.
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customInstall
  !insertmacro automataCliPath ""
!macroend

!macro customUnInstall
  ; An update runs the old version's uninstaller before installing the new one.
  ; The folder is the same, so leave PATH alone rather than remove and re-add it.
  ${ifNot} ${isUpdated}
    !insertmacro automataCliPath "-Remove"
  ${endif}
!macroend
