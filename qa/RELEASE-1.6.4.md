# Slide Studio 1.6.4

2026-10-21. 편집 화면의 발표자 노트 크기 조절.

## 변경

- 고정 높이였던 편집 화면 아래 노트 패널에 마우스/포인터로 잡는 위쪽 경계를 추가했다. 위로 끌면 커지고 아래로 끌면 줄어든다. 입력 영역이 패널을 채우고 슬라이드의 화면 맞춤도 자동 계산한다.
- 기본/최소 높이는 73px이다. 화면이 작아지면 슬라이드 공간을 남기도록 높이를 제한하고, 다시 커지면 사용자가 선택한 높이를 복원한다. 설정은 기기에만 저장하며 문서 내용·실행 취소 이력과 분리한다.
- 두 번 클릭하면 기본 높이로 돌아간다. 키보드 ↑/↓ 20px·Shift 50px·Home/End를 지원하며 드래그 중 Esc/포인터 취소/포커스 이탈을 처리한다. 로컬 저장 권한이 없어도 조절은 동작한다.
- 배포 시 production npm 의존성의 전체 저작권·라이선스 고지를 생성해 포함한다. JSZip은 MIT 선택지를 사용한다. 기존 무료 글꼴과 Apache 도형 자료 및 Electron/Chromium 고지를 유지한다.

- 브라우저에서 발표 종료 직후 재시작하면 이전 전체 화면 종료 이벤트가 새 발표를 닫던 경쟁 상태를 수정했다. 이전 종료 이벤트가 끝난 뒤 새 발표의 전체 화면 진입을 처리한다.

## 검증

소스와 Mac·Windows·Ubuntu 설치 앱에서 크기 조절·한글 노트·슬라이드 맞춤·노트 실행 취소·높이/내용 저장 복원·닫기/재열기·키보드·기본 높이 복원을 확인했다. 네 패키지의 버전·동일 실행 코드·원본 파일 일치·SHA-256 검사도 통과했다.

Mac 미공증·Windows 미서명 빌드다. 다운로드 경고와 Windows의 PC 보호 → 추가 정보 → 실행 안내를 유지한다. 원본 PowerPoint의 모든 글꼴·효과·조판 일치, Windows/Linux의 실제 키보드 IME 타이핑, Wayland·종이 출력은 검증 범위에 포함하지 않는다.

기존 리토스 공유 링크를 유지하며 현재 1.6.4 다운로드와 사용법으로 갱신한다.

## 소스 검사 결과

처음 전체 288개 실행은 285개 통과·환경 조건 2개 제외·발표 재시작 1개 실패였다. 전체 화면 종료를 의도적으로 지연하는 별도 사례에서도 기존 문제를 재현했다. 앱을 수정한 뒤 노트/전체 화면/발표 격리/이동 관련 20개를 다시 실행해 19개 통과·Windows 전용 1개 제외를 확인했다. 추가 사례를 포함한 유효 목록은 **289개 중 287개 통과·환경 조건 2개 제외**이며 남은 실패나 자동 재시도는 없다.

제외 항목은 이 Mac에 없는 Office Arial Nova Light와 Windows 네이티브 전체 화면 검사다. Windows 설치 앱 검증은 별도 CI에서 실행한다. 상세 결과는 `qa/results/release-1.6.4/full-regression.json`, `restart-baseline.json`, `related-recheck.json`, `final-regression-summary.json`에 있다.

로컬 빌드 도구의 일부 파일 읽기가 멈춰 잠금 파일과 같은 버전의 npm 의존성을 다시 설치했다. TypeScript가 상위의 다른 프로젝트 타입을 자동으로 읽지 않도록 타입 검색 경로도 이 프로젝트로 제한했다. 복구 후 타입 검사를 통과했다. 의존성 버전은 변경하지 않았다.

## 실제 배포 앱 검사

| 환경 | 결과 |
| --- | --- |
| Mac ARM64 앱 번들 | 별도 프로필에서 노트 높이 드래그·텍스트 입력 공간·슬라이드 맞춤·실행 취소 유지·저장/다시 열기·키보드·초기 높이 복원, 삼각형 꼭짓점 편집·PPTX 왕복, 실제 GIF/MP4/WebM 정지 미리보기·발표 재생·반복·종료 통과 |
| Windows 설치판 | 설치·전체 설치 파일 해시·바로가기·앱 등록·노트 높이 조절과 저장/복원·기존 편집 회귀·삼각형·GIF/MP4/WebM 검사·실행 중 업데이트 차단·재설치·제거·사용자 자료 보존 통과 |
| Ubuntu 22.04/24.04 amd64 X11 | 두 배포판에서 DEB 설치·실행·노트 크기 조절과 저장/복원·편집/PDF·클립보드·삼각형·GIF/MP4/WebM 검사·재설치·제거·사용자 자료 보존 통과. Chromium 샌드박스 유지 |

[Windows 실행 기록](https://github.com/beaur8-prog/slide-studio/actions/runs/39530829094) · [Ubuntu 두 버전 실행 기록](https://github.com/beaur8-prog/slide-studio/actions/runs/39530833495)

런타임 소스와 `v1.6.4` 태그 커밋은 `95fbe7773c530085943c5c6286cd908b1a74152c`이다. 네 패키지의 실행 코드 SHA-256은 `7fa125f6879391e5fe14ce85a8a38e0013bf5af1a3d6f2394a6f812e6d30f29f`로 같고 빌드 소스 53개 파일과 일치한다.

| 파일 | 바이트 | SHA-256 |
| --- | ---: | --- |
| Slide-Studio-mac-arm64.zip | 129816053 | `81a0877c33796fd7799083daa4207ffc7e97aff7e26ea5fbb0bdf7268f7bf7ba` |
| Slide-Studio-win-x64.zip | 156989073 | `6e7a8c2aba2d3a7ade9c695ef5c920c27ba46997f8100e790a6e5cbfdde696da` |
| Slide-Studio-Setup-x64.exe | 109622037 | `5ee9a48fd8ac7e28f12461f92f3d14e4daf9f541e2f8beffcec73b8e7da948ab` |
| Slide-Studio-linux-amd64.deb | 132476406 | `fa0a93c006b9cc9e673a179033c34809cf32e13737501a3a38c5f0e702024a8f` |

배포용 Mac 번들은 ZIP을 다시 풀어 서명 무결성을 확인했다. Apple 공증을 뜻하지 않는다. 사용 중인 로컬 Mac 앱의 교체는 화면 잠금으로 보류했으며 기존 사용자 문서나 프로필을 종료·수정하지 않았다. 배포 번들은 별도 프로필에서 검증했다.

## 공개 배포 확인

[GitHub v1.6.4](https://github.com/beaur8-prog/slide-studio/releases/tag/v1.6.4)를 공개하고 [기존 리토스 다운로드 문서](https://pink-photos-barrel-activation.trycloudflare.com/s/209727b046a226e48d2c00d344cf6facbd4bdb99d62595a6)를 같은 URL·공유 토큰·생성일로 갱신했다. 서버와 터널도 재시작하지 않았다. Windows를 맨 위에 두고 PC 보호의 추가 정보 → 실행 안내와 다운로드 경고를 유지했다. 노트 크기 조절 사용법과 실제 설치판 화면을 추가했다.

공개 문서 본문과 이미지 16개가 검토본과 일치하며, 기존 latest/download 주소 5개에서 1.6.4 파일을 끝까지 다시 받아 바이트 수·SHA-256·GitHub 첨부 파일 digest까지 확인했다. `qa/results/release-1.6.4/publication-verification.json`에 결과를 기록했다.

현재 버전만 남기는 기존 정리 방침에 따라 1.6.3의 GitHub 첨부 파일 5개와 리토스/로컬 publication의 이전 이미지 폴더를 삭제했다. 이전 릴리스 설명과 Git 태그는 보존했고 1.6.4 다운로드에는 영향이 없다.
