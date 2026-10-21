# Slide Studio 1.6.5

2026-10-21. PPTX 표 행 높이 보존.

외곽 프레임 높이가 명시된 행 높이 합계보다 작을 때 행을 강제로 축소하던 문제를 수정했다. 외곽 72pt·32pt × 4행의 표는 각 행 32pt를 유지하고 전체 높이를 128pt로 확장한다. 자체 표 메타데이터, 병합 셀, 불균등 행, 그룹 세로 배율에도 적용한다. 외곽이 더 큰 표의 기존 여유 높이 배분은 유지한다.

[재현·수정 기록](TABLE-IMPORT-ROW-HEIGHT.md)과 [재현용 PPTX](../tests/fixtures/table-frame-72pt-rows-32pt-x4.pptx)를 포함했다. 프로젝트/PPTX 저장 왕복·한글 표시와 표·가져오기·그룹·선택·크기 조절 관련 45개 검사를 통과했다. 전체 앱 회귀 검사를 이번 버전에서 다시 실행한 결과는 아니다. 네 패키지의 버전·동일 실행 코드·소스 파일 일치·SHA-256을 확인했고 Mac·Windows·Ubuntu 설치 앱도 검증했다.

기존 리토스 공유 URL과 고정 다운로드 주소를 유지한다. Windows를 맨 위에 두며 PC 보호 → 추가 정보 → 실행과 다운로드 경고 안내도 유지한다. Mac 미공증·Windows 미서명 배포다.

원본 PowerPoint의 모든 글꼴·효과·조판 일치, Windows/Linux의 실제 키보드 IME 타이핑, Wayland·종이 출력은 검증 범위에 포함하지 않는다. 사용 중인 Mac 앱 교체는 화면 잠금으로 보류하며 배포 앱은 별도 임시 프로필에서 검증한다.

## 실제 배포 앱 검사

| 환경 | 결과 |
| --- | --- |
| Mac ARM64 앱 번들 | 별도 임시 프로필에서 재현 표의 행 32pt × 4·전체 128pt·한글 표시·자동 저장 후 복원, 노트 높이 조절·기억, 삼각형 꼭짓점·PPTX 왕복, GIF/MP4/WebM 재생·반복·종료 통과 |
| Windows 설치판 | 동일 재현 표의 행/전체 높이·한글·저장 복원과 기존 편집·노트·도형·미디어 검사 통과. 설치 파일 해시·바로가기·등록·실행 중 업데이트 차단·재설치·제거·사용자 자료 보존 통과 |
| Ubuntu 22.04/24.04 amd64 X11 | 두 환경에서 동일 재현 표의 행/전체 높이·한글·저장 복원과 편집/PDF·클립보드·노트·도형·미디어 검사 통과. DEB 설치·재설치·제거·사용자 자료 보존, Chromium 샌드박스 유지 확인 |

[Windows 실행 기록](https://github.com/beaur8-prog/slide-studio/actions/runs/39543249065) · [Ubuntu 두 버전 실행 기록](https://github.com/beaur8-prog/slide-studio/actions/runs/39543258183)

화면 크기는 브라우저의 서브픽셀 단위로 반올림된다. 실제 표시 높이는 128pt/32pt 각각에서 0.05pt 이내이며 모델과 PPTX 왕복의 정확한 높이는 소스 회귀 검사로 확인했다.

`v1.6.5` 런타임 소스 커밋은 `64276303880524f6faba4b4c097d1d303d627c28`이다. 네 패키지의 실행 코드 SHA-256은 `c690ca9909053bf8ce0a1048946545d7d1156ad01ea501ce54ff010436f6dd57`로 같고 빌드 소스 53개 파일과 일치한다. Mac ZIP을 다시 풀어 코드 서명 무결성도 확인했다. Apple 공증을 뜻하지 않는다.

| 파일 | 바이트 | SHA-256 |
| --- | ---: | --- |
| Slide-Studio-mac-arm64.zip | 129816070 | `59f9d955aa30ae21cc53962870f972543a6d404f4e8621165eb67de5b9cd08c3` |
| Slide-Studio-win-x64.zip | 156989085 | `8cb7bd2355ec9b4da4d7b5e519d250e6f54e77679d38645858eaff03fec2ffac` |
| Slide-Studio-Setup-x64.exe | 109723790 | `a2addd2d28a4abb2158e4a94d92b381af082af2d2cc7a5024c7f66f75b281a00` |
| Slide-Studio-linux-amd64.deb | 132476352 | `41dad959617c2063d473fb6d737370735414170265c7f6b60a2155b79402eaed` |

## 공개 배포 확인

[GitHub v1.6.5](https://github.com/beaur8-prog/slide-studio/releases/tag/v1.6.5)를 공개하고 [기존 리토스 다운로드 문서](https://pink-photos-barrel-activation.trycloudflare.com/s/209727b046a226e48d2c00d344cf6facbd4bdb99d62595a6)를 같은 URL·토큰·생성일로 갱신했다. 서버와 터널을 재시작하지 않았다. Windows 설치 안내를 맨 위에 유지하고, 표 높이 수정 설명과 원본 PPTX를 다시 여는 방법 및 실제 설치판 화면을 추가했다.

공개 문서와 이미지 17개가 검토본과 일치한다. 기존 latest/download 주소 5개에서 1.6.5 파일을 끝까지 다시 받아 바이트 수·SHA-256·GitHub digest를 확인했다. 검증의 마지막 상태 JSON 기록에서 지역 변수 이름이 겹치는 오류를 수정하고 공유 상태·문서 본문을 다시 확인해 기록을 완료했다. 실행 코드와 배포 파일은 변경하지 않았다. 증거는 `qa/results/release-1.6.5/publication-verification.json`과 `record-finalization.json`에 있다.

현재 버전만 남기는 기존 정리 방침에 따라 1.6.4 GitHub 첨부 파일 5개와 리토스/로컬 publication의 이전 이미지 폴더를 삭제했다. 이전 릴리스 설명과 Git 태그, 1.6.5 다운로드는 보존했다.
