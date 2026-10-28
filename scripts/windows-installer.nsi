; Per-user installer. PAYLOAD_FILES and REMOVE_FILES are generated from the
; checksum-verified portable package, never from a user-selected directory.
Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
CRCCheck force
ManifestDPIAware true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

!define PRODUCT "Slide Studio"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SlideStudio"
!define CAPABILITIES_KEY "Software\SlideStudio\Capabilities"
!define APPLICATION_KEY "Software\Classes\Applications\Slide Studio.exe"
!define ASSOCIATION_DESCRIPTION "Edit PowerPoint presentations and open legacy Slide Studio files."
Name "${PRODUCT} ${APP_VERSION}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Slide Studio"
BrandingText "${PRODUCT}"
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "${PRODUCT} Setup"
VIAddVersionKey /LANG=1033 "FileDescription" "${PRODUCT} Setup"
VIAddVersionKey /LANG=1033 "CompanyName" "${PRODUCT}"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Independent presentation editor. Not affiliated with Microsoft."

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${PRODUCT} ${APP_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "$(WelcomeText)"
!insertmacro MUI_PAGE_WELCOME
!define MUI_COMPONENTSPAGE_NODESC
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Slide Studio.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_FINISHPAGE_RUN_TEXT "$(RunText)"
!insertmacro MUI_PAGE_FINISH
!define MUI_UNCONFIRMPAGE_TEXT_TOP "$(UninstallText)"
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Korean"

LangString WelcomeText ${LANG_ENGLISH} "Install Slide Studio for your Windows account.$\r$\n$\r$\nThe app will be installed in:$\r$\n$LOCALAPPDATA\Programs\Slide Studio$\r$\n$\r$\nSave your work and close Slide Studio before installing or updating. PowerPoint and Node.js are not required."
LangString WelcomeText ${LANG_KOREAN} "현재 Windows 사용자 계정에 Slide Studio를 설치합니다.$\r$\n$\r$\n설치 위치:$\r$\n$LOCALAPPDATA\Programs\Slide Studio$\r$\n$\r$\n설치하거나 업데이트하기 전에 작업을 저장하고 Slide Studio를 종료하세요. PowerPoint나 Node.js는 필요하지 않습니다."
LangString RunText ${LANG_ENGLISH} "Run Slide Studio"
LangString RunText ${LANG_KOREAN} "Slide Studio 실행"
LangString CoreText ${LANG_ENGLISH} "Slide Studio and Start menu shortcuts (required)"
LangString CoreText ${LANG_KOREAN} "Slide Studio와 시작 메뉴 바로가기 (필수)"
LangString DesktopText ${LANG_ENGLISH} "Desktop shortcut"
LangString DesktopText ${LANG_KOREAN} "바탕화면 바로가기"
LangString CloseText ${LANG_ENGLISH} "Save your work and close Slide Studio, then click Retry. Also check that the installation folder is writable."
LangString CloseText ${LANG_KOREAN} "작업을 저장하고 Slide Studio를 종료한 뒤 다시 시도를 누르세요. 설치 폴더에 쓰기 권한이 있는지도 확인하세요."
LangString PlatformText ${LANG_ENGLISH} "Slide Studio requires Windows 10 or later on a 64-bit Intel/AMD PC."
LangString PlatformText ${LANG_KOREAN} "Slide Studio는 Windows 10 이상의 Intel/AMD 64비트 PC가 필요합니다."
LangString LocationText ${LANG_ENGLISH} "This installer supports only the default folder for the current user. Do not change the installation path."
LangString LocationText ${LANG_KOREAN} "이 설치 프로그램은 현재 사용자의 기본 설치 폴더만 지원합니다. 설치 경로를 변경하지 마세요."
LangString BusyText ${LANG_ENGLISH} "Another Slide Studio installer or uninstaller is already running."
LangString BusyText ${LANG_KOREAN} "다른 Slide Studio 설치 또는 제거 프로그램이 실행 중입니다."
LangString UninstallText ${LANG_ENGLISH} "Remove the installed application and shortcuts. Your saved presentations and local autosave profile will be kept."
LangString UninstallText ${LANG_KOREAN} "설치한 앱과 바로가기를 제거합니다. 저장한 프레젠테이션과 자동 저장 사용자 자료는 보존합니다."
LangString RegistryText ${LANG_ENGLISH} "Installation registration failed. Run the installer again after checking your Windows account permissions."
LangString RegistryText ${LANG_KOREAN} "설치 등록에 실패했습니다. Windows 계정 권한을 확인한 뒤 설치 프로그램을 다시 실행하세요."

!macro CheckEnvironment PREFIX
Function ${PREFIX}CheckEnvironment
  SetShellVarContext current
  SetRegView 64
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "$(PlatformText)" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${IfNot} ${IsNativeAMD64}
    MessageBox MB_ICONSTOP "$(PlatformText)" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ; A fixed install root also bounds every uninstall deletion. No recursive
  ; deletion is used, so files added by the user are retained.
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\Slide Studio" location_ok
    MessageBox MB_ICONSTOP "$(LocationText)" /SD IDOK
    SetErrorLevel 2
    Quit
  location_ok:
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\SlideStudioSetup") p .r0 ?e'
  Pop $1
  ${If} $0 = 0
  ${OrIf} $1 = 183
    MessageBox MB_ICONSTOP "$(BusyText)" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd

Function ${PREFIX}CheckAppClosed
  retry:
  IfFileExists "$INSTDIR\Slide Studio.exe" 0 done
  ; Append mode opens without truncating. Windows denies write access while
  ; this executable is running. Never kill the app or discard unsaved work.
  ClearErrors
  FileOpen $0 "$INSTDIR\Slide Studio.exe" a
  IfErrors locked
  FileClose $0
  Goto done
  locked:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CloseText)" /SD IDCANCEL IDRETRY retry
    SetErrorLevel 2
    Quit
  done:
FunctionEnd
!macroend

!insertmacro CheckEnvironment ""
!insertmacro CheckEnvironment "un."

Function .onInit
  Call CheckEnvironment
FunctionEnd

Function un.onInit
  Call un.CheckEnvironment
  ; The generated uninstaller belongs only to this registered application.
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  StrCmp $0 $INSTDIR 0 invalid
  IfFileExists "$INSTDIR\.slide-studio-install" valid invalid
  invalid:
    MessageBox MB_ICONSTOP "$(LocationText)" /SD IDOK
    SetErrorLevel 2
    Quit
  valid:
FunctionEnd

; Register candidates for Open With / Settings. Never write an extension's
; default value or Explorer's UserChoice, which belong to the user.
!macro RegisterPresentationType EXTENSION PROGID DESCRIPTION
  WriteRegStr HKCU "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr HKCU "Software\Classes\${PROGID}" "FriendlyTypeName" "${DESCRIPTION}"
  WriteRegStr HKCU "Software\Classes\${PROGID}\DefaultIcon" "" '$\"$INSTDIR\Slide Studio.exe$\",0'
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open\command" "" '$\"$INSTDIR\Slide Studio.exe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\.${EXTENSION}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "${APPLICATION_KEY}\SupportedTypes" ".${EXTENSION}" ""
  WriteRegStr HKCU "${CAPABILITIES_KEY}\FileAssociations" ".${EXTENSION}" "${PROGID}"
!macroend

Function RegisterFileAssociations
  ClearErrors
  WriteRegStr HKCU "${APPLICATION_KEY}" "FriendlyAppName" "${PRODUCT}"
  WriteRegStr HKCU "${APPLICATION_KEY}\DefaultIcon" "" '$\"$INSTDIR\Slide Studio.exe$\",0'
  WriteRegStr HKCU "${APPLICATION_KEY}\shell\open\command" "" '$\"$INSTDIR\Slide Studio.exe$\" $\"%1$\"'
  WriteRegStr HKCU "${CAPABILITIES_KEY}" "ApplicationName" "${PRODUCT}"
  WriteRegStr HKCU "${CAPABILITIES_KEY}" "ApplicationDescription" "${ASSOCIATION_DESCRIPTION}"
  WriteRegStr HKCU "${CAPABILITIES_KEY}" "ApplicationIcon" '$\"$INSTDIR\Slide Studio.exe$\",0'
  !insertmacro RegisterPresentationType "pptx" "SlideStudio.Presentation" "PowerPoint Presentation"
  !insertmacro RegisterPresentationType "slide" "SlideStudio.LegacyPresentation" "Slide Studio Presentation (Legacy)"
  WriteRegStr HKCU "Software\RegisteredApplications" "${PRODUCT}" "${CAPABILITIES_KEY}"
  IfErrors done
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  done:
FunctionEnd

; Old NSIS releases can interpret /ifempty as "no subkeys" even if values
; remain. Query both counts explicitly, including an empty default value. On
; any access/query error keep the key. Always use the installer's 64-bit view.
Function un.DeleteEmptyAssociationKey
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  ; KEY_QUERY_VALUE | KEY_ENUMERATE_SUB_KEYS | KEY_WOW64_64KEY
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w r0, i 0, i 0x109, *p .r1) i .r2'
  ${If} $2 == 0
    System::Call 'advapi32::RegQueryInfoKeyW(p r1, p 0, p 0, p 0, *i .r2, p 0, p 0, *i .r3, p 0, p 0, p 0, p 0) i .r4'
    System::Call 'advapi32::RegCloseKey(p r1)'
    ${If} $4 == 0
    ${AndIf} $2 == 0
    ${AndIf} $3 == 0
      DeleteRegKey /ifempty HKCU "$0"
    ${EndIf}
  ${EndIf}
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro DeleteEmptyAssociationKey KEY
  Push "${KEY}"
  Call un.DeleteEmptyAssociationKey
!macroend

!macro DeleteMatchingAssociationValue KEY NAME EXPECTED
  ClearErrors
  ReadRegStr $0 HKCU "${KEY}" "${NAME}"
  ${IfNot} ${Errors}
  ${AndIf} $0 == '${EXPECTED}'
    DeleteRegValue HKCU "${KEY}" "${NAME}"
  ${EndIf}
!macroend

!macro UnregisterPresentationType EXTENSION PROGID DESCRIPTION
  ReadRegStr $0 HKCU "Software\Classes\${PROGID}\shell\open\command" ""
  ${If} $0 == '$\"$INSTDIR\Slide Studio.exe$\" $\"%1$\"'
    !insertmacro DeleteMatchingAssociationValue "Software\Classes\.${EXTENSION}\OpenWithProgids" "${PROGID}" ""
    !insertmacro DeleteEmptyAssociationKey "Software\Classes\.${EXTENSION}\OpenWithProgids"
    ; Other programs can add values or verbs even under our own ProgID.
    !insertmacro DeleteMatchingAssociationValue "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
    !insertmacro DeleteMatchingAssociationValue "Software\Classes\${PROGID}" "FriendlyTypeName" "${DESCRIPTION}"
    !insertmacro DeleteMatchingAssociationValue "Software\Classes\${PROGID}\DefaultIcon" "" '$\"$INSTDIR\Slide Studio.exe$\",0'
    !insertmacro DeleteMatchingAssociationValue "Software\Classes\${PROGID}\shell\open\command" "" '$\"$INSTDIR\Slide Studio.exe$\" $\"%1$\"'
    !insertmacro DeleteEmptyAssociationKey "Software\Classes\${PROGID}\shell\open\command"
    !insertmacro DeleteEmptyAssociationKey "Software\Classes\${PROGID}\shell\open"
    !insertmacro DeleteEmptyAssociationKey "Software\Classes\${PROGID}\shell"
    !insertmacro DeleteEmptyAssociationKey "Software\Classes\${PROGID}\DefaultIcon"
    !insertmacro DeleteEmptyAssociationKey "Software\Classes\${PROGID}"
  ${EndIf}
!macroend

Function un.UnregisterFileAssociations
  !insertmacro UnregisterPresentationType "pptx" "SlideStudio.Presentation" "PowerPoint Presentation"
  !insertmacro UnregisterPresentationType "slide" "SlideStudio.LegacyPresentation" "Slide Studio Presentation (Legacy)"
  ReadRegStr $0 HKCU "${APPLICATION_KEY}\shell\open\command" ""
  ${If} $0 == '$\"$INSTDIR\Slide Studio.exe$\" $\"%1$\"'
    !insertmacro DeleteMatchingAssociationValue "${APPLICATION_KEY}" "FriendlyAppName" "${PRODUCT}"
    !insertmacro DeleteMatchingAssociationValue "${APPLICATION_KEY}\DefaultIcon" "" '$\"$INSTDIR\Slide Studio.exe$\",0'
    !insertmacro DeleteMatchingAssociationValue "${APPLICATION_KEY}\shell\open\command" "" '$\"$INSTDIR\Slide Studio.exe$\" $\"%1$\"'
    !insertmacro DeleteMatchingAssociationValue "${APPLICATION_KEY}\SupportedTypes" ".pptx" ""
    !insertmacro DeleteMatchingAssociationValue "${APPLICATION_KEY}\SupportedTypes" ".slide" ""
    !insertmacro DeleteEmptyAssociationKey "${APPLICATION_KEY}\shell\open\command"
    !insertmacro DeleteEmptyAssociationKey "${APPLICATION_KEY}\shell\open"
    !insertmacro DeleteEmptyAssociationKey "${APPLICATION_KEY}\shell"
    !insertmacro DeleteEmptyAssociationKey "${APPLICATION_KEY}\DefaultIcon"
    !insertmacro DeleteEmptyAssociationKey "${APPLICATION_KEY}\SupportedTypes"
    !insertmacro DeleteEmptyAssociationKey "${APPLICATION_KEY}"
  ${EndIf}
  ReadRegStr $0 HKCU "${CAPABILITIES_KEY}" "ApplicationIcon"
  ${If} $0 == '$\"$INSTDIR\Slide Studio.exe$\",0'
    !insertmacro DeleteMatchingAssociationValue "Software\RegisteredApplications" "${PRODUCT}" "${CAPABILITIES_KEY}"
    !insertmacro DeleteMatchingAssociationValue "${CAPABILITIES_KEY}" "ApplicationName" "${PRODUCT}"
    !insertmacro DeleteMatchingAssociationValue "${CAPABILITIES_KEY}" "ApplicationDescription" "${ASSOCIATION_DESCRIPTION}"
    !insertmacro DeleteMatchingAssociationValue "${CAPABILITIES_KEY}" "ApplicationIcon" '$\"$INSTDIR\Slide Studio.exe$\",0'
    !insertmacro DeleteMatchingAssociationValue "${CAPABILITIES_KEY}\FileAssociations" ".pptx" "SlideStudio.Presentation"
    !insertmacro DeleteMatchingAssociationValue "${CAPABILITIES_KEY}\FileAssociations" ".slide" "SlideStudio.LegacyPresentation"
    !insertmacro DeleteEmptyAssociationKey "${CAPABILITIES_KEY}\FileAssociations"
    !insertmacro DeleteEmptyAssociationKey "${CAPABILITIES_KEY}"
    !insertmacro DeleteEmptyAssociationKey "Software\SlideStudio"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
FunctionEnd

Section "$(CoreText)" CoreSection
  SectionIn RO
  Call CheckAppClosed
  SetOverwrite on
  SetOutPath "$INSTDIR"
  !include "${PAYLOAD_FILES}"
  SetOutPath "$INSTDIR"
  FileOpen $0 "$INSTDIR\.slide-studio-install" w
  FileWrite $0 "${APP_VERSION}$\r$\n"
  FileClose $0
  ClearErrors
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PRODUCT}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Slide Studio.exe,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${INSTALLED_KIB}
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  IfErrors registration_failed
  Call RegisterFileAssociations
  IfErrors registration_failed
  CreateDirectory "$SMPROGRAMS\Slide Studio"
  CreateShortCut "$SMPROGRAMS\Slide Studio\Slide Studio.lnk" "$INSTDIR\Slide Studio.exe" "" "$INSTDIR\Slide Studio.exe" 0
  CreateShortCut "$SMPROGRAMS\Slide Studio\Uninstall Slide Studio.lnk" "$INSTDIR\Uninstall.exe"
  Goto installed
  registration_failed:
    MessageBox MB_ICONSTOP "$(RegistryText)" /SD IDOK
    SetErrorLevel 2
    Quit
  installed:
SectionEnd

Section "$(DesktopText)" DesktopSection
  SetOutPath "$INSTDIR"
  CreateShortCut "$DESKTOP\Slide Studio.lnk" "$INSTDIR\Slide Studio.exe" "" "$INSTDIR\Slide Studio.exe" 0
SectionEnd

Section "Uninstall"
  Call un.CheckAppClosed
  Call un.UnregisterFileAssociations
  !include "${REMOVE_FILES}"
  Delete "$INSTDIR\.slide-studio-install"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$DESKTOP\Slide Studio.lnk"
  Delete "$SMPROGRAMS\Slide Studio\Slide Studio.lnk"
  Delete "$SMPROGRAMS\Slide Studio\Uninstall Slide Studio.lnk"
  RMDir "$SMPROGRAMS\Slide Studio"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ; Deliberately retain $APPDATA\Slide Studio and all saved user documents.
SectionEnd
