# Android Esc 종료 경로·편집 발표·리본 개선

## 변경 내용

- APK `MainActivity`에서 Slide 전용 `KEYCODE_ESCAPE`를 받는다. 첫 ACTION_DOWN만 웹의 `OfficeStudioHost.escape()`로 전달하고, ACTION_UP·자동 반복은 함께 소비한다. 처리되지 않은 Esc도 Activity의 종료/뒤로가기 경로로 넘기지 않는다. Sheet/Word의 키 처리는 그대로 유지한다.
- `studio-host.js`의 Slide 전용 Escape 연결은 취소 가능한 DOM keydown 한 번을 발생시킨다. 앱 종료 요청·뒤로가기 대체 호출은 하지 않는다.
- Android의 Esc와 시스템 뒤로가기를 구분한다. 발표 중 Esc는 기존 판서/메뉴 우선 처리 후 쇼를 끝내고 기존 보기·편집 모드로 돌아온다. 편집에서 다시 누르면 선택/편집/메뉴를 취소하며 앱이나 편집 화면을 나가지 않는다. 일반 뷰어에서도 Esc로 시작 화면까지 이동하지 않는다. 시스템 뒤로가기는 기존 화면 이동을 유지한다.
- 편집 화면 상단에 `발표` 버튼을 추가했다. 현재 슬라이드에서 시작하며, 리본의 `슬라이드 쇼`에는 `처음부터 발표`와 `현재 슬라이드에서 발표`를 제공한다. 저장 전 입력 처리와 슬라이드/문서 복원은 기존 startPresent/stopPresent를 사용한다.
- Android 편집 화면에 `홈·삽입·디자인·전환·슬라이드 쇼·보기` 리본 탭을 적용했다. 기존 글꼴·단락/도형/선택/슬라이드 관리, 텍스트·그림·표 삽입을 유지하고 기존 테마·비율·전환·보기 함수를 연결했다.
- 태블릿(너비 840px/높이 600px 이상)은 도구 옵션과 오른쪽 서식 창을 도킹해 슬라이드를 덮지 않는다. 휴대폰/낮은 가로 화면은 옵션 팝업과 가로 스크롤 도구로 공간을 확보한다. 탭은 ARIA tablist/tabpanel 및 좌우·Home·End 키 이동을 지원하며, 탭 선택만으로 문서가 수정되지 않는다.
- 화면 QA에서 데스크톱 `.office-shell .canvas-area`가 Android의 12px 여백을 덮는 충돌을 발견했다. Android 선택자 우선순위를 높여 자동 화면 맞춤이 계산한 여백과 실제 여백을 일치시켰다. 휴대폰·태블릿에서 슬라이드 전체가 캔버스 경계 안에 들어오는지 검사했다.

## 확인한 원인과 검증 범위

기존에는 웹 keydown Esc 처리만 있었고 APK의 하드웨어 Esc 누름/해제를 앱 종료 경로와 분리하는 코드가 없었다. 브라우저의 기존 Esc 검사로는 APK Activity의 기본 키 처리를 확인할 수 없다. 네이티브 경로 누락을 소스에서 확인하고 해당 경로를 분리했으며, 사용자 단말에서 종료되는 현상을 직접 재현한 것은 아니다.

- 기존 Android 검사 32개 통과 후 두 개의 새 편집/리본 시나리오를 추가했다.
- Android·데스크톱 발표/판서/링크 전체 브라우저 회귀: **57개 통과, 1개 건너뜀, 실패 없음**. 건너뜀은 Mac에서 실행 불가능한 Windows 네이티브 전체 화면 검사다.
- 화면 여백 수정 후 영향을 받는 Android UI 22개 재검사 통과. 도킹·화면 맞춤·휴대폰/태블릿 경계 검사는 최종 한 번 더 통과했다. 중복 검사이므로 위 숫자와 합산하지 않는다.
- 실제 host JS를 VM에 실행한 Esc 연결 검사 4개 통과: 한 번의 취소 가능한 keydown, 종료 호출 없음, 처리되지 않은 Esc에도 종료 없음, Sheet/Word 동작 분리.
- main 및 APK 전용 파일 입출력을 유지한 Android 개발 브랜치의 TypeScript·프로덕션 빌드를 확인한다.
- 실제 Android 프로젝트에서 `compileSlideReleaseJavaWithJavac`와 `compileSlideReleaseAndroidTestJavaWithJavac` Gradle 컴파일 통과. JDK 17/SDK 36/기존 의존성 캐시 사용.
- `SlideEscapeInstrumentedTest`는 실제 키 누름/해제, 반복 입력, 쇼 종료 후 편집 문서/수정 상태 보존, 처리되지 않은 Esc의 Activity 유지 시나리오를 추가했다. 이 검사는 **컴파일만 했고 실기기/에뮬레이터에서는 아직 실행하지 않았다**.

원시 로그·화면: `qa/results/android-editor-escape-20261108/` (Git 제외). 휴대폰/가로 휴대폰/태블릿 캡처를 직접 확인했다. 화면 맞춤 수정 후 슬라이드가 잘리지 않았다.

## 적용 위치

- Slide 소스: main 및 `codex/android-editor-escape-20261108`.
- Android 호스트: `office-studio`의 `codex/android-editor-escape-20261108` (최신 Slide APK 1.0.3 호스트 기준, Sheet의 기존 전체 화면·생명주기 변경 보존).
- 앱 자산과 APK 호스트를 **함께 빌드해야** 물리 Esc 수정이 적용된다. 현재 설치본은 Git 반영만으로 바뀌지 않는다.
- 새 APK 조립·서명·설치·GitHub Release/리토스 갱신은 수행하지 않는다. 별도 배포 요청 때 버전과 versionCode를 올려 진행한다.
