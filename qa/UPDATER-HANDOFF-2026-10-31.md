# Windows 업데이트 도우미 시작 확인

- 앱 버전: **1.6.20** (이전 개발 버전 1.6.19)
- 반영 원본: [Office Studio PR #1](https://github.com/beaur8-prog/office-studio/pull/1), `e3cf073c86af1d8587e9e4a6049edc3d76e72d10`
- 공통 저장소의 `updater/studio-updater.cjs`, `updater/studio-update-windows.ps1` 변경을 Slide Studio의 `electron/` 사본에 병합했습니다. 공통 저장소의 PR 자체를 병합하거나 다른 Studio 앱을 변경한 것은 아닙니다.

## 변경한 동작

Windows에서 **종료하고 업데이트**를 누르면 설치 도우미를 먼저 시작합니다. 앱·프로세스가 일치하는 준비 응답을 받은 뒤 기존 `app.quit()`과 문서 종료 확인을 진행합니다. 별도 도우미는 편집기와 하위 프로세스의 종료를 기다린 뒤 설치하며 편집기를 강제로 종료하지 않습니다.

도우미를 실행하지 못하거나 15초 안에 준비 응답을 받지 못하면 편집기를 열어 둡니다. 오류 안내에서 **설치 파일 보기**를 선택할 수 있고 로그 폴더도 표시합니다. 문서를 저장하고 앱을 직접 종료한 뒤 해당 Setup을 실행할 수 있습니다. 시작 진단은 사용자 자료 폴더의 `updates/helper-startup.log`, 설치 결과는 `updates/last-install.log`에 기록합니다. 문서 닫기를 취소하면 요청 파일을 제거해 나중에 앱을 종료해도 취소한 업데이트가 실행되지 않게 합니다.

기존 파일·도움말 메뉴, 수동 확인·다운로드, 자동 확인 설정, 다운로드 진행률, 다섯 단계의 Windows 진행 창, 재실행 후 설치 결과 표시를 유지했습니다. 문서 저장·종료 처리와 Mac·Linux의 수동 설치 방식도 유지합니다. 공통 PR의 짧은 콘솔 부트스트랩과 SHA-256 검증을 사용하면서 Slide Studio의 구조화된 결과 로그와 진행 창을 보존했습니다.

## 검증

- 업데이트 Node 검사 **29개 통과**: 준비 응답 후 종료, 실행 오류·비정상 종료·시간 초과·응답 불일치 시 앱 유지와 수동 설치, 문서 닫기 취소와 이후 종료, 다운로드 검증·취소, 수동 메뉴·설정·결과 기록을 포함합니다.
- 관련 Playwright 검사 **21개 통과**: 업데이트 UI, 파일 IPC, 문서 저장 실패·열기 취소·미저장 내용 보호, 버전 표시와 Windows 단축키를 확인했습니다.
- `npm run build` 통과. 기존 Vite 청크 크기 안내는 남아 있습니다.
- Windows 실제 Electron 종료와 PowerShell 도우미의 연결을 확인하는 `scripts/qa-update-handoff-windows.cjs`를 추가했습니다. 한글·공백·작은따옴표·셸 특수문자가 있는 임시 경로에서 정상 설치, 종료 취소, 실행 차단, 도우미 변조를 검사합니다. 임시 EXE의 버전이 0.0.0에서 1.0.0으로 바뀌며, 편집기 프로세스가 살아 있으면 시험 설치 프로그램이 실패합니다.
- 별도의 기존 Windows Setup 검사는 실제 설치 파일의 설치·진행 창·버전·재실행·사용자 자료 보존을 검사합니다. 이 검사는 제공한 동일 버전의 재설치이며, 실제 구버전 Slide Studio 바이너리에서 신버전으로 교체하는 시험은 아닙니다.

## 완료한 빌드와 실행 시험

- 구현 커밋: `05f4e2fe96355aec0dc4433d8915a7493e906219`.
- [Windows 실제 Electron 연결 시험](https://github.com/beaur8-prog/slide-studio/actions/runs/41205156500/job/124548624534) **4개 모두 통과**. 준비 응답이 있는 상태에서 정상 종료하고, 시험 EXE의 버전 변경·다섯 단계 표시·재실행을 확인했습니다. 종료 취소·실행 차단·도우미 변조에서는 편집기가 열린 채로 남으며 설치되지 않았습니다. 실패 시 로그 폴더와 수동 설치 버튼도 확인했습니다.
- [1.6.20 Windows 전체 검증](https://github.com/beaur8-prog/slide-studio/actions/runs/41205156500) **모두 통과**. Windows에서도 업데이트 29개·관련 UI 21개가 통과했고, 같은 구현 커밋으로 Windows에서 빌드한 실제 Setup의 첫 설치·도우미를 통한 재설치·다섯 단계의 창 표시·설치 버전·앱 재실행·사용자 자료 보존·정상 종료·제거 후 자료 보존을 확인했습니다.
- 로컬 Windows Setup **빌드·검증 완료**. NSIS 아카이브 검사와 추출 파일 전체 SHA-256 대조, 버전 리소스·아이콘·현재 사용자 설치 권한을 확인했습니다. 최종 파일은 `artifacts/slide-studio-1.6.20/Slide-Studio-Setup-x64.exe`에 보관합니다.
- 설치 파일: **110,283,383바이트**, SHA-256: `230ec81495a5dfaaf2997dad6113e691e368a6b204262d8af8e24b5f2c3f92b4`.
- Windows·Mac 패키지에서 두 업데이트 파일을 추출해 구현 소스와 일치함을 확인했습니다. 두 플랫폼의 공통 `app.asar` SHA-256은 `a03f395924f334061acea77bcc7894fcb2050baf8ecb36ee3094111584a891e8`입니다.
- Mac 앱의 임시 서명 검증을 통과했습니다. 실행 중이던 1.6.19가 저장된 기본 제목 슬라이드 한 장임을 확인하고 앱 메뉴로 정상 종료한 뒤 백업했습니다. `/Applications/Slide Studio.app`을 1.6.20으로 교체·실행해 버전 표시와 업데이트 창을 확인했고, 저장된 기본 편집 화면을 열어 두었습니다. 사용자 자료는 유지했습니다.
- 이전 Mac 앱: `~/Library/Application Support/Slide Studio Backups/updater-handoff-1.6.20-20261031/Slide Studio.app`.
- 원본 결과: `qa/results/updater-handoff-20261031/`, 사용자 작업 폴더 사본: `qa/updater-handoff-20261031/`.

Windows CI의 Setup은 Windows에서 별도로 빌드했으므로 위 로컬 교차 빌드 파일과 바이트가 같지는 않습니다. CI 설치 파일 SHA-256은 `7c3e0fcf5a10eda390db2d02265b147e9ab8bf8251d28b576f57f70b085793c2`, CI `app.asar` SHA-256은 `efdb959a10c1870d525abb8c88668d2812ad654ac581b69523d0cf69afb81706`입니다. 로컬 파일은 아카이브·전체 추출 파일·버전 검증을 거쳤고, Windows 실행 시험은 같은 커밋을 CI에서 빌드한 파일로 수행했습니다.

공개 릴리스 게시와 공개 다운로드·리토스 문서 변경은 이 작업에 포함하지 않습니다.
