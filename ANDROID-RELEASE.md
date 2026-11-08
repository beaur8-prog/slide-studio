# Android 개발 브랜치 · 뷰어 편집과 상단 상태바 공간

배포된 Android 1.0.2(`656b544`, versionCode 3)의 파일 열기·저장 연결을 유지하고 main의 뷰어 `편집` 바로가기를 병합했습니다. 앱 소스와 Office Studio 호스트는 각각 `codex/android-reader-fullscreen-20261108` 브랜치입니다.

호스트는 일반 뷰어·편집·시작 화면에서도 상단 상태바를 숨기고, 발표를 끝내면 하단 탐색바만 복원합니다. `qa/ANDROID-READER-FULLSCREEN-2026-11-08.md`에 원인과 검증 범위를 기록했습니다.

새 APK 조립·서명·설치·공개 배포는 수행하지 않습니다. 현재 앱 버전은 기준 1.0.2로 유지합니다. 별도 배포 요청 시 Android versionName/versionCode를 올리고 기존 applicationId/서명 키를 유지해 웹 자산과 변경된 호스트를 함께 빌드해야 합니다.
