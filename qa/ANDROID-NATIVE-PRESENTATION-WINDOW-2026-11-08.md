# 반복 Esc 제보 후 Android 발표 창 경로 변경

## 확인한 사실과 남은 정보

공개 Android Slide1.0.5(`android-v1.0.8`)를 내려받아 확인했다. 이전 Esc/Back 차단과 명시적 홈 종료 처리가 포함되어 있다. 버전이 오래됐다는 가정으로 제보를 설명하지 않는다.

사용자 환경은 Slide Studio **1.0.5**, **Galaxy Tab S8+ / Android16 / One UI8**로 확인됐다. 일반 태블릿 모드(DeX 아님)에서 블루투스·USB 외부 키보드의 Esc를 사용한다. 단말의 WebView 버전·실제 종료/백그라운드 전환 여부는 아직 미확인이다. Android15 ARM64/WebView124 에뮬레이터의 공개 APK 코드 재현본에서는 뷰어 발표를 Esc/Back으로 6회 반복해도 앱 종료가 재현되지 않았다. 따라서 사용자 단말의 원인이 확정됐다고 표현하지 않는다.

반면 공개 APK는 DOM requestFullscreen()으로 별도 WebChromeClient CustomView를 만들고 원래 WebView를 숨겼다. 기존 네이티브 SystemBars/ScreenOrientation과 이 창의 종료 수명이 겹치는 경로가 남아 있었다. 이를 제거하는 구조 변경을 했다. 구버전에서 `viewerPresentationNeverCreatesSeparateFullscreenView`가 실패한 것은 이 새 구조 조건의 불일치이며, 사용자 제보의 앱 종료를 재현한 결과가 아니다.

## 변경

- Android 네이티브 SystemBars hide/show가 제공되는 APK는 DOM requestFullscreen()을 호출하지 않는다. 기존 앱 창과 원래 WebView에서 fixed 발표 표면, SystemBars, ScreenOrientation으로 화면을 채운다.
- 이 네이티브 모드에서는 DOM fullscreenchange가 쇼를 끝내지 않는다. 다른 DOM 창의 종료 이벤트와 실제 발표 종료를 분리한다.
- Esc/Back 전용 종료 이벤트와 기존 명시적 홈 close 계약은 유지한다. 데스크톱 Electron, 일반 Android 브라우저, 구형 StatusBar 전용 호스트는 기존 전체 화면 경로를 사용한다.
- 원래 WebView에 머무를 때 편집 키보드가 발표 공간을 차지하지 않도록 Slide setSlideImmersive(true)가 IME도 숨긴다.
- Slide의 Esc 처리를 WebView `onKeyPreIme`에도 연결한다. 일반 Activity 키 전달 전에 입력기가 처리하는 경로를 보완하고, 길게 누른 반복 down과 발표 종료 후 up까지 소비한다. 최초 down만 발표 종료를 요청한다.
- Android13 이상에서는 Back을 기존 `OnBackInvokedCallback` 한 곳으로만 전달한다. `KEYCODE_BACK`을 동시에 가로채 명령이 중복 실행되는 경로를 제거한다. Android12 이하의 Back down/up 처리는 유지한다. Sheet/Word의 기존 키보드 처리는 유지한다.

## 실제 검증

- Android 보기/편집/확대/태블릿/발표 브라우저 검사41개 통과. 변경한 네이티브 발표 검사7개를 마지막에 다시 통과했다(중복이므로 합산하지 않음).
- 데스크톱 발표·판서·전체 화면 검사22개 통과, Windows 네이티브 검사1개는 이 Mac에서 생략.
- main과 Android1.0.5 입출력 보존 브랜치의 TypeScript·프로덕션 빌드, Gradle 디버그 앱/검사 APK 빌드 통과.
- Android15/ARM64/WebView124.0.6367.219 실제 에뮬레이터에서 태블릿11개 통과, 휴대폰10개 통과/태블릿 전용1개 생략.
- 원래 WebView가 계속 VISIBLE이고 native CustomView와 document.fullscreenElement가 없는 상태로 쇼가 표시되는지 확인했다. 편집/뷰어 복귀, 반복 Esc/Back, 늦은 Back 해제, false/null 응답, 공유 close, 홈의 명시적 종료, 실제 도형 갤러리, IME 숨김을 검사했다. 각 프로필의 반복을 별도 합산하지 않는다.
- 네이티브 뷰어 반복 검사에서는6회 진입/종료하고 각 종료 후 Esc를 다시 눌러도 뷰어가 유지됐다. 검사 후 Android crash 버퍼는 비어 있었다.

## Android16에서 추가로 재현한 문제

Google APIs Android16/API36 ARM64, WebView133.0.6943.137, 1752×2800/280dpi 태블릿 환경을 별도로 만들었다. One UI나 삼성 입력기는 포함되지 않으므로 실제 Galaxy Tab S8+ 결과로 표현하지 않는다.

1. 기존 코드는 WebView의 입력기 이전 Esc를 소비하지 않았다. `preImeEscapeEndsOnlyPresentationAndConsumesBothEdges`가 수정 전에 실패했다. 이 검사는 누락된 입력 경로를 재현한 것으로, 단말 앱 종료 재현과는 다르다.
2. 시스템 Back 한 번에 키 처리의 Escape 명령과 시스템 Back 콜백이 함께 실행됐다. 명령 횟수가 기대1회 대신2회였고, 발표 종료 후 뷰어를 지나 홈으로 돌아가는 것을 실제 검사에서 확인했다. `android16-back-double-before.log`에 `show:false, viewer:false, home:true`와 횟수2가 남아 있다. Activity 종료 자체는 이 AOSP 환경에서 재현되지 않았다.
3. Android13 이상에서 수동 `KEYCODE_BACK` 가로채기를 제거하고 기존 `OnBackInvokedCallback`을 사용한다. Esc는 별도 문서 명령으로 처리한다. [Android 공식 Back 이전 가이드](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture)와 [입력기 이전 키 처리 API](https://developer.android.com/reference/android/view/View#onKeyPreIme(int,%20android.view.KeyEvent))를 기준으로 구분했다.

회귀 검사는 Activity 메서드를 직접 호출하는 Back 검사 외에 실제 OS 입력 큐와 `UiDevice.pressBack()`을 사용한다. 키보드 주입에는 가상 키보드 장치 ID·시스템 키 플래그·키보드 입력 소스를 지정하고 발표 창의 포커스와 네이티브 immersive 상태를 기다린다. Android15에서 발견한 입력 누락은 `ImmersiveModeConfirmation` OS 최초 안내가 포커스를 잡은 상태임을 스크린샷과 `dumpsys window`로 확인했다. 격리된 QA 에뮬레이터만 `immersive_mode_confirmations=confirmed`로 준비했다. 사용자 단말이나 공용 설정은 변경하지 않았다.

최종 코드(`2642ecf`)는 Android16에서 **13개 통과 / 구형 Android 전용1개 조건 제외**였다. JUnit 콘솔은 등록14개를 `OK (14 tests)`로 출력하지만 `legacyPreImeBackConsumesReleaseAfterShowExit`는 API33 미만 조건으로 실행되지 않았으므로 통과 수에 더하지 않는다. 뷰어6회 Esc/Back 반복, 시스템 Back 한 번당 명령1회, 키보드 Back down/up, 입력기 이전 Esc·반복·up, 편집/뷰어 복귀, 홈 명시적 종료, IME 숨김, 원래 창 유지, 태블릿 도형 갤러리를 확인했다. Android15에서는 변경한 실제 OS Back·키보드 Back·입력기 이전 Esc·뷰어 반복4개를 다시 통과했다. 두 환경의 최종 crash 버퍼는 비어 있었다.

Slide 앱/검사 APK와 Sheet·Word Java 컴파일을 통과했다. Sheet·Word 기능을 실행 검사했다는 의미는 아니다. Android12 이하의 별도 런타임 검사와 One UI8 실제 단말 검사는 수행하지 않았다. 공개1.0.5의 실제 Activity 종료 원인이 확정됐다고 표현하지 않는다.

추가 원시 로그: `android16-preime-before.log`, `android16-back-double-before.log`, `android16-native-tablet.log`, `android16-test-runner.log`, `android16-environment.json`, `android16-crash-buffer.log`, `android15-modern-back-compatibility.log`. 검사 준비 중 실패한 이벤트 주입/OS 안내 로그도 별도 파일로 보존했다.

## APK 근거와 한계

공개1.0.5 SHA-256: `92710993b512b78131758bf62386097087d85510583c9df8890a47d371ae679e`.
REA 정적 인벤토리 Evidence: `ev_f98f59d4db85de3815aa55b32f37110f7fdea0ed1f4db1fc4e08182566d183b8`, parent `ev_9a1c0e99547b612defe934bdc5857ccd5a9326a5ef7e89e36bad92e1d8edfd3f`. 이 인벤토리는 실행 관찰이 아니다. 키 코드는 SDK apkanalyzer로 확인했다.

공개 APK의 DEX/웹 자산을 변경하지 않고 테스트 키로만 다시 서명한 격리 재현본으로 구버전을 비교했다. 수정본은 비공개 디버그 APK다. 실제 제조사 태블릿/DeX/외부 키보드에서 동일 문제가 해결됐다는 증거로 확장하지 않는다.

원시 로그·APK 식별·DEX 코드: `qa/results/android-native-window-20261108/` (Git 제외). `baseline-viewer.log`에는 구버전 반복 검사 통과와 별도 창 미사용 조건 실패가 구분돼 있다. `current-native-tablet.log`, `current-native-phone.log`, `window-tests.log`, `browser-tests.log`, `desktop-tests.log`, `current-crash-buffer.log`에 수정본 결과가 있다.

## 배포

앱과 호스트의 개발 브랜치는 `codex/android-native-window-20261108`이다. 공개 APK/공유 문서와 사용자 설치본은 갱신하지 않았다. 다음 별도 배포 시 버전/versionCode를 올리고 새 앱 자산과 IME 변경을 기존 정식 서명으로 빌드해야 한다. 사용자 기종·OS·앱 버전은 위와 같이 확인됐으며, 외부 키보드·일반 태블릿 모드도 확인됐다. 실제 단말 로그로 남은 원인을 확인해야 한다.
