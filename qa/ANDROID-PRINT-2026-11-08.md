# Android 인쇄·PDF 저장 — 2026-11-08

## 사용 경로

- 뷰어: 문서 메뉴 → 인쇄·PDF 저장.
- 휴대폰 편집: 보기 → 인쇄·PDF 저장.
- 태블릿 편집: 기존 파일 → 인쇄 / PDF 내보내기. 외부 키보드 Ctrl+P도 같은 인쇄 경로를 사용한다.
- 시스템 창에서 프린터 또는 PDF 저장을 선택하고 용지·방향 등을 지정한다. 현재 문서 전체를 슬라이드 한 장당 용지 한 페이지에 맞춘다. 원본 PPTX를 변경하지 않는다.

## 구현

기존 Android 브랜치는 현재 편집기 WebView를 일반 인쇄 어댑터로 보내는 연결만 있었고 뷰어·휴대폰 리본의 진입점이 없었다. 화면 DOM을 그대로 보내면 뷰어 UI나 용지와 다른 슬라이드 크기가 인쇄에 섞일 수 있었다.

인쇄 직전에 편집 중인 값을 확정하고 기존 지연 인쇄 DOM을 생성한다. 글꼴·이미지 준비 후 슬라이드 artwork만 독립 HTML로 복제한다. 화면 확대, 메뉴, 알림, 편집 UI는 복제하지 않는다. blob 이미지·배경은 data URL로 바꿔 별도 WebView에도 전달한다. 텍스트와 SVG는 화면 캡처로 평탄화하지 않는다.

호스트의 `slidePrint` 요청은 기존 128MiB 청크 전송을 이용한다. Slide flavor만 요청을 받으며 용지 크기·장수·전송 완성을 검사한다. 별도 `SlidePrintSession` WebView에서 로컬 패키지 자산과 data 이미지만 읽고, 글꼴·이미지 준비를 확인한 다음 Android PrintManager를 연다. 선택한 실제 용지와 최소 여백에 따라 슬라이드를 비율 유지·가운데 맞춤으로 축소한다. 준비 시간 초과·오류·인쇄창 종료·Activity 종료 때 렌더러와 임시 HTML을 정리한다. 원래 편집기 WebView와 문서 상태를 유지한다.

브라우저 회귀 검사 및 native 시스템 미리보기에서 페이지 나누기도 확인했다. 초기 native 검사에서는 데스크톱용 `@page size`가 선택 용지와 충돌해 2장 자료가 4페이지로 나뉘었다. 복제할 때 데스크톱 인쇄 크기 규칙을 제외하고 Android PrintAttributes만 용지 크기를 결정하게 수정했다. 최종 A4 출력은 2페이지다. Android HTML 인쇄의 용지 제약은 [Android 공식 인쇄 가이드](https://developer.android.com/training/printing/html-docs)를 참고했다.

## 검증

- 최종 브라우저 **8개 통과**: Android 인쇄 3개, 기존 브라우저 인쇄/PDF 2개, 지연 렌더링·인쇄 DOM 생성/해제 3개. 편집한 한글의 출력 반영, 메뉴 진입, 중복 인쇄 차단, 취소·실패 후 재시도, blob 그림 전달, 읽기 모드 수정 상태 유지와 UI 제외를 확인했다.
- main과 Android 입출력 어댑터 보존 브랜치의 TypeScript·프로덕션 빌드 통과. Android debug 앱·검사 APK 빌드 통과.
- Android16/API36 ARM64, WebView133.0.6943.137, 1280×800/160dpi 에뮬레이터에서 OS 검사 **1개 통과**. 실제 메뉴 터치 → 인쇄창 → 취소 → 뷰어 복귀 → 다시 인쇄 → A4 선택 → 시스템 저장창의 저장 버튼 터치 → PDF 생성 → 뷰어 복귀를 검증했다. pending 인쇄 작업과 렌더러가 해제되고 문서 dirty 상태가 false임을 확인했다. 반복 실행은 별도 통과 개수에 합산하지 않았다.
- Android PdfRenderer와 Poppler pdfinfo로 PDF **2페이지, 각 841×595pt(A4 가로)**를 확인했다. 마지막 출력 PDF의 두 페이지를 PNG로 렌더링해 한글 제목, 표 4셀, 빨간 타원 SVG, 녹색 PNG, 슬라이드 배경이 보존되고 잘림·빈 추가 페이지·앱 UI가 없음을 확인했다. 최종 crash 버퍼는 비어 있다.
- 검사 절차 보완: 처음 선택되지 않은 프린터 상태에서 미리보기 준비를 기다리던 문제, 용지 목록의 ISO A4 찾기, 저장 위치 서랍의 Downloads와 배경 툴바 제목을 혼동하던 문제, UIAutomation 셸 명령에 연결 연산자를 사용하던 문제를 수정했다. 최종 검사는 서랍을 닫고 실제 OS 저장 버튼을 터치한다. 실패 기록은 로컬에 보존했다.
- 실제 Galaxy Tab S8+ / One UI8 단말과 물리 프린터에서는 확인하지 않았다. 시스템 미리보기와 PDF 저장으로 검증했으며, 실제 프린터 연결은 사용자 Android 인쇄 서비스의 장치 선택을 사용한다.

## Git·배포 범위

main 기능: `d3e566af6f4429fde975019ea363a6af7217aacf` (`e32cffa`, `d3e566a`).
Android 소스 브랜치 `codex/android-object-menu-20261108`: `8235d7ceb7818438253ac4f467eae5eb6b0296bb`.
호스트 구현: `3161d4e`; 최종 OS 검사: `6809ca7bc15255484c3cdd28b6e97ddb3e1d510a`.

디버그 APK만 전용 에뮬레이터에서 실행했다. 공개 앱 버전, 서명, 리토스 문서, APK 다운로드 링크는 변경하지 않았다. 기존1.0.6에는 자동 적용되지 않으며 다음 별도 배포에서 버전/versionCode를 올려야 한다. 이전 개체 메뉴·펜 도구 모음 수정, Word/Sheet 소스 고정값과 로컬 리토스 첨부 배포 정책을 유지했다.

원시 증거(Git 제외): `qa/results/android-print-20261108/`의 `regression-final.log`, `main-build.log`, `native-touch-final.log`, `native-environment.json`, `crash-buffer-final.log`, `native-touch-final/SlideStudio-Print-QA.pdf`, 해당 PDF의 `.json`, `verified-page-1.png`, `verified-page-2.png`. 앞선 실패는 `native-initial.log`, `native-final.log`, `native-a4-final.log`, `native-save-final.log`, `native-verified.log` 등으로 보존한다. Native/Android 소스 빌드 로그는 `/private/tmp/slide-android-print-native-build.log`, `/private/tmp/slide-android-print-native-test-build.log`, `/private/tmp/slide-android-print-source-final-build.log`.
