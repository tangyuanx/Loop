!undef APP_FILENAME
!define APP_FILENAME "Personal Task Track"

!ifndef BUILD_UNINSTALLER
Var loopUpgradeBackupRoot
Var loopUpgradeBackupCreated
Var loopLegacyInstallBackupsSource
Var loopLegacyInstallBackupsQuarantine
Var loopRegisteredInstallLocation

!macro verifyLoopUpgradeFile SOURCE_FILE DEST_FILE
  ${IfNot} ${FileExists} "${DEST_FILE}"
    MessageBox MB_OK|MB_ICONSTOP "Loop 未能校验升级数据备份。安装已停止，原软件和数据不会被删除。"
    Abort
  ${EndIf}
  FileOpen $R7 "${SOURCE_FILE}" r
  FileSeek $R7 0 END $R8
  FileClose $R7
  FileOpen $R7 "${DEST_FILE}" r
  FileSeek $R7 0 END $R9
  FileClose $R7
  ${If} $R8 != $R9
    MessageBox MB_OK|MB_ICONSTOP "Loop 检测到升级备份大小不一致。安装已停止，原软件和数据不会被删除。"
    Abort
  ${EndIf}
!macroend

!macro copyLoopUpgradeFile SOURCE_DIR DEST_DIR FILE_NAME
  ${If} ${FileExists} "${SOURCE_DIR}\${FILE_NAME}"
    ClearErrors
    CopyFiles /SILENT "${SOURCE_DIR}\${FILE_NAME}" "${DEST_DIR}"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Loop 无法在升级前备份 ${FILE_NAME}。安装已停止，原软件和数据不会被删除。"
      Abort
    ${EndIf}
    !insertmacro verifyLoopUpgradeFile "${SOURCE_DIR}\${FILE_NAME}" "${DEST_DIR}\${FILE_NAME}"
    StrCpy $loopUpgradeBackupCreated "1"
  ${EndIf}
!macroend

!macro backupLoopUpgradeDirectory SOURCE_DIR LABEL
  CreateDirectory "$loopUpgradeBackupRoot\${LABEL}"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "task-data.json"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "knowledge-note-recovery.json"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "deadline-reminders.json"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "today-widget-preferences.json"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "update-preferences.json"

  ${If} ${FileExists} "${SOURCE_DIR}\knowledge-note-recovery\*.*"
    CreateDirectory "$loopUpgradeBackupRoot\${LABEL}\knowledge-note-recovery"
    ClearErrors
    CopyFiles /SILENT "${SOURCE_DIR}\knowledge-note-recovery\*.*" "$loopUpgradeBackupRoot\${LABEL}\knowledge-note-recovery"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Loop 无法在升级前备份节点详情恢复附件。安装已停止，原软件和数据不会被删除。"
      Abort
    ${EndIf}
    StrCpy $loopUpgradeBackupCreated "1"
  ${EndIf}

  ${If} ${FileExists} "${SOURCE_DIR}\task-share-assets\*.*"
    CreateDirectory "$loopUpgradeBackupRoot\${LABEL}\task-share-assets"
    ClearErrors
    CopyFiles /SILENT "${SOURCE_DIR}\task-share-assets\*.*" "$loopUpgradeBackupRoot\${LABEL}\task-share-assets"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Loop 无法在升级前备份任务分享附件。安装已停止，原软件和数据不会被删除。"
      Abort
    ${EndIf}
    StrCpy $loopUpgradeBackupCreated "1"
  ${EndIf}

  ${If} ${FileExists} "${SOURCE_DIR}\task-data.corrupt-*.json"
    ClearErrors
    CopyFiles /SILENT "${SOURCE_DIR}\task-data.corrupt-*.json" "$loopUpgradeBackupRoot\${LABEL}"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Loop 无法保留旧任务数据备份。安装已停止，原软件和数据不会被删除。"
      Abort
    ${EndIf}
    StrCpy $loopUpgradeBackupCreated "1"
  ${EndIf}
!macroend

!macro mirrorLoopUpgradeDirectory LABEL
  ${If} ${FileExists} "$loopUpgradeBackupRoot\${LABEL}\*.*"
    CreateDirectory "$INSTDIR\Loop Data Backups\installer-pre-${VERSION}\${LABEL}"
    ClearErrors
    CopyFiles /SILENT "$loopUpgradeBackupRoot\${LABEL}\*.*" "$INSTDIR\Loop Data Backups\installer-pre-${VERSION}\${LABEL}"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Loop 已在 AppData 中保护原数据，但无法创建安装目录备份副本。安装已停止；安全备份仍保留在 AppData 中。"
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro quarantineLegacyInstallBackups
  StrCpy $loopLegacyInstallBackupsSource "$INSTDIR\Loop Data Backups"
  ${IfNot} ${FileExists} "$loopLegacyInstallBackupsSource\*.*"
    Goto loopLegacyInstallBackupsDone
  ${EndIf}

  ReadRegStr $loopRegisteredInstallLocation SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $loopRegisteredInstallLocation == ""
    MessageBox MB_OK|MB_ICONSTOP "Loop 检测到旧版历史升级备份，但无法验证原安装目录。安装已停止，原软件和数据不会被删除。"
    Abort
  ${EndIf}
  ${If} $loopRegisteredInstallLocation != $INSTDIR
    MessageBox MB_OK|MB_ICONSTOP "Loop 检测到安装目录与系统登记不一致。为避免处理错误目录，安装已停止，原软件和数据不会被删除。"
    Abort
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\Loop.exe"
    ${IfNot} ${FileExists} "$INSTDIR\Uninstall Loop.exe"
      MessageBox MB_OK|MB_ICONSTOP "Loop 无法确认旧安装目录属于本软件。安装已停止，原软件和数据不会被删除。"
      Abort
    ${EndIf}
  ${EndIf}

  StrCpy $loopLegacyInstallBackupsQuarantine "$INSTDIR.legacy-loop-backups-pre-${VERSION}"
  ${If} ${FileExists} "$loopLegacyInstallBackupsQuarantine\*.*"
    MessageBox MB_OK|MB_ICONSTOP "Loop 已发现同版本的历史升级备份隔离目录。为避免覆盖或合并旧数据，安装已停止；请保留现场并反馈。"
    Abort
  ${EndIf}

  ClearErrors
  Rename "$loopLegacyInstallBackupsSource" "$loopLegacyInstallBackupsQuarantine"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Loop 无法将旧版本的历史升级备份移出安装目录。安装已停止，原软件和数据不会被删除。"
    Abort
  ${EndIf}
  ${If} ${FileExists} "$loopLegacyInstallBackupsSource\*.*"
    MessageBox MB_OK|MB_ICONSTOP "Loop 未能确认历史升级备份已安全移出安装目录。安装已停止，原软件和数据不会被删除。"
    Abort
  ${EndIf}
  ${IfNot} ${FileExists} "$loopLegacyInstallBackupsQuarantine\*.*"
    MessageBox MB_OK|MB_ICONSTOP "Loop 未能校验历史升级备份隔离目录。安装已停止，原软件和数据不会被删除。"
    Abort
  ${EndIf}

  FileOpen $R6 "$loopUpgradeBackupRoot\legacy-install-backups-location.txt" w
  FileWrite $R6 "$loopLegacyInstallBackupsQuarantine$\r$\n"
  FileClose $R6

  loopLegacyInstallBackupsDone:
!macroend

!macro customInit
  StrCpy $loopUpgradeBackupRoot "$APPDATA\Personal Task Track Upgrade Backups\installer-pre-${VERSION}"
  StrCpy $loopUpgradeBackupCreated "0"
  CreateDirectory "$loopUpgradeBackupRoot"

  !insertmacro backupLoopUpgradeDirectory "$APPDATA\Personal Task Track" "Personal Task Track"
  !insertmacro backupLoopUpgradeDirectory "$APPDATA\personal-task-track" "personal-task-track"
  !insertmacro backupLoopUpgradeDirectory "$APPDATA\PersonalTaskTrack" "PersonalTaskTrack"
  !insertmacro backupLoopUpgradeDirectory "$APPDATA\Loop" "Loop"
  !insertmacro quarantineLegacyInstallBackups
!macroend

!macro customInstall
  ${If} $loopUpgradeBackupCreated == "1"
    CreateDirectory "$INSTDIR\Loop Data Backups\installer-pre-${VERSION}"
    !insertmacro mirrorLoopUpgradeDirectory "Personal Task Track"
    !insertmacro mirrorLoopUpgradeDirectory "personal-task-track"
    !insertmacro mirrorLoopUpgradeDirectory "PersonalTaskTrack"
    !insertmacro mirrorLoopUpgradeDirectory "Loop"
    ${If} ${FileExists} "$loopUpgradeBackupRoot\Personal Task Track\task-data.json"
      !insertmacro verifyLoopUpgradeFile "$loopUpgradeBackupRoot\Personal Task Track\task-data.json" "$INSTDIR\Loop Data Backups\installer-pre-${VERSION}\Personal Task Track\task-data.json"
    ${EndIf}
    ${If} ${FileExists} "$loopUpgradeBackupRoot\personal-task-track\task-data.json"
      !insertmacro verifyLoopUpgradeFile "$loopUpgradeBackupRoot\personal-task-track\task-data.json" "$INSTDIR\Loop Data Backups\installer-pre-${VERSION}\personal-task-track\task-data.json"
    ${EndIf}
    ${If} ${FileExists} "$loopUpgradeBackupRoot\PersonalTaskTrack\task-data.json"
      !insertmacro verifyLoopUpgradeFile "$loopUpgradeBackupRoot\PersonalTaskTrack\task-data.json" "$INSTDIR\Loop Data Backups\installer-pre-${VERSION}\PersonalTaskTrack\task-data.json"
    ${EndIf}
    ${If} ${FileExists} "$loopUpgradeBackupRoot\Loop\task-data.json"
      !insertmacro verifyLoopUpgradeFile "$loopUpgradeBackupRoot\Loop\task-data.json" "$INSTDIR\Loop Data Backups\installer-pre-${VERSION}\Loop\task-data.json"
    ${EndIf}
  ${EndIf}
!macroend
!endif
