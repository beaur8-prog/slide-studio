# Android 발표 도구 모음 숨김 수정 — 2026-11-08

## 재현과 원인

펜·레이저 선택 후 아래 발표 도구 모음을 닫을 수 없었다. `AndroidPresentationControls`는 drawing 상태일 때 표시를 강제하고 자동 숨김도 제외했다. 새 회귀 검사는 기존 코드에서 `controls.toBeHidden()`에 실패했다.

네이티브 검사 중 별도 겹침 문제도 재현했다. 새 문서 생성 알림(z-index 110)이 발표 화면(z-index 90) 위에서 펜·레이저 버튼을 덮었다. 처음에는 표시 직후의 화면 갱신 문제로 의심했지만 대기를 늘려도 실패했다. 실제 스크린샷과 터치 이벤트의 SPAN 대상, 브라우저 좌표 적중 검사 실패로 알림이 원인임을 확인했다. 실패 로그는 보존했다.

## 변경

- 펜·레이저 팔레트를 열면 큰 하단 도구 모음을 접는다. 도구를 선택해도 접힌 상태를 유지한다.
- 도구 모음에 ‘숨기기’를 추가했다. 펜·레이저 모드에서도 다시 연 뒤 4초 후 자동으로 숨긴다. 키보드 초점이 모음 안에 있으면 초점을 잃지 않도록 자동 숨김을 유보한다.
- 판서 중과 발표 종료 화면에서는 모서리의 작은 ‘도구’ 버튼으로 다시 연다. 선택한 도구·기존 판서·현재 슬라이드는 유지한다.
- 작은 버튼의 흰색 글자가 일반 Android 버튼 규칙에 덮이지 않도록 CSS 우선순위를 수정했다.
- Android 발표 화면을 편집 알림보다 위에 표시해 도구·팔레트의 터치가 가로채이지 않도록 했다. 데스크톱 발표 화면의 표시 순서는 변경하지 않았다.

## 검증

- 최종 브라우저 검사 **30개 통과**: `android-show-zoom`, `android-presentation`, `presentation-ink` 27개 + `android-ui`의 immersive touch slideshow / Android back / editor starts a show 3개. 반복 실행은 통과 개수에 합산하지 않았다.
- 펜·레이저 유지, 실제 터치 판서, 숨김·다시 열기, 4초 자동 숨김, 종료 화면에서 복귀, 기존 핀치·확대·발표 종료, 알림이 버튼을 가리지 않는 좌표 적중 검사를 포함한다.
- main과 Android1.0.6 입출력 어댑터 보존 브랜치의 TypeScript·프로덕션 빌드 통과.
- Android16/API36 ARM64, WebView133.0.6943.137, 1280×800/160dpi 가로 에뮬레이터에서 네이티브 UiDevice 터치 검사 **1개 통과**. 새 문서 → 발표 → 도구 선택 → 펜 판서 → 작은 버튼으로 다시 열기 → 숨기기를 실행했다. 마지막에도 pen 모드와 판서 1개가 유지되고 Activity가 종료되지 않았음을 확인했다.
- 접힘·펼침 스크린샷을 확인했다. 작은 ‘도구’ 버튼의 흰색 아이콘·글자와 기존 판서가 보존된다. 최종 crash 버퍼는 비어 있다.
- 실제 Galaxy Tab S8+ / One UI8 하드웨어 검사는 수행하지 않았다. 네이티브 검사는 펜으로 수행했고 레이저 상태·터치는 브라우저에서 검증했다.

## 소스와 배포 범위

- main 최종 기능 커밋: `2e7c238be5b5514c759fa14bd1ac1fb6fedbe8d5` (주 수정 `22e5545`, 가독성 `c542ec9`, 알림 겹침 `2e7c238`).
- Android 소스 브랜치 `codex/android-object-menu-20261108`: `cf8461f098a8d93cf8dfaebc11ea896a1fb96709`. 이전 개체 메뉴 수정과 Android 파일 입출력 어댑터를 유지한다.
- 네이티브 검사 커밋: `877314aa6a6c77ba57f8174da10012c2a047b828`.

개발용 디버그 APK만 빌드·실행했다. 공개 APK·버전·리토스 문서·다운로드 링크는 변경하지 않았다. 현재 설치된1.0.6에는 자동 반영되지 않는다. 별도 배포 요청 시 버전/versionCode를 올리고 기존 정식 서명으로 빌드해야 한다.

원시 증거는 로컬 `qa/results/android-tools-20261108/`에 보존한다(Git 제외): `before.log`, `trigger-color.log`, `toast-before.log`, `final-suite.log`, `final-workflows.log`, `final-build.log`, `native-before-toast-fix.log`, `native-diagnostic-2.log`, `native-android16-final.log`, `native-environment.json`, `native-crash-buffer.log`, `presentation-tools-failure.png`, `presentation-tools-collapsed.png`, `presentation-tools-expanded.png`. 네이티브·Android 소스 빌드 로그는 `/private/tmp/slide-tools-native-final-build.log`, `/private/tmp/slide-tools-android-final-build.log`.
