# Slide Studio 1.5.3 검증

2026-10-18(KST). 앱 코드 커밋: `a9256cc44e34ff6bc48a9611a7d7bf20b854ff14`.

## 변경 내용

Windows 슬라이드 쇼 리본의 발표자 노트·숨기기 큰 버튼 두 개가 세로로 쌓여 97px 리본을 넘던 문제를 가로 배치로 수정했습니다. 발표 중 우클릭/F1 메뉴와 레이저 포인터, 펜, 획 지우개, 6색·3굵기, 슬라이드별 임시 표시, 실행 취소·다시 실행과 현재 장 지우기를 추가했습니다. 레이저·펜·지우개에서는 클릭으로 장을 넘기지 않고 방향키·Space·휠을 사용합니다.

SVG 논리 좌표와 포인터 캡처를 사용하고 레이저·펜의 이동은 별도 SVG에 반영해 원본 슬라이드를 매번 다시 렌더링하지 않습니다. 표시는 발표 중 장별로 유지되고 종료 시 초기화됩니다. 문서 모델, 편집 기록, 자동 저장과 PPTX·PDF·인쇄에 포함하지 않습니다. 세션은 1,000획·100,000점, 한 획 4,096점 한도가 있습니다.

## 자동 검사

- 신규 발표 도구 검사 9개 통과: 리본 5개 폭, 레이저·휠, 좌표·크기 변경·장 이동, 지우개·undo/redo·전체 지우기, 메뉴·색상·굵기·Esc, 문서 저장 분리·세션 초기화, 링크, 포인터 취소, 희소 지우개 교차.
- 전체 검사 첫 실행: 142개 통과, 캡처 검사 종료 대기 1개, 환경 제외 2개. 대기 조건 보완 후 캡처 IPC 단독 검사 1개 통과.
- 두 번째 전체 실행: 142개 통과, 표 저장 상태 확인 타이밍 실패 1개, 환경 제외 2개(286.9초). 표 검사에서 실제 저장 데이터와 화면의 행·열 크기가 일치할 때까지 기다리도록 보완하고 표 크기 조절 검사 7개를 재실행해 모두 통과했습니다.
- 두 전체 실행과 후속 재검사에서 기능 항목 143개를 확인했고, 제외 2개와 미해결 실패 0개로 정리했습니다. 전체 실행과 후속 재검사 기록을 함께 보관합니다.
- 제외: Mac에서 실행할 수 없는 Windows 전용 전체 화면 검사와 설치되지 않은 Arial Nova Light 원본 글꼴 검사.
- 초기 전체 검사에서는 캡처 IPC의 모든 검증 후 초기 자동 저장 중 앱을 종료해 종료 보호 대화상자에서 정리가 대기했습니다. 테스트가 자동 저장 완료를 기다리도록 수정하고 단독 재검사 및 두 번째 전체 실행의 캡처 항목을 통과했습니다. 종료 보호 동작은 유지했습니다.

## 패키지

Mac과 Windows ZIP의 전체 CRC32, 프로덕션 ASAR의 소스·배포 자산 25개 파일, 버전·아이콘을 확인했습니다. 공통 ASAR SHA-256: `a232a0dbd83015035fbd395278ea6fee060dde8b70c14fcee4694d39c204f8a6`. Mac ZIP을 새 임시 폴더에 풀어 strict 코드 서명을 확인했습니다. Windows 공식 Electron 런타임 체크섬과 PE 제품 정보·코드 섹션, Setup의 버전·아이콘·asInvoker 매니페스트를 확인했습니다. Setup을 추출한 76개 배포 파일의 SHA-256을 비교했습니다.

| 파일 | 바이트 수 | SHA-256 |
| --- | ---: | --- |
| Slide-Studio-mac-arm64.zip | 128950097 | `a7a87e7fb6f23ef670c0dff8361afd8db20be6493a000993f95c57b84fde51d7` |
| Slide-Studio-win-x64.zip | 156123013 | `82a3f328b6b33f37d027efb2ea788874885126b7a2f12fed7b1cfabdc1ca9cf0` |
| Slide-Studio-Setup-x64.exe | 108831798 | `a90b936af3b87793e6c196cd22ab0bcd2000ba30eb371275c7eb06a937f86d71` |

## Windows 실제 설치 실행

[GitHub Actions](https://github.com/beaur8-prog/slide-studio/actions/runs/39092117532) 성공. 환경: **Microsoft Windows Server 2025 Datacenter**, x64 호스팅 러너. 공개 배포의 Setup과 ZIP을 내려받아 지정한 SHA-256으로 확인했습니다.

- 새 설치, 설치된 앱·런타임 파일 전체 검증값, 시작 메뉴·바탕화면·제거 바로가기, HKCU 설치된 앱 등록.
- 설치 EXE의 1.5.3 실행과 노트 버튼 배치. 창 크기를 바꿔 리본의 아이콘과 글자가 영역 안에 있는지 확인했습니다.
- 발표 시작과 20px 휠 이동, Ctrl+L 레이저, Ctrl+P 펜 드래그, Ctrl+E 획 지우개, 네이티브 Ctrl+Z·Ctrl+Shift+Z 실행 취소·다시 실행, Ctrl+A 화살표, F1 도구 메뉴와 Esc 복귀.
- 실행 중 자동 설치는 코드 2로 중단하고 앱을 보존. 종료 후 재설치 및 제거 성공. 자동 저장 폴더와 별도로 추가한 사용자 파일 보존.

실제 기록의 리본 크기: `[{"width": 1080, "height": 720, "unclipped": true}, {"width": 1543, "height": 1001, "unclipped": true}]`. `windows-installer-verification` 아티팩트에 설치·앱 JSON과 리본·레이저·펜 메뉴 화면이 있습니다.

## 범위와 링크

Windows 10/11 개인 PC에서 마법사를 손으로 클릭한 검사, 실제 OS IME 직접 타이핑, 화면 기록 권한을 통한 캡처와 종이 출력은 포함하지 않았습니다. Windows는 배포 서명이 없으며 Mac은 ad-hoc 서명으로 Apple 공증이 없습니다. 공개 PPTX 465장 전체 검사를 반복한 결과는 아닙니다.

기존 리토스 항목의 `ShareServer.update`로 본문과 이미지 두 개를 갱신하며 서버·터널·공유 토큰을 유지합니다. GitHub 고정 다운로드 파일명도 유지합니다. 로컬 증거: `qa/results/release-1.5.3/`의 초기·최종 검사, 패키지·소스 검증, Windows 실행 아티팩트 및 공개 다운로드 검증입니다.

동작 참고: [Microsoft의 발표 중 그리기 안내](https://support.microsoft.com/en-us/powerpoint/draw-on-slides-during-a-presentation), [발표 단축키](https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-deliver-powerpoint-presentations). 이 앱의 표시는 발표 종료 후 보존하지 않습니다.
