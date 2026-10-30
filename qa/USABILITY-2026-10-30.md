# PowerPoint 사용성 비교 후 개선 — 2026-10-30

검수 시작 소스는 `19314fa`(패키지 1.6.15), 기존 설치 앱은 1.6.14였다. PowerPoint 공개 사용법과 실제 편집 시나리오를 비교해 아래 6개 항목을 재현하고 수정했다. 공개 릴리스·설치 파일·리토스 문서는 이번 작업에서 갱신하지 않는다.

## 수정과 재현 시나리오

| 우선순위 | 재현한 문제 | 수정한 동작 | 검증 |
|---|---|---|---|
| 높음 | 개체를 선택하고 Tab을 누르면 포커스만 이동해 방향키·삭제가 이전 개체에 적용됨 | 포커스와 실제 선택을 함께 이동. Shift+Tab·순환·그룹 단위 이동, 숨긴 개체 건너뛰기 | 이동·삭제·Undo, 리본 Tab·표·목록 Tab과의 충돌, 변경 이력 없는 탐색 |
| 높음 | 검색이 표 셀을 누락하고 일치하는 슬라이드가 많아도 10개만 표시됨 | 전체 빠른 검색과 표 포함 찾기·바꾸기. 노트·대소문자·단어 단위, 개별/일괄 변경 | 500장·1,000곳, 20,000곳 안전 한도와 표시, 잠금·자동 필드 보호, 서식·링크·줄바꿈 유지, 원자적 Undo |
| 보통 | 텍스트 상자 선택 상태에서 굵게·기울임·밑줄 단축키가 동작하지 않음 | 개체 선택에도 Ctrl/⌘+B/I/U 적용. 편집 중 부분 선택은 기존 네이티브 동작 유지 | 텍스트·도형·표, 부분 선택, 실행 취소·재실행 |
| 보통 | 그림에 자르기·맞춤·채우기·교체가 없음 | 고정 프레임 안에서 이동·배율을 조절하는 자르기 창. 적용/취소, 교체 시 위치·회전·그룹 보존 | 원본 GIF 바이트와 자르기의 PPTX 왕복, 잠금·손상 파일·늦은 비동기 읽기 보호, 취소/동일 결과 이력 없음 |
| 보통 | 레이어가 일반 이름만 표시하고 다중 선택·숨김·순서 변경을 제공하지 않음 | 독립 선택 창. Ctrl/⌘·Shift 선택, F2 이름, 눈 아이콘, 드래그/화살표 순서, 그룹 계층 | 중복 이름·중첩 그룹·비대칭 테두리 3회 왕복, 개별/그룹 숨김 분리, 1,000개 개체·100개 그룹, 숨김의 발표/PDF 반영 |
| 보통 | 완성한 개체의 서식을 다른 개체로 복사할 수 없음 | 서식 복사 한 번/반복 적용, Ctrl/⌘+Shift+C/V, 우클릭 서식 붙여넣기 | 일부 글자만 적용, 기존 밑줄 제거, 링크·문단 속성 유지, 네이티브 Undo/Redo, 도형의 위치·크기·내용 보존, 표 셀 범위 |

선택 창 이름·숨김은 표준 PresentationML `cNvPr@name`, `cNvPr@hidden`을 사용한다. 이름의 중복을 허용하며, 비대칭 테두리의 소유자를 추적하는 내부 키와 표시 이름을 분리했다. 상위 그룹을 표시해도 개별적으로 숨겼던 자식은 계속 숨겨진다.

## 전체 검사 중 발견한 회귀

서식 복사 항목을 우클릭 메뉴 맨 위에 추가하면서 기존 키보드 탐색의 첫 항목과 다음 항목이 바뀐 2건을 발견했다. 잘라내기·복사·붙여넣기·삭제의 순서를 유지하고 서식 항목을 그 뒤에 배치했다. 메뉴는 최대 480px 안에서 스크롤되며 Home/End·방향키로도 끝 항목에 접근한다. 부분 선택 텍스트를 우클릭해 서식을 붙이는 경로와 마우스로 범위를 드래그해 서식을 적용하는 경로를 포함한 18개 재검사를 통과했다.

## 실제 패키지 검사

`scripts/qa-usability.cjs`는 별도 임시 프로필의 Mac 패키지에서 다음 6개 흐름을 수행한다. 파일 선택 창의 응답만 테스트 프로세스 안에서 지정하고 실제 렌더러·파일 IPC·디스크 쓰기/읽기를 실행한다. 사용자 프로필과 열려 있던 문서에는 연결하지 않는다.

1. 27장 전체 빠른 검색과 표 셀 찾기.
2. Tab 실제 선택과 개체 서식 단축키.
3. Beta만 서식 복사 적용, 선택 유지, 네이티브 Undo/Redo.
4. 선택 창 이름 변경·숨김·표시, 자르기 창 취소.
5. 숨긴 도형과 부분 서식을 포함한 실제 PPTX 저장·재열기.
6. 재열기 후 실제 앱 PDF 내보내기.

27쪽 PPTX의 구조 검사를 통과했다. 앱 PDF 27쪽을 렌더링해 한글 제목·표, 첫 장의 숨긴 도형 제외, Beta 부분 서식을 확인했다. LibreOffice 변환에서는 한글 글리프/문자 매핑 문제가 나타났고 기존 설치 1.6.14의 동일 입력에서도 같았다. 이번 변경으로 해결했다고 주장하지 않는다. 앱 자체 PDF의 한글 표시와 텍스트 추출은 정상이다.

## 공개 실무형 문서

`qa/workplace-samples.json`에 고정된 SHA-256과 일치하는 파일을 다시 확보했다. 3개·34장의 열기와 저장 왕복에서 슬라이드 수, 텍스트와 그림 수를 보존했다. 자동 검사상 글자 잘림과 겹침 후보, JavaScript 실행 오류는 없었다. 모든 외부 문서에 대한 픽셀 일치를 뜻하지 않는다.

| 문서 | 장수 | 화면이 열리기까지 | PPTX 생성 | 생성+재가져오기 |
|---|---:|---:|---:|---:|
| Dickinson 브랜드 템플릿 | 2 | 350ms | 59ms | 84ms |
| Dickinson 실무 예제 | 9 | 247ms | 48ms | 89ms |
| Microsoft FY26 Q4 | 23 | 400ms | 250ms | 382ms |

같은 Mac의 측정값이며 하드웨어와 부하에 따라 달라진다. 첫 전체 회귀 실행에서 1,000개 개체 선택 창은 열기 348ms·전체 선택 331ms·숨김 319ms였고, 500장 문서의 1,000곳 찾기는 773ms·일괄 변경은 621ms였다. 여기에 파일 디코딩과 대용량 미디어 저장 시간은 포함되지 않는다.

## 재실행 명령

```sh
npm run build
npx playwright test
npm run test:updates
npm run test:registration
node scripts/qa-usability.cjs qa/results/usability/native '/path/Slide Studio.app/Contents/MacOS/Slide Studio'
node scripts/qa-corpus.mjs usability-workplace dickinson-workplace.pptx dickinson-brand-wide.pptx microsoft-earnings.pptx --round-trip
```

검사 결과 JSON·스크린샷·생성 PPTX/PDF는 Git에 올리지 않는 `qa/results/` 아래에 둔다. Windows/Linux 설치 앱은 이번 Mac 세션에서 실행하지 않았으며, 해당 OS의 네이티브 설치/제거와 실제 한글 입력기 조작은 검증 범위 밖이다.

## 기준 문서

- [PowerPoint 키보드 단축키](https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations)
- [찾기 및 바꾸기](https://support.microsoft.com/en-us/powerpoint/find-and-replace-text)
- [선택 창](https://support.microsoft.com/en-us/powerpoint/use-the-selection-pane-to-manage-objects-in-documents)
- [서식 복사](https://support.microsoft.com/en-us/word/use-the-format-painter)
- [PresentationML 개체 숨김 속성](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.nonvisualdrawingproperties.hidden)
