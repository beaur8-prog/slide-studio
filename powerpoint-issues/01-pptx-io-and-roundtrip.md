# 01. PPTX 입출력(`importPptx` / `exportPptx`) 및 왕복(Round-trip) 문제점

분석 대상 파일:
- `src/io.ts`
- `src/pptx-text.ts`
- `src/pptx-export-layout.ts`
- `src/pptx-insert-fields.ts`
- `src/insert-fields.ts`
- `src/drawing-path.ts`
- `src/types.ts`

---

## 1. PPTX 가져오기(`importPptx`) 시 유실·변형·단순화되는 항목

### 1.1 외부 PowerPoint 표(`<a:tbl>`)가 네이티브 표로 열리지 않고 개별 텍스트 상자로 분해됨
- **위치**: `src/io.ts:2052-2152`, `src/io.ts:2153-2360`, `src/table.ts:3-5, 103-216`
- **원인 및 현상**:
  - `parseTable()`은 `<p:cNvPr><p:extLst>` 내부에 Slide Studio 전용 확장 태그(`<ss:table xmlns:ss="urn:slide-studio:table:v1">`)가 있는 경우에만 `type: "table"`로 가져옵니다.
  - 따라서 **Microsoft PowerPoint에서 작성한 모든 일반 표는 네이티브 표(`type: "table"`)로 열리지 않으며**, 셀마다 독립된 `type: "text"` 개체들로 완전히 분해됩니다(`"표를 셀별로 편집 가능한 텍스트·배경·테두리로 가져왔습니다."` 경고 발생).
  - Slide Studio에서 저장한 표라도 20행×12열을 초과하거나(`MAX_TABLE_ROWS = 20`, `MAX_TABLE_COLUMNS = 12`), 병합 셀(`gridSpan`, `rowSpan`, `hMerge`, `vMerge`)이 있거나, 셀 텍스트 내에 기울임(`italic`)/밑줄(`underline`)/위·아래첨자(`baseline`)가 있으면 네이티브 표 가져오기가 거부되고 개별 상자로 분해됩니다 (`src/io.ts:2059-2138`).
  - 분해 시 `<a:txBody>`가 없는 빈 셀은 누락되며(`src/io.ts:2196`), 표 스타일(`ppt/tableStyles.xml`)의 모서리 셀 스타일(`neCell`, `nwCell`, `seCell`, `swCell`), 대각선 테두리(`lnTlToBr`, `lnBlToTr`), `tcBdr` 내부의 `insideH`/`insideV` 테두리는 무시됩니다 (`src/io.ts:2258-2269`).
  - 행 높이 자동 보정(`src/io.ts:2291-2333`)은 자동 줄바꿈(soft wrap)을 계산하지 않고 명시적 `\n` 개수(`paragraphLines(p)`)만 세어 높이를 배분하며, `rowSpan > 1`인 병합 셀은 계산에서 제외합니다 (`src/io.ts:2295`).

### 1.2 도형 내부 텍스트가 도형과 별개의 텍스트 상자로 강제 분리됨
- **위치**: `src/io.ts:1781-1910`
- **원인 및 현상**:
  - 투명하고 테두리가 없는 사각형(`pureText`)이 아닌 모든 도형(`<p:sp>`)에 텍스트가 들어 있으면, 텍스트 없는 `type: "shape"` 개체(`src/io.ts:1835-1879`)와 그 위에 얹힌 `type: "text"` 개체(`src/io.ts:1881-1910`) **2개로 쪼개어** 가져옵니다.
  - 분리된 후에는 도형을 이동·크기 조절·회전·삭제해도 글자가 따라오지 않으며, 다시 PPTX로 내보내도 하나의 도형으로 합쳐지지 않고 2개의 별도 `<p:sp>`로 저장됩니다.
  - 도형 내 텍스트 영역(inscribed text rect) 계산은 타원(`ellipse`)과 도넛(`donut`)에만 적용되어 있으며(`src/io.ts:1890-1897`), 삼각형(`triangle`), 둥근 사각형(`roundRect`), 커스텀 도형 등은 바깥 사각형 전체 폭에 맞춰 줄바꿈됩니다.

### 1.3 플레이스홀더(Placeholder) 상속 매칭 버그 및 한계
- **위치**: `src/io.ts:1240-1262`, `src/pptx-text.ts:74-79`, `src/io.ts:1686-1691, 1736-1744, 2373`
- **원인 및 현상**:
  1. **`idx` 미지정 플레이스홀더 간 오매칭 버그 (`src/io.ts:1245-1262`)**:
     - `placeholder(node)`가 `idx` 속성이 없는 `<p:ph>`(예: `<p:ph type="title"/>`, `<p:ph type="ctrTitle"/>`, `<p:ph type="dt"/>`)에 무조건 기본값 `index: "0"`을 넣습니다 (`src/io.ts:1247`).
     - 그런데 `inheritedShape(node, doc)`(`src/io.ts:1251-1262`)는 `type` 일치 여부를 확인하기 전에 `placeholder(candidate)?.index === ph.index`를 **먼저** 검사합니다!
     - 따라서 슬라이드의 `<p:ph type="title"/>`(`idx` 없음 → `"0"`)를 찾을 때, 레이아웃이나 마스터의 첫 번째 플레이스홀더가 `<p:ph type="dt"/>`(`idx` 없음 → `"0"`)이면 제목 플레이스홀더가 날짜 플레이스홀더의 좌표와 서식을 잘못 상속받게 됩니다.
  2. **레이아웃/마스터 `txBody` 문단 스타일 상속 시 레벨 무시 (`src/pptx-text.ts:74-79`)**:
     - `bodies.slice(1)`(레이아웃·마스터의 `txBody`)에서 문단 속성(`pPr`)을 가져올 때 현재 문단의 `level`과 무관하게 무조건 첫 번째 문단(`children(b, "p")[0]`)의 `pPr`을 참조합니다 (`src/pptx-text.ts:77`).
  3. **`dt`, `ftr`, `sldNum`의 마스터 텍스트 스타일 매칭 오류 (`src/io.ts:1686-1691`)**:
     - 제목 계열이 아닌 모든 플레이스홀더를 `txStyles/bodyStyle`로 매핑하여, 원래 `txStyles/otherStyle`을 따라야 하는 날짜(`dt`), 바닥글(`ftr`), 슬라이드 번호(`sldNum`)가 본문 글꼴/크기 스타일을 상속받습니다.
  4. **플레이스홀더 도형 기하(`prstGeom`/`custGeom`) 미상속 (`src/io.ts:1721, 1736-1744`)**:
     - 슬라이드의 플레이스홀더가 `<a:prstGeom>`을 생략하고 레이아웃/마스터의 도형 모양(예: `roundRect`)을 상속받는 경우, `parseShape`는 `chain`이 아닌 현재 `node`의 `spPr`만 확인하여 무조건 `"rect"`로 만듭니다.
  5. **마스터/레이아웃 장식 개체의 슬라이드 복제 (`src/io.ts:2373, 2579-2583`)**:
     - 마스터와 레이아웃의 배경 장식 개체들이 각 슬라이드의 일반 편집 개체(`slide.elements`)로 복제되어 들어오며, 내보낼 때도 마스터가 아닌 모든 슬라이드에 중복 저장됩니다. 또한 `placeholder(node)`(`src/io.ts:1243`)가 `nvGrpSpPr`와 `nvGraphicFramePr`를 확인하지 않아 레이아웃의 그룹/표/차트 플레이스홀더가 장식 개체로 오인될 수 있습니다.

### 1.4 그룹 도형(`<p:grpSp>`) 강제 해제 및 그룹 내 텍스트 스케일 누락
- **위치**: `src/io.ts:1205-1239, 1709-1710, 2379-2445`
- **원인 및 현상**:
  - 데이터 모델(`SlideElement`)에 그룹 구조가 없어 모든 `<p:grpSp>`가 개별 개체로 영구 해제됩니다 (`src/io.ts:2399`).
  - **그룹 내부 텍스트 스케일링 누락 버그**: `makeText()`(`src/io.ts:1709-1710`)가 `sx: 1, sy: 1`을 하드코딩하여 `readTextBody`에 전달하므로, 그룹의 `ext`와 `chExt` 비율(`parent.sx`, `parent.sy`)이 달라도 그룹 안 텍스트의 글자 크기(`fontSize`), 자간(`letterSpacing`), 줄간격(`lineSpacing`), 들여쓰기(`marginLeft`, `indent`), 여백(`insets`)이 스케일링되지 않습니다.
  - **그룹 반전(`flipH`/`flipV`) 유실**: `transformGroupedElement`(`src/io.ts:1232-1237`)는 이미지와 커스텀 경로(`element.paths`)에만 그룹 반전을 전달하고, 일반 프리셋 도형(`triangle` 등)과 텍스트 상자의 반전은 버립니다.

### 1.5 슬라이드 배경, 그라데이션, 패턴, 색상 변환 한계
- **위치**: `src/io.ts:1089-1173, 1521-1537, 1578-1613`
- **원인 및 현상**:
  - **슬라이드 배경**: 단색(`<a:solidFill>`)만 지원하며, 그라데이션(`gradFill`), 배경 이미지(`blipFill`), 패턴(`pattFill`) 배경은 모두 흰색(`#FFFFFF`)으로 대체됩니다 (`src/io.ts:1526-1537`). 단색 배경의 투명도(`opacity`)도 무시됩니다.
  - **도형 채우기**: 그라데이션(`<a:gradFill>`)은 첫 번째 중지점(`<a:gs>`)의 단일 색상으로 뭉개지며(`src/io.ts:1591-1598`), 도형 내부 이미지 채우기(`blipFill`), 패턴 채우기(`pattFill`), 그룹 채우기 상속(`grpFill`)은 무시됩니다.
  - **색상 공간 및 프리셋 색상**:
    - `<a:hslClr>` 미지원 (`src/io.ts:1110-1122`).
    - 약 140개의 OOXML 표준 `prstClr` 중 13개만 매핑되어 있음 (`src/io.ts:1089-1103`).
    - OOXML 표준에서 `lumMod`/`lumOff`는 HSL 색공간의 밝기(Luminance)를 조절해야 하나, `src/io.ts:1152-1155`는 RGB 채널 값에 직접 선형 연산(`c * amount + 255 * amount`)을 수행해 테마 밝기 변형 색상이 원본 PowerPoint와 다르게 계산됩니다.

### 1.6 글머리표·자동 번호·문단·런 서식 유실
- **위치**: `src/pptx-text.ts:67-266`
- **원인 및 현상**:
  - **다단계 목록 레벨(`lvl`) 유실**: 가져오기 시 들여쓰기 계산에만 쓰이고 `TextParagraph`에는 `level` 속성이 저장되지 않습니다 (`src/types.ts:23-41`).
  - **자동 번호(`buAutoNum`) 서식 무시**: `alphaLcPeriod`(`a.`), `romanUcPeriod`(`I.`), `arabicParenR`(`1)`), 원문자 등 모든 자동 번호 형식을 무시하고 무조건 아라비아 숫자 `${value}.`(`1.`, `2.`)로 변환합니다 (`src/pptx-text.ts:154-166`).
  - **그림 글머리표(`<a:buBlip>`) 무시**: `src/pptx-text.ts:146`에서 처리하지 않고 누락됩니다.
  - **양쪽 맞춤(`just`) 및 배분 맞춤(`dist`) 미지원**: `algn="just"`, `algn="justLow"`, `algn="dist"`가 모두 왼쪽 정렬(`"left"`)로 변환됩니다 (`src/pptx-text.ts:228-232`).
  - **런 서식 유실**: 취소선(`strike`), 대소문자 변환(`cap="all"`/`"small"`), 형광펜 강조(`<a:highlight>`), 이중/점선/물결 밑줄 구분, 글자 윤곽선(`<a:ln>`), 글자 그림자 효과가 모두 유실됩니다 (`src/pptx-text.ts:84-139`).

### 1.7 부분 텍스트 하이퍼링크 및 슬라이드 액션 링크 유실
- **위치**: `src/io.ts:2506-2575`, `src/insert-fields.ts:28-39`
- **원인 및 현상**:
  - `TextRun`에는 `hyperlink` 필드가 없고 `SlideElement.hyperlink`만 존재합니다 (`src/types.ts:9-22, 99`).
  - 문장 내 일부 단어에만 하이퍼링크(`<a:rPr><a:hlinkClick>`)가 걸려 있거나 한 텍스트 상자 안에 서로 다른 링크가 2개 이상 있으면 **모든 런 하이퍼링크가 삭제**되고 경고만 표시됩니다 (`src/io.ts:2555-2569`).
  - `mailto:`, `tel:`, 상대 경로 파일 링크, 슬라이드 쇼 액션 링크(`ppaction://hlinkshowjump?jump=nextslide` 등)는 모두 거부·삭제됩니다 (`src/io.ts:2520-2533`).

### 1.8 프리셋 도형, 곡선/꺾은 연결선, 점선, 커스텀 도형 수식(`gdLst`) 미지원
- **위치**: `src/io.ts:40-48, 1614-1674, 1736-1834`, `src/drawing-path.ts:1-100`
- **원인 및 현상**:
  - **프리셋 도형**:约 180종의 OOXML 프리셋 도형 중 9종(`rect`, `roundRect`, `ellipse`, `triangle`, `line`, `arrow`, `straightConnector1`, `rightArrow`, `donut`)만 지원하며, 나머지(마름모, 오각형, 육각형, 별, 말풍선, 순서도, 중괄호, 하트, 구름 등)와 **꺾은 연결선(`bentConnector*`)·곡선 연결선(`curvedConnector*`)**은 모두 사각형(`"rect"`)으로 바뀝니다 (`src/io.ts:1797-1799`).
  - **점선/파선 및 복합선**: `<a:prstDash>`(점선, 파선 등), `<a:custDash>`, 이중선(`cmpd="dbl"`)이 모두 일반 실선으로 변환됩니다 (`src/io.ts:1655-1659`).
  - **커스텀 기하(`<a:custGeom>`) 가이드 변수 참조 시 사각형으로 붕괴 (`src/drawing-path.ts:26-75`)**:
    - `point()`와 `arcTo`가 좌표(`x`, `y`)나 호 반지름(`wR`, `hR`, `stAng`, `swAng`)에 `Number(...)`를 직접 호출합니다.
    - PowerPoint의 `<a:custGeom>`이 `<a:gdLst>`의 가이드 변수 이름(예: `x="gd1"`, `wR="wd2"`)을 참조하면 `Number("gd1")`이 `NaN`이 되어 예외가 발생하고(`src/drawing-path.ts:96-98`), 도형 전체가 사각형(`"rect"`)으로 대체됩니다 (`src/io.ts:1800, 1826-1834`).

### 1.9 그림자·3D 효과·차트·미디어·애니메이션·전환·발표자 노트 서식 유실
- **위치**: `src/io.ts:1542-1550, 1730-1735, 1985-2009, 2446-2505, 2585-2595`, `src/pptx-insert-fields.ts:64-87`
- **원인 및 현상**:
  - 그림자(`outerShdw`, `innerShdw`), 네온(`glow`), 반사(`reflection`), 부드러운 가장자리(`softEdge`), 3D 회전/입체 효과(`scene3d`, `sp3d`) 전량 삭제 (`src/io.ts:1730-1735`).
  - 네이티브 차트(`<c:chart>`) 가져오기 미지원 (`src/io.ts:2448-2449`), SmartArt는 캐시된 `drawing*.xml`이 있을 때만 개별 도형으로 분해 (`src/io.ts:2450-2485`).
  - 오디오/비디오 재생 미지원, SVG/EMF/WMF 벡터 이미지 미지원 (`src/io.ts:1985-2009`).
  - 슬라이드 전환은 `fade` 외의 모든 전환 효과(`push`, `wipe`, `morph`, `cut` 등)와 전환 속도(`spd`), 자동 넘김 시간(`advTm`)이 유실되며, 개체 애니메이션(`<p:timing>`)은 전량 삭제됩니다 (`src/io.ts:1542-1550`).
  - 발표자 노트(`notes`)의 굵게/색상/크기 등 텍스트 서식이 모두 평문으로 제거되며, 노트 내 번호 매기기(`buAutoNum`)는 번호 대신 `"• "` 기호로 바뀝니다 (`src/io.ts:1263-1282, 2585-2595`).
  - PowerPoint 표준 날짜 필드(`<a:fld type="datetime*">`)나 접두/접미 텍스트가 붙은 슬라이드 번호(예: `"Page 1"`)는 동적 필드로 인식되지 않고 일반 정적 텍스트로 가져옵니다 (`src/pptx-insert-fields.ts:69-85`).

---

## 2. PPTX 내보내기(`exportPptx`) 및 왕복(`import → export → import`) 버그

### 2.1 `resolveDeckFields`가 슬라이드 번호·날짜 개체의 모든 문단/런 서식을 삭제함
- **위치**: `src/insert-fields.ts:48-66`, `src/io.ts:609, 682`, `src/pptx-export-layout.ts:187`
- **버그 내용**:
  - `exportPptx`와 `serializeDeck` 시작 시 호출되는 `resolveDeckFields()`에서, 슬라이드 순서가 바뀌거나 날짜가 바뀌어 `el.text !== text`가 되는 순간 `{ ...el, text, paragraphs: undefined }`를 반환합니다 (`src/insert-fields.ts:59-61`).
  - `paragraphs`가 `undefined`가 되면서 해당 개체가 가지고 있던 줄간격, 문단 여백, 동아시아 글꼴, 자간, 커닝 등 상세 서식이 완전히 날아가며, `restoreLayoutXml`(`src/pptx-export-layout.ts:187`)에서도 커스텀 문단 XML 복원을 건너뛰게 됩니다.

### 2.2 텍스트 상자 여백(`tIns`/`rIns`/`bIns`/`lIns`) 흡수로 인한 왕복 좌표·크기 변형 및 비대칭 테두리 분리 버그
- **위치**: `src/pptx-text.ts:273-310`, `src/io.ts:756-763, 1902`, `src/pptx-export-layout.ts:82-152, 167-170`
- **버그 내용**:
  1. **일반 텍스트 상자 여백 소실**:
     - 배경/테두리가 없는 일반 텍스트 상자를 가져올 때(`preserveBox === false`), `readTextBody`는 원본 여백(기본 좌우 `9.6px`, 상하 `4.8px`)을 `x, y, width, height`에 직접 가감한 뒤 `el.textInsets`를 `undefined`로 둡니다 (`src/pptx-text.ts:303-310`).
     - 이를 다시 내보낼 때는 `margin: 0`(`lIns="0" tIns="0" rIns="0" bIns="0"`)과 축소된 상자 크기로 저장되어 원본 PowerPoint의 텍스트 상자 경계와 여백 속성이 영구적으로 달라집니다.
  2. **비대칭 테두리(`el.borders`) 왕복 시 독립 선 도형으로 쪼개지는 버그**:
     - 외부 표에서 분해된 셀 등은 4면 테두리가 서로 다른 `el.borders`와 `el.textInsets`를 가집니다.
     - 내보낼 때(`src/pptx-export-layout.ts:82-152`) 비대칭 테두리는 본체 텍스트 상자(`strokeWidth: 0`)와 별도의 `<p:cxnSp>` 선 개체들(`${el.id}-edge-0..3`)로 분리되어 출력됩니다.
     - 이 파일을 다시 가져오면(`importPptx`), 배경이 투명하고 외곽선 폭이 `0`인 셀은 `preserveBox`가 `false`가 되어(`src/io.ts:1902`) **셀 여백(`textInsets`)을 잃고 크기가 줄어들며**, 테두리들은 셀 속성이 아닌 **별개의 독립 선 도형(`shape: "line"`)들로 영구 분리**됩니다.

### 2.3 `autoHeight` 및 `locked` 속성이 PPTX 내보내기에서 완전히 누락됨
- **위치**: `src/types.ts:107, 122`, `src/io.ts:743-773`, `src/pptx-export-layout.ts:153-186`
- **버그 내용**:
  - `SlideElement.autoHeight: true`가 설정되어 있어도 `exportPptx`는 무조건 `fit: "none"`(`<a:noAutofit/>`)으로 내보내고 `restoreLayoutXml`도 `<a:spAutoFit/>`을 기록하지 않습니다 (`src/io.ts:767`).
  - `SlideElement.locked: true` 역시 내보낼 때 `<a:spLocks>`로 기록되지 않고 가져올 때도 읽지 않아 PPTX 왕복 시 잠금 상태가 증발합니다.

### 2.4 글머리표(`indent >= 0`) 및 두 자리 이상 자동 번호(`10.`) 내보내기 오류
- **위치**: `src/text-layout.ts:98-109`, `src/pptx-text.ts:148-214`, `src/pptx-export-layout.ts:280-317`
- **버그 내용**:
  1. **`indent >= 0` 글머리표의 평문 변형**:
     - 가져올 때는 `indent`가 `0`이거나 양수여도 `<a:buChar>`가 있으면 `paragraph.bulletPrefix = "• "`와 `runs[0]` 접두사를 추가합니다 (`src/pptx-text.ts:167-213`).
     - 그러나 내보낼 때 호출하는 `paragraphBullet(paragraph)`(`src/text-layout.ts:103`)는 `(paragraph.indent ?? 0) < 0`을 필수 조건으로 검사합니다!
     - 결과적으로 `indent >= 0`인 글머리표 문단은 내보낼 때 글머리표가 아닌 것으로 판정되어 `<a:buNone/>`이 기록되고 본문 텍스트 안에 리터럴 `"• "` 문자가 박혀버립니다 (`src/pptx-export-layout.ts:317`).
  2. **자동 번호(`1.`, `10.`)를 단일 문자 속성인 `<a:buChar char="10."/>`로 출력**:
     - `restoreLayoutXml`(`src/pptx-export-layout.ts:307`)은 번호 매기기 레이블(`1.`, `10.`)을 `<a:buAutoNum>`이 아닌 `<a:buChar char="10."/>`로 기록합니다.
     - OOXML 스펙상 `buChar`의 `char` 속성은 단일 문자만 표현하므로, PowerPoint에서 열면 마침표나 뒷자리가 잘려 `"1"`로만 표시되고 문단 추가 시 번호 자동 갱신도 작동하지 않습니다.

### 2.5 프리셋 도형의 상하/좌우 반전(`flipH`/`flipV`) 왕복 유실
- **위치**: `src/io.ts:854-855, 1801-1808, 1841-1847`
- **버그 내용**:
  - `exportPptx`는 모든 도형에 `flipH: el.flipH, flipV: el.flipV`를 내보냅니다 (`src/io.ts:854-855`).
  - 그러나 `importPptx`의 `parseShape`(`src/io.ts:1841-1847`)는 `paths`가 있는 커스텀 도형(`shape === "custom"`)이거나 직선(`line`/`arrow`)일 때만 `flipH`/`flipV`를 읽고, `triangle`(뒤집힌 삼각형 등), `roundRect` 등 일반 프리셋 도형의 `flipH`/`flipV`는 무시합니다.

### 2.6 직선/화살표(`line`/`arrow`) 왕복 시 높이(`height`) 및 `y` 좌표 드리프트
- **위치**: `src/io.ts:840-866, 1852-1874`
- **버그 내용**:
  - 가져올 때 대각선 직선은 `height: 1`, `y: midY - 0.5`로 정규화됩니다 (`src/io.ts:1866-1871`).
  - 내보낼 때(`src/io.ts:843-848`)는 모든 직선을 `h: 0`, `y: (el.y + el.height / 2) / 96`으로 출력합니다.
  - 이를 다시 가져오면 `geometry.height`가 `0`이므로 `src/io.ts:1853`의 `if ((shape === "line" || shape === "arrow") && (geometry.height > 0 || xfrm?.getAttribute("flipH") === "1"))` 조건이 **거짓(`false`)**이 되어, `height`가 `1`이 아닌 `0`이 되고 `y` 좌표가 `+0.5px` 이동합니다.

### 2.7 채우기·선·텍스트 투명도(`opacity`) 단일 값 결합 및 회전된 타원 호 내보내기 크래시
- **위치**: `src/types.ts:106`, `src/io.ts:716-729, 1875, 1904-1909`, `src/pptx-export-layout.ts:214-215, 411-412`
- **버그 내용**:
  - `SlideElement`에 단일 `opacity`만 존재하여, 반투명 채우기(`alpha=50%`)와 불투명 테두리(`alpha=100%`)를 가진 도형을 가져온 뒤 내보내면 테두리까지 50% 반투명해집니다 (`src/io.ts:716-729, 1875`). 텍스트 상자 역시 첫 번째 런의 글자 투명도가 상자 전체 채우기/테두리 투명도와 결합됩니다.
  - `restoreLayoutXml`(`src/pptx-export-layout.ts:411-412`)에서 커스텀 경로(`paths[].d`)의 SVG 호(`A`) 명령에 `rotation !== 0`이 들어 있으면 `throw Error("Unsupported ellipse rotation")`가 발생해 PPTX 내보내기 전체가 실패합니다.
