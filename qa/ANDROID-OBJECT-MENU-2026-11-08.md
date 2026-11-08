# Android 개체 우클릭 메뉴의 하단 영역 침범 수정

사용자 환경: Slide Studio Android1.0.6, Galaxy Tab S8+, Android16 / One UI8. 개체 우클릭 메뉴의 마지막 ‘개체 서식’을 누르려 할 때 하단 아이콘 영역이 눌리는 제보다.

## 원인과 재현

- 기존 메뉴는 `innerWidth/innerHeight`의8px 여백만 고려했다. 네이티브 탐색/작업 표시줄의 안전 영역, 태블릿 편집기 하단 아이콘 줄, 축소·이동된 visual viewport를 반영하지 않았다.
- 브라우저에서 하단72px에 시스템 아이콘 영역을 재현했다. 메뉴 마지막 항목을 스크롤해 좌표로 클릭했을 때 아이콘 영역이 입력을 받아 서식 패널이 열리지 않았다. `before.log`와 실패 스크린샷에 보존했다. 이 영역은 HTML 검증 fixture이며 실제 One UI를 실행한 결과는 아니다.
- 휴대폰 검사에서는 z-index110 알림이 z-index100 메뉴를 가려 클릭 대상이 `toast`로 확인됐다. `phone-hit-test.log`의 `Expected: 개체 서식 / Received: toast`가 근거다.

## 변경

- 실제 visual viewport와 Android 편집기의 해석된 패딩에서 사용 가능한 경계를 계산한다. 네이티브 안전 영역과 앱 하단 아이콘 줄 위에서 메뉴가 끝난다.
- 사용 가능한 너비·높이를 CSS 제한에 전달한다. 긴 메뉴는 메뉴 안에서 스크롤하며 마지막 항목도 선택할 수 있다.
- 네이티브 여백 변경은 ResizeObserver로, visual viewport 이동·크기 변경은 해당 이벤트로 다시 배치한다. 기존 창 크기 변경 시 메뉴 닫기와 키보드 이동·부분 선택 보존은 유지한다.
- Android 메뉴를 알림보다 위에 표시하고 메뉴의 포인터·클릭 이벤트 전파를 막는다. 알림 닫기 버튼은 유지한다.

## 검증

- 브라우저18개 통과: Android 메뉴8개(태블릿 가로/세로, 휴대폰, 실제 좌표 클릭, 여백 변경, 짧은 visual viewport), 기존 개체 메뉴5개, 부분 텍스트 선택 메뉴5개.
- main과 Android1.0.6 입출력 어댑터 보존 브랜치의 TypeScript·프로덕션 빌드 통과.
- Android16/API36 ARM64, WebView133.0.6943.137, 1280×800/160dpi 가로 태블릿의 실제 WebView/UiDevice 클릭 검사1개 통과. 메뉴가 앱 하단 줄과 네이티브 탐색 영역 위에 있고, ‘개체 서식’ 클릭 후 패널 표시·개체 선택 유지·발표/정렬 모드 미진입을 확인했다. 화면 갱신 후 열린 패널 PNG도 확인했다. 검사 재실행은 별도 통과 개수에 합산하지 않는다.
- 최초 고해상도 회전 환경에서는 `com.android.systemui`의 응답 중지 창이 앱을 가려 클릭 검사가 실패했다. 스크린샷과 XML로 확인하고 로그를 보존했다. 검증 에뮬레이터를 처음부터 가로 저해상도 구성으로 재부팅한 후 통과했다. 실제 사용자 단말이나 문서 데이터는 변경하지 않았다.
- 최종 Android crash 버퍼는 비어 있다. One UI8 실제 단말·외부 마우스에 대한 재확인은 아직 수행하지 않았다. 네이티브 검사는 메뉴를 DOM contextmenu 이벤트로 연 뒤 OS 좌표 클릭으로 선택을 검증했다.

## Git과 배포

main 수정: `2db94ea2aadf426a7d221a5e80132215f9ac92d6`.
Android1.0.6 소스 보존 브랜치 `codex/android-object-menu-20261108`: `c6158657fd36932f1e8623f3008d848043a7ff82`.
호스트의 네이티브 검사/검사 빌드 설정: `5b3dcb2de684492a46c445f0944f4f53ccf25024`.

개발용 디버그 APK만 빌드·실행했다. 공개 APK·버전·리토스 문서·다운로드 링크는 변경하지 않았다. 현재 설치된1.0.6에는 이 수정이 자동으로 포함되지 않는다. 다음 배포 때 버전/versionCode를 올리고 기존 정식 서명으로 새로 빌드해야 한다.

원시 로그·스크린샷: `qa/results/android-object-menu-20261108/` (Git 제외). `final.log`, `final-build.log`, `native-android16-final.log`, `native-environment.json`, `native-crash-buffer.log`, `object-menu-native-open.png`, `object-menu-native-format.png`.
