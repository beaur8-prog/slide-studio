# Android 개발 브랜치 · 원래 앱 창에서 발표

Android1.0.5의 파일 입출력을 유지하고 APK 발표가 별도의 WebView 전체 화면 창을 만들지 않도록 변경했습니다. 기존 Native SystemBars/ScreenOrientation과 fixed 발표 표면으로 화면을 채우고, 발표 때 가상 키보드도 숨깁니다.

앱·호스트는 각각 `codex/android-native-window-20261108`입니다. Android15 휴대폰/태블릿 에뮬레이터의 반복 Esc와 원래 WebView 유지 검사를 통과했습니다. 사용자 기기의 실제 종료는 이 환경에서 재현되지 않았으며 기종/버전 확인이 남아 있습니다. 자세한 사실·한계는 `qa/ANDROID-NATIVE-PRESENTATION-WINDOW-2026-11-08.md`에 기록했습니다.

비공개 검증 APK만 빌드·실행했습니다. 공개 배포와 사용자 설치본은 변경하지 않았습니다. 다음 별도 배포 시 Android 버전/versionCode를 올리고 새 앱 자산과 IME 변경을 기존 정식 서명 키로 함께 빌드해야 합니다.
