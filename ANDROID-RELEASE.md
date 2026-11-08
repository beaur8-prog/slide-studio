# Android 개발 브랜치 · 태블릿 데스크톱 UI와 네이티브 쇼 종료

배포된 Android 1.0.4(`72989db`, versionCode 5)의 입출력 연결에 main의 태블릿 데스크톱 UI와 전용 쇼 종료 이벤트를 병합했습니다. 앱과 Office Studio 호스트는 각각 `codex/android-tablet-native-20261108`입니다.

태블릿은 실제 데스크톱 리본·22개 도형·작업 창을 그대로 사용합니다. 호스트는 Esc/Back으로 쇼만 끝내고, 웹 false/null 응답으로 앱을 닫지 않습니다. 두 소스를 함께 빌드해야 합니다. 실제 Android 15 휴대폰/태블릿 에뮬레이터에서 검증한 내용은 `qa/ANDROID-TABLET-DESKTOP-AND-NAVIGATION-2026-11-08.md`에 있습니다.

로컬 검증용 디버그 APK만 빌드·실행했습니다. 공개 배포와 사용자 설치본은 변경하지 않았으며 기준 버전은 1.0.4입니다. 별도 배포 요청 때 Android 버전/versionCode를 올리고 기존 정식 서명 키로 빌드해야 합니다.
