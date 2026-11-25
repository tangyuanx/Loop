!undef APP_FILENAME
!define APP_FILENAME "Personal Task Track"

!ifndef BUILD_UNINSTALLER
Var loopUpgradeBackupRoot
Var loopUpgradeBackupCreated
Var loopUpgradeAttempt
Var loopUpgradeMirrorRoot
Var loopUpgradeStage
Var loopPreviousVersion
Var loopLegacyInstallBackupsSource
Var loopLegacyInstallBackupsQuarantine
Var loopRegisteredInstallLocation
Var loopInstalledExe

!macro stopLoopBackup MESSAGE
  MessageBox MB_OK|MB_ICONSTOP "${MESSAGE}$\r$\n请关闭 Loop，检查磁盘空间和当前账户的写入权限，再重新运行安装包。已安装的版本仍可打开。" /SD IDOK
  Call stopLoopUpgrade
!macroend

!macro createLoopBackupDirectory DIRECTORY
  CreateDirectory "${DIRECTORY}"
  System::Call 'kernel32::GetFileAttributesW(w "${DIRECTORY}") i .r4'
  ; Require a normal directory, including when the path already existed.
  IntOp $R5 $4 & 0x410
  ${If} $R5 <> 0x10
    !insertmacro stopLoopBackup "无法在 AppData 中验证升级备份目录。"
  ${EndIf}
!macroend

!macro verifyLoopUpgradeFile SOURCE_FILE DEST_FILE
  ${IfNot} ${FileExists} "${DEST_FILE}"
    !insertmacro stopLoopBackup "Loop 未能校验升级数据备份。"
  ${EndIf}
  ClearErrors
  FileOpen $R7 "${SOURCE_FILE}" r
  ${If} ${Errors}
    !insertmacro stopLoopBackup "无法读取升级备份的源文件。"
  ${EndIf}
  FileSeek $R7 0 END $R8
  FileClose $R7
  ${If} ${Errors}
    !insertmacro stopLoopBackup "无法读取升级备份的源文件大小。"
  ${EndIf}
  FileOpen $R7 "${DEST_FILE}" r
  ${If} ${Errors}
    !insertmacro stopLoopBackup "无法读取本次升级备份文件。"
  ${EndIf}
  FileSeek $R7 0 END $R9
  FileClose $R7
  ${If} ${Errors}
  ${OrIf} $R8 != $R9
    !insertmacro stopLoopBackup "Loop 检测到升级备份大小不一致。"
  ${EndIf}
!macroend

!macro copyLoopUpgradeFile SOURCE_DIR DEST_DIR FILE_NAME
  ${If} ${FileExists} "${SOURCE_DIR}\${FILE_NAME}"
    ClearErrors
    CopyFiles /SILENT "${SOURCE_DIR}\${FILE_NAME}" "${DEST_DIR}"
    ${If} ${Errors}
      !insertmacro stopLoopBackup "Loop 无法在升级前备份 ${FILE_NAME}。"
    ${EndIf}
    !insertmacro verifyLoopUpgradeFile "${SOURCE_DIR}\${FILE_NAME}" "${DEST_DIR}\${FILE_NAME}"
    StrCpy $loopUpgradeBackupCreated "1"
  ${EndIf}
!macroend

!macro copyLoopUpgradeResourceDirectory SOURCE_DIR DEST_DIR DIRECTORY_NAME
  ${If} ${FileExists} "${SOURCE_DIR}\${DIRECTORY_NAME}\*.*"
    CreateDirectory "${DEST_DIR}\${DIRECTORY_NAME}"
    ClearErrors
    CopyFiles /SILENT "${SOURCE_DIR}\${DIRECTORY_NAME}\*.*" "${DEST_DIR}\${DIRECTORY_NAME}"
    ${If} ${Errors}
      !insertmacro stopLoopBackup "Loop 无法备份工作区资源。"
    ${EndIf}
    StrCpy $loopUpgradeBackupCreated "1"
  ${EndIf}
!macroend

!macro backupLoopUpgradeDirectory SOURCE_DIR LABEL
  CreateDirectory "$loopUpgradeBackupRoot\${LABEL}"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "task-data.json"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "task-data.workspace"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "knowledge-note-recovery.json"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "deadline-reminders.json"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "today-widget-preferences.json"
  !insertmacro copyLoopUpgradeFile "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "update-preferences.json"
  !insertmacro copyLoopUpgradeResourceDirectory "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "image-assets"
  !insertmacro copyLoopUpgradeResourceDirectory "${SOURCE_DIR}" "$loopUpgradeBackupRoot\${LABEL}" "workspace-notes"

  ${If} ${FileExists} "${SOURCE_DIR}\knowledge-note-recovery\*.*"
    CreateDirectory "$loopUpgradeBackupRoot\${LABEL}\knowledge-note-recovery"
    ClearErrors
    CopyFiles /SILENT "${SOURCE_DIR}\knowledge-note-recovery\*.*" "$loopUpgradeBackupRoot\${LABEL}\knowledge-note-recovery"
    ${If} ${Errors}
      !insertmacro stopLoopBackup "Loop 无法在升级前备份节点详情恢复附件。"
    ${EndIf}
    StrCpy $loopUpgradeBackupCreated "1"
  ${EndIf}

  ${If} ${FileExists} "${SOURCE_DIR}\task-share-assets\*.*"
    CreateDirectory "$loopUpgradeBackupRoot\${LABEL}\task-share-assets"
    ClearErrors
    CopyFiles /SILENT "${SOURCE_DIR}\task-share-assets\*.*" "$loopUpgradeBackupRoot\${LABEL}\task-share-assets"
    ${If} ${Errors}
      !insertmacro stopLoopBackup "Loop 无法在升级前备份任务分享附件。"
    ${EndIf}
    StrCpy $loopUpgradeBackupCreated "1"
  ${EndIf}

  ${If} ${FileExists} "${SOURCE_DIR}\task-data.corrupt-*.json"
    ClearErrors
    CopyFiles /SILENT "${SOURCE_DIR}\task-data.corrupt-*.json" "$loopUpgradeBackupRoot\${LABEL}"
    ${If} ${Errors}
      !insertmacro stopLoopBackup "Loop 无法保留旧任务数据备份。"
    ${EndIf}
    StrCpy $loopUpgradeBackupCreated "1"
  ${EndIf}
!macroend

!macro mirrorLoopUpgradeDirectory LABEL
  ${If} ${FileExists} "$loopUpgradeBackupRoot\${LABEL}\*.*"
    CreateDirectory "$loopUpgradeMirrorRoot\${LABEL}"
    ClearErrors
    CopyFiles /SILENT "$loopUpgradeBackupRoot\${LABEL}\*.*" "$loopUpgradeMirrorRoot\${LABEL}"
    ${If} ${Errors}
      DetailPrint "安装目录的备用副本未完成。升级备份已保存在 $loopUpgradeBackupRoot"
    ${EndIf}
  ${EndIf}
!macroend

!macro customHeader
Function stopLoopUpgrade
  ${If} ${Silent}
  ${AndIf} ${isUpdated}
  ${AndIf} ${isForceRun}
  ${AndIf} $loopInstalledExe != ""
    ${StdUtils.ExecShellAsUser} $0 "$loopInstalledExe" "open" ""
  ${EndIf}
  SetErrorLevel 2
  Quit
FunctionEnd

Function .onInstFailed
  ${If} ${FileExists} "$loopUpgradeBackupRoot\.loop-install-pending"
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "安装未完成。请关闭 Loop 后重新运行当前安装包。$\r$\n本次升级备份保存在：$\r$\n$loopUpgradeBackupRoot$\r$\n$\r$\n是否打开备份目录？" /SD IDNO IDNO loopLeaveFailedInstaller
    ExecShell "open" "$loopUpgradeBackupRoot"
  ${EndIf}
  loopLeaveFailedInstaller:
FunctionEnd

Function checkLoopInstallLocation
  ReadRegStr $loopRegisteredInstallLocation SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $loopPreviousVersion SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ${If} $loopRegisteredInstallLocation != ""
    GetFullPathName $loopRegisteredInstallLocation "$loopRegisteredInstallLocation\."
    GetFullPathName $INSTDIR "$INSTDIR\."
    GetFullPathName $R0 "$loopRegisteredInstallLocation\.."
    ${If} $loopRegisteredInstallLocation == ""
    ${OrIf} $loopRegisteredInstallLocation == $R0
      !insertmacro stopLoopBackup "系统登记的 Loop 安装位置无效。请核对原安装目录。"
    ${EndIf}
    ${If} ${FileExists} "$loopRegisteredInstallLocation\Loop.exe"
      StrCpy $loopInstalledExe "$loopRegisteredInstallLocation\Loop.exe"
    ${EndIf}
    ${If} $loopRegisteredInstallLocation != $INSTDIR
      ${If} $loopInstalledExe == ""
      ${AndIfNot} ${FileExists} "$loopRegisteredInstallLocation\Uninstall Loop.exe"
        !insertmacro stopLoopBackup "无法确认系统登记的 Loop 安装位置。"
      ${EndIf}
      MessageBox MB_OKCANCEL|MB_ICONQUESTION "Loop 已安装在以下位置：$\r$\n$loopRegisteredInstallLocation$\r$\n$\r$\n按「确定」使用该位置升级，或按「取消」退出安装。" /SD IDOK IDOK loopUseRegisteredInstallLocation
      Call stopLoopUpgrade
      loopUseRegisteredInstallLocation:
      StrCpy $INSTDIR "$loopRegisteredInstallLocation"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function confirmLoopBackupArchive
  StrCpy $loopLegacyInstallBackupsSource "$INSTDIR\Loop Data Backups"
  ${IfNot} ${FileExists} "$loopLegacyInstallBackupsSource\*.*"
    Return
  ${EndIf}
  ${If} $loopRegisteredInstallLocation == ""
    !insertmacro stopLoopBackup "无法确认该目录中的历史备份属于当前安装。请从已有的 Loop 启动更新，或在安装向导中选择原安装位置。"
  ${EndIf}
  ${If} $loopInstalledExe == ""
  ${AndIfNot} ${FileExists} "$INSTDIR\Uninstall Loop.exe"
    !insertmacro stopLoopBackup "原安装目录缺少 Loop 程序和卸载器。请保留其中的备份，并使用安装包修复原安装。"
  ${EndIf}
  StrCpy $loopLegacyInstallBackupsQuarantine "$INSTDIR.legacy-loop-backups-pre-${VERSION}"
  ${If} ${FileExists} "$loopLegacyInstallBackupsQuarantine"
  ${OrIf} ${FileExists} "$loopLegacyInstallBackupsQuarantine\*.*"
    MessageBox MB_OKCANCEL|MB_ICONQUESTION "已找到上一次安装留下的备份。$\r$\n$\r$\n按「确定」保留全部备份并继续。Loop 会为本次安装建立独立备份，无需手动移动或删除文件。$\r$\n按「取消」退出安装，继续使用原版本。" /SD IDOK IDOK loopKeepAllBackups
    Call stopLoopUpgrade
  ${EndIf}
  loopKeepAllBackups:
FunctionEnd

Function archiveLoopInstallBackups
  ${If} $loopLegacyInstallBackupsQuarantine == ""
    Return
  ${EndIf}
  StrCpy $R0 -1
  loopFindArchivePath:
    IntOp $R0 $R0 + 1
    StrCpy $loopLegacyInstallBackupsQuarantine "$INSTDIR.legacy-loop-backups-pre-${VERSION}"
    ${If} $R0 > 0
      StrCpy $loopLegacyInstallBackupsQuarantine "$loopLegacyInstallBackupsQuarantine-$R0"
    ${EndIf}
    ${If} ${FileExists} "$loopLegacyInstallBackupsQuarantine"
    ${OrIf} ${FileExists} "$loopLegacyInstallBackupsQuarantine\*.*"
      Goto loopFindArchivePath
    ${EndIf}
    ClearErrors
    Rename "$loopLegacyInstallBackupsSource" "$loopLegacyInstallBackupsQuarantine"
    ${If} ${Errors}
      ${If} ${FileExists} "$loopLegacyInstallBackupsQuarantine"
      ${OrIf} ${FileExists} "$loopLegacyInstallBackupsQuarantine\*.*"
        Goto loopFindArchivePath
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法移动历史备份。请关闭 Loop 和打开此目录的程序，并检查安装目录的写入权限，再按「重试」。取消后，原版本和备份仍可使用。$\r$\n$loopLegacyInstallBackupsSource" /SD IDCANCEL IDRETRY loopFindArchivePath
      Call stopLoopUpgrade
    ${EndIf}
    ${If} ${FileExists} "$loopLegacyInstallBackupsSource\*.*"
    ${OrIfNot} ${FileExists} "$loopLegacyInstallBackupsQuarantine\*.*"
      !insertmacro stopLoopBackup "无法确认历史备份已完整迁出。"
    ${EndIf}
    ClearErrors
    FileOpen $R6 "$loopUpgradeBackupRoot\legacy-install-backups-location.txt" w
    ${IfNot} ${Errors}
      FileWriteUTF16LE /BOM $R6 "$loopLegacyInstallBackupsQuarantine$\r$\n"
      FileClose $R6
    ${EndIf}
    DetailPrint "历史备份已保留在 $loopLegacyInstallBackupsQuarantine"
FunctionEnd

Function prepareLoopUpgrade
  Call confirmLoopBackupArchive

  ; The assisted installer has not yet reached electron-builder's app shutdown.
  ; Let users save and exit Loop before taking a manual snapshot.
  StrCpy $R1 0
  loopWaitForAppExit:
    ${nsProcess::FindProcess} "Loop.exe" $R0
    ${nsProcess::Unload}
    ${If} $R0 == 0
      ${If} ${Silent}
      ${AndIf} $R1 < 12
        IntOp $R1 $R1 + 1
        Sleep 250
        Goto loopWaitForAppExit
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "请先在 Loop 中保存工作，并完全退出 Loop（包括系统托盘中的 Loop），然后按「重试」继续备份和安装。" /SD IDCANCEL IDRETRY loopWaitForAppExit
      Call stopLoopUpgrade
    ${EndIf}

  ; Keep legacy fixed-path snapshots and any rollback references to them intact.
  SetShellVarContext current
  StrCpy $R3 "$APPDATA\Personal Task Track Upgrade Backups"
  !insertmacro createLoopBackupDirectory "$R3"
  StrCpy $loopUpgradeStage "$R3\installer-pre-${VERSION}"
  !insertmacro createLoopBackupDirectory "$loopUpgradeStage"
  StrCpy $loopUpgradeAttempt 0
  ; Do not reuse a lower number when the user removes an earlier backup.
  ClearErrors
  FindFirst $R6 $R7 "$loopUpgradeStage\attempt-*"
  ${IfNot} ${Errors}
    ${Do}
      StrCpy $R7 $R7 "" 8
      IntOp $R8 $R7 + 0
      ${If} $R8 > $loopUpgradeAttempt
        StrCpy $loopUpgradeAttempt $R8
      ${EndIf}
      ClearErrors
      FindNext $R6 $R7
    ${LoopUntil} ${Errors}
    FindClose $R6
  ${EndIf}
  loopReserveUpgradeAttempt:
    IntOp $loopUpgradeAttempt $loopUpgradeAttempt + 1
    StrCpy $loopUpgradeBackupRoot "$loopUpgradeStage\attempt-$loopUpgradeAttempt"
    System::Call 'kernel32::CreateDirectoryW(w "$loopUpgradeBackupRoot", p 0) i .r0 ?e'
    Pop $R0
    ${If} $0 == 0
      ${If} $R0 == 183 ; ERROR_ALREADY_EXISTS
      ${OrIf} $R0 == 80 ; ERROR_FILE_EXISTS
        Goto loopReserveUpgradeAttempt
      ${EndIf}
      !insertmacro stopLoopBackup "无法在 AppData 中创建本次安装的独立备份。"
    ${EndIf}

  !insertmacro backupLoopUpgradeDirectory "$APPDATA\Personal Task Track" "Personal Task Track"
  !insertmacro backupLoopUpgradeDirectory "$APPDATA\personal-task-track" "personal-task-track"
  !insertmacro backupLoopUpgradeDirectory "$APPDATA\PersonalTaskTrack" "PersonalTaskTrack"
  !insertmacro backupLoopUpgradeDirectory "$APPDATA\Loop" "Loop"
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}

  ; Write the pending marker before any move or uninstall. Publish it only after
  ; the new executable and registry entries are installed.
  ClearErrors
  FileOpen $R6 "$loopUpgradeBackupRoot\.loop-install-pending" w
  ${If} ${Errors}
    !insertmacro stopLoopBackup "无法记录本次升级的备份位置。"
  ${EndIf}
  StrCpy $R0 "manual"
  ${If} ${isUpdated}
    StrCpy $R0 "update"
  ${EndIf}
  StrCpy $R1 "empty"
  ${If} ${FileExists} "$loopUpgradeBackupRoot\Personal Task Track\task-data.json"
    StrCpy $R1 "workspace"
  ${EndIf}
  FileWriteUTF16LE /BOM $R6 "2$\r$\n$loopPreviousVersion$\r$\n$R0$\r$\n$R1$\r$\n$INSTDIR$\r$\n"
  FileClose $R6
  ${If} ${Errors}
    !insertmacro stopLoopBackup "无法记录本次升级的备份位置。"
  ${EndIf}

  Call archiveLoopInstallBackups
FunctionEnd

!macroend

!macro customInit
  ${If} ${Silent}
    ; The outer process of a silent per-machine update hands off to the
    ; elevated process. Only the process that can install should take a backup.
    ${If} $hasPerMachineInstallation != "1"
    ${OrIf} ${UAC_IsAdmin}
      Call checkLoopInstallLocation
      Call prepareLoopUpgrade
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE prepareLoopInteractiveInstall

  Function prepareLoopInteractiveInstall
    Call checkLoopInstallLocation
    ${If} $loopRegisteredInstallLocation == ""
      Call instFilesPre
    ${EndIf}
    Call prepareLoopUpgrade
  FunctionEnd
!macroend

!macro customInstall
  ${If} $loopUpgradeBackupCreated == "1"
    StrCpy $loopUpgradeMirrorRoot "$INSTDIR\Loop Data Backups\installer-pre-${VERSION}\attempt-$loopUpgradeAttempt"
    !insertmacro mirrorLoopUpgradeDirectory "Personal Task Track"
    !insertmacro mirrorLoopUpgradeDirectory "personal-task-track"
    !insertmacro mirrorLoopUpgradeDirectory "PersonalTaskTrack"
    !insertmacro mirrorLoopUpgradeDirectory "Loop"
  ${EndIf}
  ${If} ${FileExists} "$loopUpgradeBackupRoot\.loop-install-pending"
    ClearErrors
    Rename "$loopUpgradeBackupRoot\.loop-install-pending" "$loopUpgradeBackupRoot\.loop-install-check"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Loop 已安装，可以继续使用。升级备份已保存，但无法登记首次启动自检。备份位于：$\r$\n$loopUpgradeBackupRoot" /SD IDOK
    ${EndIf}
  ${EndIf}
!macroend
!endif
