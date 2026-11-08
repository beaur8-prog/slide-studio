# Android 일반 화면의 상태바 공간과 편집 바로가기

## 기준과 원인

배포된 Slide Android 1.0.2 소스(`656b544`, Office Studio 호스트 `8146a96`)를 확인했다. 이전 화면 여백 수정은 포함되어 있지만 `MainActivity.setSlideImmersive(false)`가 `systemBars()` 전체를 다시 표시했다. 따라서 발표를 벗어난 뷰어·편집·시작 화면에서는 상단 상태바가 계속 공간을 차지했다. 이를 단순히 설치가 오래된 탓으로 판단하지 않는다.

## 수정

- Slide APK는 시작부터 상단 상태바를 숨긴다. 뷰어·편집·시작 화면에도 동일한 정책을 적용한다.
- 발표 중에는 하단 탐색바도 숨기고, 발표를 끝내면 하단 탐색바만 복원한다. 파일 선택창이나 다른 앱에서 복귀해 포커스를 다시 받으면 현재 모드에 맞게 적용한다.
- 일시적으로 상태바를 펼쳐도 해당 높이를 CSS 안전 여백에 다시 더하지 않는다. 카메라 구멍, 창 모드의 제목 표시줄, 하단 탐색 영역과 키보드의 안전 여백은 유지한다. 상태바는 화면 가장자리 스와이프로 잠시 볼 수 있다. [Android 공식 전체 화면 API](https://developer.android.com/develop/ui/views/layout/immersive)
- 뷰어 상단에 연필 아이콘과 `편집`을 함께 표시한다. 기존 `onEdit` 경로를 사용하므로 이전 복구 자료 보관·열려 있는 문서·현재 슬라이드를 유지한다. 문서 메뉴의 편집 항목도 유지한다.
- Android 전용 컴포넌트와 Slide 전용 네이티브 분기만 변경한다. Sheet/Word의 별도 전체 화면 요청 및 데스크톱/iPad 편집 UI는 변경하지 않는다.

## 검증

- Android 보기·편집·발표·플랫폼 격리 회귀 검사 **32개 전부 통과**.
- 360×800 휴대폰, 800×360 가로 휴대폰, 1280×800 태블릿에서 상단 편집 버튼 표시/48px 이상 터치 크기/화면 범위를 검사했다. 두 번째 슬라이드에서 편집에 진입해 같은 슬라이드의 텍스트를 확인한 뒤 보기로 돌아왔고, 수정 상태가 생기지 않았다. 360px 화면 캡처를 직접 확인했다.
- main 및 APK 전용 파일 열기·저장 연결과 병합한 개발 브랜치의 TypeScript·프로덕션 빌드를 확인한다.
- 네이티브 MainActivity와 androidTest Java 전체 소스가 JDK 17·공식 Android SDK 36·프로젝트 AndroidX 의존성으로 javac 컴파일 통과했다. APK 조립을 뜻하지 않는다.
- `SlideWindowInstrumentedTest`에 실제 창의 상태바/탐색바 표시, 발표 종료·포커스 복귀, 일시적 상태바 inset과 카메라·키보드 안전 여백 검사를 추가했다. 이 검사는 컴파일만 했고 Android 기기/에뮬레이터에서는 아직 실행하지 않았다.

로그와 화면은 `qa/results/android-reader-fullscreen-20261108/`에 보관한다(Git 제외). 새 APK 조립·서명·설치·공개 배포는 하지 않았다. 설치된 앱의 동작은 Git 반영만으로 바뀌지 않으며, 다음 APK에는 웹 자산과 Office Studio 네이티브 호스트 변경을 함께 포함해야 한다.

## 소스 위치

- Slide UI: main 및 `codex/android-reader-fullscreen-20261108` (Android 1.0.2 입출력 코드 보존)
- Office Studio 네이티브 호스트: `codex/android-reader-fullscreen-20261108`
- 릴리스 버전과 공개 다운로드는 유지한다. 다음 배포 때 Android versionName/versionCode를 올린다.
