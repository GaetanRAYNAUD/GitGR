; Crochets de l'installateur NSIS de Tauri (bundle.windows.nsis.installerHooks).

; Page de fin : la case « Créer un raccourci sur le bureau » est décochée par défaut.
; Les mises à jour automatiques (mode /UPDATE) ne créent jamais ce raccourci.
!macro NSIS_HOOK_PREFINISHPAGE
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!macroend
