# PPTX 저장 통일과 문서 폴더 기억

2026-10-21. 다음 배포용 소스 변경이며 공개 1.6.5 설치 파일과 리토스 공유 문서는 갱신하지 않았다.

- 파일 메뉴·빠른 저장·상단 버튼·명령 검색·Ctrl/⌘+S·OS 파일 메뉴의 저장을 PPTX 하나로 통일했다. `.slide` 생성과 별도 PPTX 내보내기 메뉴를 제거했다. 저장은 기존처럼 파일 대화상자에서 위치와 이름을 선택한다.
- 기존 `.slide` 파일은 계속 열어 PPTX로 옮길 수 있다. 기기의 자동 저장·이전 문서 복원은 유지하며 기존 파일을 삭제하거나 자동 변환하지 않는다. PPTX 자체의 지원 범위는 [호환성 문서](../IO_NOTES.md)를 따른다.
- 네이티브 파일 읽기 또는 PPTX 저장에 성공한 폴더를 다음 열기·저장·PDF 대화상자의 시작 위치로 사용한다. 앱을 재실행해도 기억한다. 취소·읽기/쓰기 실패는 폴더를 바꾸지 않으며, PDF 출력도 현재 문서 폴더를 바꾸지 않는다. 폴더가 없어지면 Documents를 사용한다.
- 폴더 설정은 사용자 프로필의 `file-dialog-location.json`에만 보관한다. 설정 저장이 실패해도 실제 파일 저장은 성공하며 실행 중에는 새 폴더를 기억한다.
- PPTX 파일 형식만 저장하도록 브리지 입력을 제한했다. 사용자가 확장자를 생략하거나 다른 확장자를 입력하면 `.pptx`를 붙인다. 확장자를 붙인 실제 경로에 기존 파일이 있으면 덮어쓰기를 다시 확인한다. 저장 진행 중 반복 명령은 중복 실행하지 않는다.

## 검증

수정 전 검사에서 열기 대화상자의 `defaultPath`가 없음을 재현했다. 수정 후 관련 **29개 검사와 프로덕션 빌드가 통과**했다.

```sh
npx playwright test tests/native-save-folders.spec.ts tests/native-files.spec.ts tests/windows-ui.spec.ts tests/office-shell.spec.ts tests/presentation-isolation.spec.ts tests/pptx-save.spec.ts tests/presentation-ink.spec.ts tests/production.spec.ts
npm run build
```

검사 범위는 성공/취소/실패·재실행·삭제된 폴더·설정 쓰기 실패, 확장자 보완과 덮어쓰기 취소/승인, Windows 저장 단축키와 모든 저장 메뉴, 저장 중 중복 명령, 기존 `.slide`의 한글·노트를 PPTX로 저장 후 재가져오기, 발표 판서와 저장 격리 및 프로덕션 PPTX UI 저장이다.

Mac Electron 프로덕션 빌드를 별도 임시 프로필에서 실제로 두 번 실행했다. 네이티브 IPC를 통해 파일을 열고 PPTX/PDF를 디스크에 저장했으며 ZIP/PDF 읽기, 문서 폴더의 우선 사용·재실행 후 기억·PDF 출력 후 유지, 이전 `.slide` 원본 보존과 PPTX 변환을 확인했다. 파일 선택 창의 응답은 검사용으로 지정하고 전달된 네이티브 대화상자 옵션을 검사했다. 잠긴 화면에서 OS 대화상자를 직접 조작한 수동 검사는 아니다.

로컬 증거는 `qa/results/pptx-save/`의 `baseline.log`, `regression.log`, `build.log`, `native.json`, `native-pptx-save.png`에 있다. 사용 중인 앱·사용자 문서·프로필은 유지했다. 실제 사용 중인 Mac 앱 교체는 화면 잠금으로 보류했다.

## 첫 실행 빈 문서

자동 저장 문서가 없는 첫 실행은 예제 대신 텍스트·도형·노트가 없는 빈 슬라이드 한 장으로 시작한다. 기존 자동 저장 문서의 복원과 새 문서 메뉴의 예제 선택은 유지했다. 여러 장이 필요한 기존 검사는 `scripts/qa-open-sample.cjs`로 예제를 명시적으로 선택한다.

프로덕션 빌드가 통과했다. 스크롤·발표 격리/전체 화면·노트 크기 조절·한글/300장 편집·PPTX 가져오기/저장·화면 구성 검사 **23개가 통과**했고 Windows 네이티브 전체 화면 검사 한 개는 Mac에서 건너뛰었다. 별도 임시 프로필의 Mac Electron 앱을 세 번 실행하여 최초 빈 문서, 문서 이름·노트 편집의 재실행 후 복원, 예제 선택 및 기존 예제 복원을 확인했다. 로컬 증거는 `qa/results/blank-start/native.json`, `first-launch.png`, `restored-sample.png`, `regression/`에 있다. 공개 배포와 사용 중인 앱 교체는 하지 않았다.
