# PowerPoint 대비 Slide Studio 문제점 및 차이점 종합 분석

분석 기준 버전: **Slide Studio v1.5.9** (`HEAD: 219981f`)  
분석 범위:
1. **PPTX 입출력 및 왕복(Round-trip) 호환성** ([01-pptx-io-and-roundtrip.md](01-pptx-io-and-roundtrip.md))
2. **편집기·표·캔버스·발표 모드 UX 및 조작성** ([02-editor-and-presentation-ux.md](02-editor-and-presentation-ux.md))
3. **실제 PPTX 샘플 코퍼스(8개 문서, 499장) 레이아웃·타이포그래피·글꼴 렌더링** ([03-corpus-layout-and-typography.md](03-corpus-layout-and-typography.md))

---

## 문서 구성

| 파일 | 설명 |
| :--- | :--- |
| [01-pptx-io-and-roundtrip.md](01-pptx-io-and-roundtrip.md) | `src/io.ts`, `src/pptx-text.ts`, `src/pptx-export-layout.ts` 코드 전수 분석을 통한 PPTX 가져오기 유실, 내보내기 누락, 왕복(Round-trip) 시 발생하는 데이터 변형 버그 목록 |
| [02-editor-and-presentation-ux.md](02-editor-and-presentation-ux.md) | `src/App.tsx`, `src/SlideCanvas.tsx`, `src/TableEditor.tsx`, `src/PresentationInk.tsx` 등 편집·조작·발표 흐름을 PowerPoint 표준 동작과 비교한 UX 결함 및 기능 누락 목록 |
| [03-corpus-layout-and-typography.md](03-corpus-layout-and-typography.md) | 실제 PPTX 샘플 8종(`qa/samples/*.pptx`) XML 태그 분포 스캔, `qa/results/` 코퍼스 측정 결과(텍스트 넘침·상자 겹침·경고), 글꼴 대체 및 줄바꿈/줄간격 차이 상세 분석 |

---

## 핵심 문제점 요약 (우선순위순)

### 🔴 긴급 (코드 버그 및 데이터/조작 손상)

1. **내부 복사 후 외부 클립보드(이미지 등) 붙여넣기 영구 차단 버그** (`src/App.tsx:1030-1042, 1789-1798`)
   - 앱 안에서 도형이나 슬라이드를 한 번이라도 복사(`Ctrl+C`)하면 `clipboard.current.elements` 또는 `clipboard.current.slide`가 계속 남아 있어, 이후 외부 프로그램에서 이미지를 복사해 `Ctrl+V`를 눌러도 `keydown`에서 `e.preventDefault()`가 호출되어 브라우저 `paste` 이벤트가 차단되고 이전 내부 개체가 반복 붙여넣기됨.
2. **빈 캔버스에서 `Delete` / `Backspace` 입력 시 현재 슬라이드 즉시 삭제** (`src/App.tsx:929-943, 1801-1804`)
   - 캔버스에서 아무 개체도 선택되지 않은(`selected.length === 0`) 상태로 `Delete`나 `Backspace`를 누르면 `else removeSlide()`가 실행되어 슬라이드 전체가 삭제됨 (PowerPoint는 왼쪽 슬라이드 썸네일 패널에 포커스가 있을 때만 슬라이드를 삭제함).
3. **플레이스홀더(Placeholder) 상속 매칭 오류** (`src/io.ts:1240-1262`)
   - `placeholder(node)`가 `idx` 속성이 없는 모든 `<p:ph>`(예: `<p:ph type="title"/>`, `<p:ph type="dt"/>`)에 기본값 `index: "0"`을 부여하고, `inheritedShape()`가 `type`보다 `index === ph.index`를 먼저 비교함. 그 결과 레이아웃/마스터에서 `idx`가 없는 첫 번째 플레이스홀더가 전혀 다른 `type`의 플레이스홀더와 잘못 매칭될 수 있음.
4. **텍스트 편집 중 리본 컨트롤(글꼴, 크기, 정렬, 글머리표) 클릭 시 편집 모드 강제 종료** (`src/App.tsx:2067-2101, 2814-2855`, `src/SlideCanvas.tsx:628-637`)
   - 글꼴 선택(`<select>`), 글자 크기(`NumberInput`), 문단 정렬 버튼에 `data-text-selection-control` 또는 포커스 유지 처리가 없고, 글머리 기호 버튼은 명시적으로 `setEditing(null)`을 호출해 텍스트 드래그 선택 후 서식 변경 시 편집 모드가 풀려버림.
5. **슬라이드 번호·날짜 필드 갱신 시 문단/런 상세 서식 초기화** (`src/insert-fields.ts:59-61`, `src/io.ts:682`)
   - `resolveDeckFields()`가 슬라이드 순서 변경이나 날짜 변경으로 텍스트가 바뀔 때 `paragraphs: undefined`로 덮어써서 해당 개체의 줄간격, 여백, 동아시아 글꼴, 자간 등 문단/런 서식을 모두 유실함.
6. **다중 개체 드래그 시 안내선(스마트 가이드) 스냅이 개체들을 슬라이드 중앙 한 점으로 뭉개는 버그** (`src/SlideCanvas.tsx:1011-1016`)
   - `showGuides`가 켜진 상태에서 여러 개체를 동시에 선택해 드래그하면, 각 개체가 개별적으로 슬라이드 중앙(`deck.width / 2`, `deck.height / 2`)에 스냅되어 다중 선택된 개체들의 상대 위치가 깨지고 중앙으로 겹쳐짐.
7. **슬라이드 썸네일 아래쪽 드래그 이동 시 표시선(`drop-before`)과 실제 이동 위치 불일치** (`src/App.tsx:3300`, `src/model.ts:316-320`)
   - `dragSlide < i`인 상태에서 아래로 끌면 `i`번 슬라이드 위에 `drop-before` 표시선이 나타나지만, `reorder()`가 원본을 먼저 `splice`한 뒤 `to` 인덱스에 삽입하므로 실제로는 `i`번 슬라이드 **뒤**에 배치됨.
8. **PPTX 왕복(Round-trip) 시 `autoHeight`, `locked`, 프리셋 도형 `flipH`/`flipV`, 비대칭 테두리(`borders`), `indent >= 0` 글머리표 변형**
   - `el.autoHeight`와 `el.locked`는 PPTX 내보내기/가져오기에서 완전히 무시됨 (`src/io.ts:767`, `src/pptx-export-layout.ts:153-186`).
   - `triangle`, `roundRect` 등 일반 프리셋 도형의 상하/좌우 반전(`flipH`/`flipV`)은 내보낼 때 기록되지만 다시 가져올 때 무시됨 (`src/io.ts:1841-1847`).
   - 분해된 표 셀 등의 비대칭 `el.borders`는 내보낼 때 개별 선(`<p:cxnSp>`)으로 분리되어 재가져오기 시 셀 테두리가 아닌 독립 선 도형들로 쪼개지고 셀 여백(`textInsets`)이 사라짐 (`src/pptx-export-layout.ts:82-152`, `src/io.ts:1902`).
   - `indent >= 0`인 글머리표 문단은 내보낼 때 `paragraphBullet()` 조건(`indent < 0`)을 통과하지 못해 `<a:buNone/>` + 본문 내 리터럴 `"• "` 텍스트로 변형됨 (`src/text-layout.ts:98-109`, `src/pptx-export-layout.ts:280-317`).

---

### 🟠 높음 (PowerPoint 핵심 기능 및 편집 UX 격차)

1. **부분 텍스트의 글꼴(Font Family)·글자 크기(Font Size)·문단별 정렬·문단별 글머리표 미지원** (`src/text-formatting.ts:3-25`, `src/text-layout.ts:241-273`, `src/text-bullets.ts:33-69`)
   - 텍스트 일부만 드래그해 글꼴이나 크기를 바꿔도 상자 내 **모든 문단과 모든 런**의 글꼴/크기가 통째로 덮어써지며, 정렬과 글머리 기호 토글 역시 커서가 위치한 문단이 아닌 텍스트 상자 전체 문단에 일괄 적용됨.
2. **글머리표 편집 조작(`Enter` 빈 줄 해제, `Backspace` 기호 삭제, `Tab`/`Shift+Tab` 다단계 들여쓰기, `Shift+Enter` 줄바꿈) 미구현** (`src/text-bullets.ts:92-120`, `src/SlideCanvas.tsx:647-666`, `src/text-layout.ts:198-206`)
   - 빈 글머리표 항목에서 `Enter`를 눌러도 목록이 끝나지 않고 빈 글머리표가 무한 생성됨.
   - `Tab` 키를 누르면 들여쓰기 대신 포커스가 다음 DOM 요소로 이동해 편집 모드가 종료됨.
   - `Shift+Enter`를 눌러도 같은 문단 내 줄바꿈(`<a:br>`)이 아닌 새 문단(`paragraphBreaks = true`)으로 생성됨.
3. **도형 내부 텍스트 직접 입력 불가 및 PPTX 가져오기 시 도형+텍스트 강제 분리** (`src/io.ts:1781-1910`, `src/SlideCanvas.tsx:360-476, 1152-1156`)
   - `type: "shape"` 개체는 텍스트를 렌더링하거나 더블클릭 편집할 수 없으며, PPTX에서 텍스트가 든 도형을 가져오면 도형 개체와 텍스트 상자 개체 2개로 분리되어 이동·회전·크기 조절이 따로 놀게 됨.
4. **외부 PowerPoint 표(`<a:tbl>`)의 네이티브 표 편집 불가 (개별 텍스트 상자로 분해)** (`src/io.ts:2052-2360`)
   - Slide Studio 전용 확장 태그(`<ss:table>`)가 없거나 병합 셀(`gridSpan`/`vMerge`)이 있는 모든 일반 PowerPoint 표는 표 구조를 잃고 셀마다 독립된 텍스트 상자로 분해됨.
5. **표 캔버스 인라인 텍스트 편집 미지원 및 행 높이 고정(텍스트 잘림)** (`src/SlideCanvas.tsx:1142-1151`, `src/TableEditor.tsx:81, 117`, `src/table.ts:315-373`)
   - 캔버스 위에서 표 셀을 클릭해 바로 타이핑할 수 없고 모달 창(`TableEditor`)을 열어야 함.
   - 셀에 여러 줄을 입력해도 행 높이가 자동으로 늘어나지 않고 `overflow: hidden`으로 잘리며, 행/열 경계선 드래그 시 전체 표 크기는 고정된 채 인접 행/열 크기를 깎는 방식으로만 동작함.
6. **개체 그룹화(`Ctrl+G` / `Ctrl+Shift+G`) 및 빈 영역 드래그 다중 선택(Marquee Selection) 부재** (`src/SlideCanvas.tsx:1070-1082`, `src/insert-content.ts:278-645`)
   - 마우스 드래그 박스 선택이 불가능하고 그룹 기능이 없어, 삽입된 차트·다이어그램·분수 수식이나 가져온 그룹 도형(`<p:grpSp>`)이 수십 개의 개별 조각으로 흩어져 이동·크기 조절이 매우 불편함.
7. **다중 선택 리사이즈 왜곡, 회전 핸들 부재, 회전된 개체 리사이즈 좌표계 오류** (`src/SlideCanvas.tsx:993-1046, 1259-1268`)
   - 여러 개체를 선택해 크기를 조절하면 전체 비율 스케일링이 아니라 각 개체에 동일한 `dx`/`dy`가 더해짐.
   - 캔버스 위에 마우스로 돌릴 수 있는 회전 핸들이 없으며, 회전된 개체의 크기 조절 시 회전 각도를 고려하지 않아 마우스 방향과 다르게 크기가 변함.

---

### 🟡 중간 (렌더링·레이아웃 정밀도 및 슬라이드 관리/발표 기능 차이)

1. **`spAutoFit` / `normAutofit` 동적 맞춤 미지원으로 인한 코퍼스 텍스트 상자 넘침(`overflow_boxes` 50건)** (`src/pptx-text.ts:47-59, 330`, `qa/results/release-1.4.1-corpus/corpus.json`)
   - 가져온 가로 텍스트 상자에 `<a:spAutoFit>`이 있어도 `autoHeight: true`가 켜지지 않아 원본 상자 높이를 초과하는 사례가 5개 샘플 기준 50건 발생함(`textOverflow: "visible"`로 글자 잘림은 피하나 상자 경계와 실제 텍스트 높이가 불일치).
   - `<a:normAutofit>` 역시 저장된 `fontScale`만 고정 반영할 뿐, 대체 글꼴이나 텍스트 편집으로 줄 수가 늘어날 때 실시간으로 글자 크기를 줄여 맞추지 않음.
2. **도형·배경 시각 효과 미지원 (샘플 8종에서 대량 발견)** (`src/io.ts:1521-1735, 1797-1800`, `src/drawing-path.ts:26-75`)
   - 샘플 8개 PPTX 스캔 결과: 그림자/효과(`effectLst` 1,321회, `outerShdw` 254회), 점선/파선(`prstDash` 283회), 그라데이션 채우기(`gradFill` 25회), 연결선(`cxnSp` 117회), 비표준 프리셋 도형 및 수식 참조 커스텀 경로(`custGeom` 137회)가 실무/강의 문서에 빈번히 등장하나 단색·실선·사각형으로 단순화되거나 생략됨.
3. **슬라이드 다중 선택, 썸네일 우클릭 메뉴, 기존 슬라이드 레이아웃 변경 불가** (`src/App.tsx:356, 2228-2246, 3297-3406`)
   - 썸네일에서 `Shift`/`Ctrl+클릭` 다중 선택과 우클릭 컨텍스트 메뉴가 없으며, 슬라이드 정렬(Sorter) 화면에서는 드래그 순서 변경조차 불가능함.
   - 리본이나 서식 패널의 레이아웃 버튼은 현재 슬라이드의 레이아웃을 바꾸는 대신 무조건 새 슬라이드를 추가함.
4. **발표 모드: 발표자 보기(Presenter View) 부재, 죽은 상태(`presentNotes`), 판서 보존 여부 확인 누락** (`src/App.tsx:503, 1616-1677, 4444-4452`, `src/PresentationInk.tsx:60-61`)
   - `presentNotes` 상태와 렌더링 JSX(`.present-notes`)가 코드에 존재하지만 `setPresentNotes`를 호출하는 UI/단축키가 아예 없음.
   - 발표 종료 시 펜 판서(Ink)를 슬라이드에 남길지 묻지 않고 즉시 폐기함.
   - 발표 중 `W`(흰 화면), `N`/`P`(다음/이전), `Backspace`(이전 슬라이드 이동) 단축키가 동작하지 않음.
