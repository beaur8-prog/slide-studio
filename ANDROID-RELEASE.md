# Android 개발 브랜치 · Esc와 편집 리본

배포된 Android 1.0.3(`448121d`, versionCode 4)의 파일 열기·저장 연결을 유지하고 main의 편집 발표·리본·Esc 구분을 병합했습니다.

앱과 Office Studio 호스트는 각각 `codex/android-editor-escape-20261108` 브랜치입니다. 물리 Esc 키의 앱 종료 방지는 네이티브 MainActivity와 studio-host.js 변경도 필요하므로 앱 자산과 호스트를 함께 빌드해야 합니다. `qa/ANDROID-EDITOR-ESCAPE-2026-11-08.md`에 변경과 검증 범위를 기록했습니다.

새 APK 조립·서명·설치·공개 배포는 하지 않았습니다. 기준 버전 1.0.3은 유지합니다. 별도 배포 요청 시 Android versionName/versionCode를 올리고 기존 applicationId/서명 키를 유지해 새 웹 자산과 호스트를 함께 빌드해야 합니다.
