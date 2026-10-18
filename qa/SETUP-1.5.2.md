# Slide Studio 1.5.2 Windows 설치판 검증

2026-10-18(KST). 앱의 버전과 기능은 1.5.2를 유지하고 Windows 기본 다운로드를 `Slide-Studio-Setup-x64.exe`로 전환했습니다. Mac ZIP과 기존 Windows ZIP은 교체하지 않았습니다.

## 설치 동작

NSIS v3.13의 Unicode 영어·한국어 마법사를 사용합니다. 현재 사용자의 `%LOCALAPPDATA%\Programs\Slide Studio`에 설치하며 관리자 권한을 요구하지 않습니다. 시작 메뉴·선택한 바탕화면 바로가기와 HKCU의 설치된 앱 항목을 만듭니다. 완료 화면에서 앱 실행을 선택할 수 있습니다.

작업을 저장하고 앱을 종료한 뒤 새 Setup을 실행해 업데이트합니다. 실행 중인 앱을 강제 종료하지 않습니다. 제거 시 앱 파일의 생성된 목록과 빈 폴더만 삭제하며 `%APPDATA%\Slide Studio`의 자동 저장 자료와 사용자 파일을 보존합니다. 설치 경로는 고정이며 임의의 `/D=` 경로는 거부합니다. 파일 연결과 자동 업데이트는 추가하지 않았습니다.

## Mac에서의 패키지 검사

- 입력 Windows ZIP의 SHA-256·크기·CRC32와 1.5.2 ASAR을 확인했습니다.
- NSIS 컴파일 경고를 오류로 처리하고 설치 파일의 버전·아이콘·`asInvoker` 실행 매니페스트를 확인했습니다.
- 7-Zip으로 설치 파일 전체를 검사하고 추출한 **76개 배포 파일**의 SHA-256을 원본과 비교했습니다. ZIP 압축 해제 전용 `시작하기.txt`는 설치판에서 제외합니다. Electron·Chromium 라이선스는 포함합니다.
- 앱 ASAR SHA-256: `68e7cb2d7605a46143d6a32436f1aa82feac5fcb1bf099877696addc37d4a446`. 설치해 실행한 Mac 최종 앱 및 기존 Windows ZIP과 같습니다.

| 파일 | 바이트 수 | SHA-256 |
| --- | ---: | --- |
| Slide-Studio-Setup-x64.exe | 108773782 | `f576f2984c970bf71fc942fba108d9a2d55823a00f1d1d8daaed89ed55f1998f` |

## 실제 Windows 검사

[GitHub Actions 실행](https://github.com/beaur8-prog/slide-studio/actions/runs/39090314544)이 성공했습니다. 검증 코드 커밋: `c8e0c23f74554af3e7575e0686077a248df80d77`. 실행 환경: **Microsoft Windows Server 2025 Datacenter**, Windows x64 GitHub 호스팅 러너. 공개 릴리스의 설치 파일과 Windows ZIP을 내려받고 지정한 SHA-256을 확인한 후 검사했습니다.

1. 새로 설치하고 ZIP 원본에 있는 모든 앱·런타임 파일의 SHA-256을 설치된 파일과 비교했습니다.
2. 시작 메뉴·바탕화면 바로가기 대상, 제거 바로가기, 설치 위치·1.5.2 버전·따옴표로 감싼 제거 명령의 HKCU 등록을 확인했습니다.
3. 설치된 EXE를 실제 실행해 1.5.2 버전과 편집 화면을 확인했습니다. 발표를 시작하고 20px 휠 한 번으로 1→2장 이동, Esc 복귀를 확인했습니다.
4. 앱을 켠 상태의 자동 설치는 종료 코드 2로 중단됐고 기존 앱은 계속 실행됐습니다.
5. 앱 종료 후 재설치가 성공하고 파일 검증·바로가기·등록을 다시 확인했습니다.
6. 제거 후 앱·바로가기·HKCU 항목이 삭제됐습니다. 자동 저장 폴더의 검사 파일과 앱 설치 폴더에 별도로 추가한 사용자 파일은 보존됐습니다.

`installation.json`, `native-app.json`, 설치 앱 화면 PNG는 해당 실행의 `windows-installer-verification` 아티팩트에 있습니다. 로컬 사본은 `qa/results/setup-1.5.2-document/native/`에 보관합니다.

## 범위

Windows 호스팅 환경에서 자동·무인 설치와 실제 앱 실행을 검사했습니다. 개인 PC의 Windows 10/11에서 마법사를 손으로 클릭한 검사, 실제 IME 직접 타이핑, 화면 기록 권한을 통한 실제 캡처와 종이 출력은 포함하지 않습니다. 설치판은 배포 서명이 없습니다. 기존 앱 기능 검사는 [1.5.2 기록](RELEASE-1.5.2.md)을 참고하세요.

패키징 기록의 `nativeWindowsInstall: false`는 Mac에서 수행한 패키지 검사 범위이며 위 Windows CI 실행은 별도 증거입니다. 리토스 원본은 기존 공유 항목의 `ShareServer.update`로 갱신하고 공유 서버와 터널을 재시작하지 않습니다.

재현: `npm run package:win`은 ZIP과 Setup을 만들며, 기존 ZIP으로 Setup만 만들려면 `npm run package:win:setup`을 사용합니다. [배포 설정](../DESKTOP.md#windows-packaging)과 [NSIS 공식 문서](https://nsis.sourceforge.io/Docs/)를 참고하세요.
