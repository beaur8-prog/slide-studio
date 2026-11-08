# Android 태블릿 데스크톱 편집·쇼 종료 네이티브 검증

## 결과

태블릿은 기존 데스크톱 편집 UI 자체를 사용한다. 간소화 AndroidEditorBar를 태블릿에 마운트하지 않는다. 상단 제목/저장/발표, 6개 탭과 모든 리본 명령, 전체 22개 도형 갤러리, 슬라이드 목록, 노트, 작업 창, 하단 상태/배율 도구를 공유한다. 세로 태블릿은 명령을 축소/생략하지 않고 필요한 리본 영역만 가로 스크롤한다. 휴대폰은 기존 터치 UI를 유지한다.

쇼 종료는 일반 뒤로가기와 독립된 `slide-studio-android-end-presentation` 이벤트로 전달한다. APK에서 Esc와 발표 중 Back의 누름·해제를 소비한다. 일부 키보드 경로에서 Esc가 Back으로 전달되는 경우와 전체 화면 종료 후 늦은 키 해제도 처리한다. 웹이 응답하지 않거나 false/null을 반환했다는 이유로 Activity를 종료하지 않는다. 앱 종료는 홈 화면의 명시적인 `close` 결과에만 허용한다. 공통 `close` 요청도 Slide에서는 이 판정을 거친다. Sheet/Word의 기존 키/종료 경로는 보존한다.

## 이전 APK 조사와 재현

공개 Slide Studio 1.0.4(`android-v1.0.7`)에 이전 KEYCODE_ESCAPE=111 차단 코드가 실제로 들어 있음을 SDK apkanalyzer의 DEX 코드로 확인했다. 따라서 이전 수정이 빠졌다고 판단하지 않았다. 반면 `onBackPressed()`는 웹 응답 false/null이면 finish()를 호출했다.

공개 APK의 DEX/웹 자산 52개를 변경하지 않고 로컬 Android 디버그 키로만 다시 서명한 **격리 재현본**에서 웹 false 응답 상황을 만들었다. 실제 Android 15 에뮬레이터에서 `falseCallbackMustNotFinishActivity`가 Activity 종료로 실패했다. 수정 APK에서는 동일 검사를 통과했다. 이 결과는 사용자 단말의 실제 키 코드를 수집해 동일 입력을 관찰했다는 의미는 아니다. 물리 제조사 키보드/DeX별 전달 방식은 미확인이다.

- 원본 APK SHA-256: `c3421dec730d8695fd62703410e10c7721c655864124bb563a6a18105ed423be`.
- REA APK 정적 인벤토리: Evidence `ev_a7ddbd4817d6e427a4450273377133f1242ba8e06d59e7e8710918def1b0b9a6`, parent `ev_6a073f86f5fb90cffd94719e4b3513dfec169906f4ac2ea8fe41a12caa53f981`. APK 인벤토리는 실행 동작 증거가 아니다.
- REA의 JADX provider는 필수 JAR가 없어 사용할 수 없었다. DEX 코드는 설치된 공식 SDK apkanalyzer로 확인했고, 실행 검증은 아래 Android 에뮬레이터에서 별도로 수행했다. REA 등록/설정은 변경하지 않았다.

## 검증

- Android 보기·편집·발표·플랫폼 분리 및 태블릿 전용 검사 **41개 통과**.
- 데스크톱 편집/도형 서식/발표/판서/링크 검사 **29개 통과, Windows 네이티브 1개 생략**. 위 Android 검사와 다른 파일 집합이며 총 브라우저 70개 통과다.
- 태블릿 가로 1280×800·세로 800×1280에서 데스크톱의 상단/6개 리본/목록/작업 창/상태바 명령 목록을 직접 비교했다. 전체 22개 갤러리와 타원·블록 화살표 삽입, 채우기/선 서식, 저장, 발표를 검사했다.
- 실제 host JS 종료 계약 검사 **9개 통과**. 발표 중 전용 종료, 일반 Back 분리, 미응답의 unavailable 처리, 홈의 명시적 close, 이전 자산 키 이벤트 대체 경로, Sheet/Word 분리를 포함한다.
- 실제 Android: API 35/ARM64, WebView 124.0.6367.219, 임시 Pixel 6 에뮬레이터. 휴대폰 1080×2400/420dpi에서 네이티브 6개 통과(태블릿 전용 1개 생략). 태블릿 1600×2560/240dpi에서 7개 전부 통과했다. 홈 Back의 정상 종료를 추가 확인했고, 갤러리 캡처를 그리기 완료 후 다시 확인했다.
- 네이티브 시나리오: false/null 응답에도 Activity 유지, 실제 Esc 키로 쇼 종료/편집 복귀, Esc가 Back으로 전달되는 누름·해제, 네이티브 Back 콜백, 공통 close 요청이 쇼만 종료, 실제 태블릿 전체 도형 갤러리, 홈 Back 정상 종료. 같은 시나리오의 프로필별 반복을 별도 합산하지 않는다.
- main/Android 파일 입출력 보존 브랜치의 TypeScript·프로덕션 빌드 통과. SDK 36/JDK 17의 Gradle 디버그 앱·androidTest APK 빌드 및 설치/실행 완료. 검증용 디버그 빌드는 공식 배포용 설치 파일이 아니다.

원시 로그·SDK DEX 결과·원본/재현 APK 식별 기록·브라우저 캡처·실제 Android 캡처는 `qa/results/android-native-desktop-20261108/`에 보관한다(Git 제외). `native-phone.log`, `native-tablet.log`, `native-final-gallery-home.log`, `baseline-false-callback.log`, `controlled-replay-identity.json`, `native-tablet-full-gallery-final.png`를 참고한다.

## 적용

앱과 Office Studio 호스트를 각각 `codex/android-tablet-native-20261108`에 고정한다. 다음 APK에는 새 앱 자산과 새 호스트를 함께 포함해야 한다. 공개 릴리스·리토스·사용자의 설치본은 변경하지 않았다. 별도 배포 요청 때 Android 버전과 versionCode를 올리고 기존 정식 서명 키로 빌드한다.
