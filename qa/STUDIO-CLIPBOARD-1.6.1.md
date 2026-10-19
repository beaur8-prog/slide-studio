# Studio 앱 간 표 복사 — Slide Studio 1.6.1

2026-10-19. 소스와 Mac 로컬 앱에 적용하는 변경이며 공개 릴리스·리토스 배포와 구분합니다. 상대 앱은 Sheet Studio 0.7.10, Word Studio 1.2.11입니다.

## 사용 순서

1. Sheet에서 셀 범위를 선택하거나 Word에서 **표 안 우클릭 → 표 편집 → 표 전체 선택**을 누릅니다. Slide에서는 표 하나 또는 셀 범위를 선택합니다.
2. **홈 → 복사** 또는 **⌘C / Ctrl+C**를 누릅니다.
3. 상대 앱의 문서·시작 셀을 선택합니다. Slide에서는 빈 영역을 클릭하면 새 표가 생기고, 기존 표 셀을 선택하면 그 위치에 적용됩니다.
4. **홈 → 붙여넣기** 또는 **⌘V / Ctrl+V**를 누릅니다. 한 번의 실행 취소로 되돌립니다.

HTML과 표시값 TSV를 함께 전달합니다. 한글·빈 셀·줄바꿈·병합, 셀 글꼴·색·배경·맞춤·테두리와 행/열 크기를 지원 범위에서 보존하며 수신한 표는 편집할 수 있습니다. 실시간 연결은 없고 Sheet의 수식은 표시값으로 전달합니다. 여러 Slide 개체의 복사는 기존 앱 내부 복사를 따르므로 다른 앱에 표를 보낼 때는 표 하나를 선택하세요.

## 이번 보완

- 표 HTML과 비트맵 미리보기가 함께 복사되면 표를 먼저 읽습니다. HTML이 없는 일반 이미지 붙여넣기는 유지합니다.
- 브라우저 홈 붙여넣기는 한 ClipboardItem의 HTML·TSV를 읽고 다른 항목의 텍스트를 섞지 않습니다. 일반 텍스트 읽기만 지원하는 브라우저도 처리합니다.
- 비동기 읽기 도중 문서·슬라이드·개체/셀 선택·입력 위치·모달·발표 상태가 바뀌면 기존 요청을 취소합니다. 클립보드 권한이 없을 때 앱 내부 복사를 사용하는 기존 대체 경로에도 같은 검사를 적용합니다.
- 데스크톱 홈·개체 우클릭은 제한된 IPC에서 정상 paste 이벤트를 발생시킵니다. IPC가 거부되면 처리되지 않은 오류 대신 키보드 붙여넣기 안내를 표시합니다.
- 대상 병합의 일부만 덮는 표 붙여넣기는 원본을 바꾸지 않고 거부합니다. 완전한 범위의 내용·서식·병합 교체는 한 번의 실행 취소로 복원합니다.

## 검증

세 앱의 빌드를 확인했습니다. Slide 관련 검사 29개는 28개 통과 후 새 테스트의 셀 선택자를 수정해 나머지 1개를 별도 실행하여 통과했습니다. Word의 표·교환 검사는 14개, Sheet의 교환 단위 검사는 3개가 통과했습니다. Sheet의 실제 OS 클립보드 검사도 통과했습니다.

격리한 Mac 앱 프로필과 실제 OS 클립보드로 Sheet→Word, Word→Sheet, Sheet→Slide, Slide→Sheet, Word→Slide, Slide→Word 여섯 방향을 확인했습니다. 병합·표시값·색·테두리·줄바꿈·한글 및 Word 붙여넣기 실행 취소를 검사했습니다. 사용자 문서를 열지 않으며 종료 시 표준 텍스트·HTML·RTF·이미지 클립보드를 복원합니다.

같은 검사를 **Mac 앱 번들 세 개로도 통과**했습니다. Sheet 0.7.10·Word 1.2.11·Slide 1.6.1을 명시적인 실행 파일 경로로 지정했으며, Slide의 51개 실행 파일은 빌드 소스와 바이트 단위로 일치합니다. 실행 코드 커밋은 `3037492107fe06572c2042c2f534847895afd1a1`, `app.asar`의 SHA-256은 `876b977516be860dfbfb39d9232e426353784109319824f9cbb9cae340a9b2b2`입니다.

`/Applications/Slide Studio.app`을 검증한 1.6.1로 교체하고 재실행했습니다. 기존 6장 문서의 수정된 첫 장 텍스트, 마지막 장 발표자 노트와 저장 상태를 확인했으며 업데이트 전 사용자 프로필과 앱을 보관했습니다. 공개 1.6.0 릴리스와 리토스 문서는 갱신하지 않았습니다.

```sh
# slide-studio
npm run build
npx playwright test tests/studio-clipboard.spec.ts tests/priority-safety.spec.ts tests/native-files.spec.ts tests/office-shell.spec.ts

# 나란히 빌드한 세 저장소, sheet-studio에서 실행
node scripts/studio-clipboard-smoke.mjs
```

로컬 로그·이미지는 `qa/results/studio-clipboard-1.6.1/`와 Sheet의 `test-results/suite-clipboard-*.png`에 보관합니다. 실제 Windows/Linux 앱 간 클립보드 실행, Microsoft Office와의 상호 운용 시험은 이번 검증에 포함하지 않습니다.

## 제한

Slide는 100행·50열, 셀당 2,000자·표 전체 50,000자, HTML 10 MiB까지 읽습니다. 셀 내부의 여러 글자 서식은 첫 텍스트 구간 서식으로 단순화하고 점선·파선·이중 테두리는 실선으로 변환합니다. 없는 글꼴과 수신 앱의 배치에 따라 모양·크기가 달라질 수 있습니다. 차트·그림·메모·매크로·외부 연결·수식 원본은 이 표 교환에 포함하지 않습니다.

세 앱의 계약 원문은 [STUDIO-CLIPBOARD.md](https://github.com/beaur8-prog/sheet-studio/blob/main/docs/STUDIO-CLIPBOARD.md)에 있습니다. 공통 `src/studio-table.mjs`는 Sheet 저장소와 동일하며 이번 보완에서 변경하지 않았습니다.
