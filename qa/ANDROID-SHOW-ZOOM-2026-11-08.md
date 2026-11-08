# Android 발표 확대·아이콘·화면 여백 개선 — 2026-11-08

## 반영 내용

- Android 슬라이드 쇼에서 두 손가락으로 100~500% 확대/축소한다. 확대 상태에서는 한 손가락 끌기로 현재 장 안에서 이동한다. 화면 맞춤 상태의 좌우 스와이프만 장을 넘긴다.
- 두 번 탭하면 해당 지점을 확대하고, 다시 두 번 탭하면 화면 맞춤으로 돌아온다. 도구 패널에도 `확대`, `축소`, `화면 맞춤 · 현재 배율` 버튼을 제공한다.
- 확대 중심과 이동 범위를 슬라이드/화면 크기로 계산한다. 확대 상태에서 가장자리를 넘겨 끌어도 빈 흰 영역을 만들지 않으며, 화면 회전/크기 변경과 장 이동 때 화면 맞춤으로 초기화한다.
- 두 손가락 동작은 판서와 구분한다. 펜으로 누르는 도중 확대를 시작하면 미완성 획만 취소한다. 이전 판서는 유지하며 확대 상태의 실제 SVG 경계로 좌표를 계산한다. 레이저·지우개 판정 크기도 화면 배율을 반영한다.
- 확대는 표시 상태이며 PPTX 개체 위치·크기·글자·Undo 이력·수정 상태에 저장하지 않는다. 미디어와 판서 컴포넌트를 확대 때문에 새로 마운트하지 않는다.
- 점 세 개만 있던 발표 버튼을 펜 아이콘과 `펜·레이저`라는 이름으로 바꿨다. 손 모양의 `화면 이동`, `검은 화면`, `발표 종료`도 이름을 함께 표시한다. 보기 화면의 메뉴·화면 맞춤 버튼에도 글자를 붙였다.
- 휴대폰의 도구는 4열·2행으로 표시하고 각 버튼은 최소 48px 터치 영역을 확보한다. 기본 발표에서는 숨겨져 있고 공간을 예약하지 않는다. 펜/레이저를 선택한 동안에는 화면 이동 모드로 돌아갈 수 있게 도구를 유지한다.

## 왼쪽 흰 영역 대응과 확인 범위

사용자가 빨간 원의 아이콘은 확대·화면 맞춤 아이콘이며 설치된 APK에서 확인 중이라고 답했다. 보기 화면의 해당 버튼에 `화면 맞춤`을 표시했다. 흰 영역의 스크린샷은 전달되지 않아 실제 기기와 직접 대조하지 못했지만 앱 UI 노출 검사와 아래 네이티브 원인 수정을 함께 진행했다.

1. Android 발표 영역의 기본 포커스 테두리·테두리·그림자를 제거했다.
2. 발표 영역을 화면 안에서 클리핑하고, 슬라이드 밖 여백과 발표 중 문서 루트/본문 배경을 검정으로 통일했다. 다른 CSS 파일의 기본 발표 배경색이 덮어쓰지 않게 선택자 우선순위도 조정했다.
3. 스크린리더용 숨김 버튼이 일반 버튼의 최소 크기·여백을 상속하지 않게 했다. 구형 WebView를 위한 기존 clip 방식도 함께 사용한다.
4. 20:9 화면에서 16:9 문서를 보여주는 경우 왼쪽 검정 여백의 여러 픽셀을 검사했다. 흰 버튼·테두리·배경이 노출되지 않았다. 원본 슬라이드 안의 흰 배경/도형을 제거하는 처리는 하지 않는다.

앱 내부 여백과 숨김 컨트롤에 대한 재현 검사는 통과했다. 추가 조사에서 APK 호스트가 발표 중에도 displayCutout의 왼쪽 여백을 부모에 적용하는 것을 확인했다. 아래 호스트 수정에 함께 반영했다.

## 상태바 영역까지 사용하는 연결

- 기존 브라우저 전체 화면의 `navigationUI: hide`, Android `viewport-fit=cover`, Capacitor `SystemBars.hide()/show()`와 방향 전환 요청을 유지한다.
- Capacitor 8 Android의 선택적 `CapacitorSystemBarsAndroidInterface.onDOMReady()` 연결이 있으면 발표 진입/복귀 때 viewport 설정을 다시 읽고 native inset 계산을 갱신한다. 늦게 변경된 viewport 때문에 호스트가 예전 여백을 유지하는 경우에 대응한다. 없는 호스트에서는 호출하지 않는다. [해당 Capacitor 8 구현](https://github.com/ionic-team/capacitor/blob/8.0.0/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java)
- `SystemBars`가 없는 호스트에서 기존 `StatusBar` 플러그인이 있으면 `setOverlaysWebView({overlay:true})`와 숨김을 요청한다. 종료 때 이전 overlay 설정과 상태바를 복원한다. 이 대체 경로는 상단 상태바용이며 하단 탐색바 전체 지원으로 계산하지 않는다. [StatusBar 공식 API](https://capacitorjs.com/docs/apis/status-bar)
- Android 15/16의 edge-to-edge 정책은 SDK/OS 설정에 따라 동작하며 구형 overlay 설정이 적용되지 않는 경우가 있다. 최종 Android 호스트의 Window/WebView 설정은 별도로 확인해야 한다. [Android edge-to-edge 안내](https://developer.android.com/develop/ui/views/layout/edge-to-edge)

Android 배포 브랜치의 `ANDROID-RELEASE.md`를 통해 실제 APK 호스트가 `beaur8-prog/office-studio`의 Android 프로젝트임을 찾았다. 일반 Capacitor 앱이 아니라 `studio-host.js`로 SystemBars·ScreenOrientation 호환 API를 제공하는 WebView 호스트다.

- 네이티브 부모가 발표 중에도 `displayCutout` inset을 padding으로 적용하는 것을 제거했다. Slide 전용 창은 Android 10에서 shortEdges, Android 11 이상에서 ALWAYS를 명시하고, WebView가 상태바/카메라 영역까지 차도록 한다.
- Slide에서 네이티브 부모 padding은 키보드 높이만 처리한다. 상태바·카메라 안전 여백은 CSS 픽셀 단위의 `--studio-safe-area-inset-*`로 전달한다. 일반 화면의 버튼과 발표 도구는 이를 피하고 슬라이드 자체는 화면 전체를 사용한다. 브라우저는 기존 `env(safe-area-inset-*)`를 사용한다.
- 발표 진입 시 창·부모·WebView 배경을 검정으로 채우며 종료 시 일반 화면으로 복원한다. 포커스 복귀 시 발표가 계속 중이면 시스템 바를 다시 숨긴다. Sheet/Word의 창 처리는 변경하지 않는다.
- 웹 검사에서 상단 28px·왼쪽 40px·하단 24px·오른쪽 12px를 모사해도 발표 캔버스는 960×450 전체를 쓰고, 버튼만 안전 영역 안에 배치되며, 종료 후 보기 화면의 여백이 복원되는 것을 확인했다.

호스트 코드는 Office Studio의 `codex/android-screen-ui-20261108` 브랜치에 분리한다. SDK 36과 프로젝트의 AndroidX core 1.13.1/webkit 1.14.0으로 변경된 MainActivity를 javac 컴파일했다. 네이티브 insets/키보드 회귀 검사도 추가했다. **실제 Android 단말/에뮬레이터에서 실행한 결과는 아니며 APK 조립·서명·설치·배포는 수행하지 않았다.**

## 검증

- TypeScript·프로덕션 빌드 통과.
- 네이티브 안전 여백 추가 후 Android UI·호스트 연결·발표 확대 검사 **31개 전부 통과**. 아래 최초 검증과 겹치는 검사이며 별도 합산하지 않는다.
- **54개 중 53개 통과, 1개 건너뜀, 실패 없음.** 건너뜀은 이 Mac에서 실행할 수 없는 Windows 네이티브 전체 화면 검사다.
- Android 보기/편집·플랫폼 격리 19개, 전체 화면/호스트 연결 6개, 새 발표 확대 5개, 기존 발표·판서·부분 링크 검사를 실행했다.
- 실제 Chromium 터치 입력을 사용해 핀치 → 이동 → 축소 → 장 넘김, 두 번 탭, 500% 제한, 취소, 회전/화면 크기 변경, 확대된 상태의 판서를 검사했다.
- 펜 획의 시작 좌표를 확대된 SVG 경계와 대조했다. 판서 중 핀치해도 이전 획 수가 유지됐고, 미완성 획이 문서에 남지 않았다.
- 확대/이동 후 조회 문서의 dirty 상태가 생기지 않았고, 기존 데스크톱 발표와 링크 동작도 유지됐다.
- 휴대폰 360px 너비에서 이름이 붙은 도구 버튼의 크기·가로 넘침을 검사하고 화면 캡처를 확인했다.

초기 새 픽셀 검사는 여백이 검정에 가까운 기존 기본색(`#090b08`)으로 덮이는 것을 찾아 실패했다. Android 발표 선택자의 우선순위를 높여 정확한 검정(`#000000`)으로 고친 뒤 최종 검사를 통과했다. 이 발견을 사용자 기기의 흰 영역과 동일한 원인이라고 단정하지 않는다.

검증 환경은 이 Mac의 Chrome/Chromium + Android UA·터치 모사다. Android 실기기·TalkBack·물리 상태바/회전 검증을 대체하지 않는다. 로그·JSON·화면은 `qa/results/android-zoom-20261108/`에 보관한다.

```sh
npx playwright test tests/android-ui.spec.ts tests/android-presentation.spec.ts tests/android-show-zoom.spec.ts tests/presentation-fullscreen.spec.ts tests/presentation-navigation.spec.ts tests/presentation-ink.spec.ts tests/partial-links-presentation.spec.ts
npm run build
```

개발 버전 1.6.23 소스에 반영한다. Windows·Mac·Linux·iPad에는 Android 제스처와 화면 스타일을 적용하지 않는다.
