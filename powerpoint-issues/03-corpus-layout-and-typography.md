# 03. 실제 PPTX 샘플 코퍼스 레이아웃·타이포그래피·글꼴 비교 분석

분석 대상:
- 실제 PPTX 샘플 8종 (`qa/samples/*.pptx`, 총 499장)
  - `cmu-lecture-1.pptx` (70장), `cmu-lecture-2.pptx` (116장), `cmu-lecture-3.pptx` (151장), `cmu-lecture-4.pptx` (106장)
  - `dsu-korean.pptx` (22장)
  - `dickinson-brand-wide.pptx` (2장), `dickinson-workplace.pptx` (9장), `microsoft-earnings.pptx` (23장)
- 코퍼스 자동 계측 결과 (`qa/results/release-1.4.1-corpus/corpus.json`, `qa/results/fonts-after/font-metrics.json`, `POWERPOINT-ANALYSIS.md`, `FONT_NOTES.md`)
- 관련 코드 (`src/text-layout.ts`, `src/SlideCanvas.tsx`, `src/pptx-text.ts`, `src/carlito-fallbacks.css`, `src/fonts.css`, `src/local-fonts.ts`, `src/desktop-fonts.ts`, `electron/office-fonts.cjs`)

---

## 1. 샘플 PPTX 8종의 실제 XML 태그 사용 빈도 vs 지원 현황

`qa/samples/` 내 8개 파일의 슬라이드 XML(`ppt/slides/slide*.xml`)을 직접 스캔한 주요 태그 빈도와 현재 처리 상태입니다.

| XML 태그 / 기능 | `cmu-1` (70장) | `cmu-2` (116장) | `cmu-3` (151장) | `cmu-4` (106장) | `dsu-korean` (22장) | `dickinson-workplace` (9장) | 처리 상태 및 문제점 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`<a:spAutoFit>`** (텍스트에 맞춰 도형 크기 조절) | 75 | 398 | 477 | 306 | 97 | 0 | **미반영**: 가로 텍스트 가져오기 시 `autoHeight: true`를 켜지 않아 상자 밖으로 넘침(`overflow_boxes` 50건의 주원인) |
| **`<a:normAutofit>`** (넘칠 때 텍스트 축소) | 23 | 1 | 4 | 33 | 20 | 7 | **정적 반영**: 저장된 `fontScale`만 곱하고 실시간 줄바꿈 변화에 따른 동적 축소 미지원, 내보내기 시 `<a:noAutofit/>`으로 유실 |
| **`<a:effectLst>` / `<a:outerShdw>`** (그림자·발광 등) | 76 / 55 | 372 / 39 | 703 / 75 | 103 / 85 | 66 / 0 | 1 / 0 | **전량 무시**: 모든 도형·텍스트 그림자 및 외곽 효과가 제거됨 |
| **`<p:grpSp>`** (그룹 도형) | 11 | 174 | 83 | 7 | 7 | 0 | **강제 그룹 해제**: 모든 그룹 계층이 단일 평면으로 풀리며 그룹 내 텍스트 스케일(`sx`/`sy`) 미적용 |
| **`<a:tbl>`** (표) | 0 | 129 | 0 | 3 | 8 | 1 | **개별 텍스트 상자로 분해**: 네이티브 표 구조를 잃고 셀마다 독립 텍스트 개체로 쪼개짐 |
| **`<p:cxnSp>`** (연결선) | 9 | 44 | 22 | 0 | 42 | 0 | **직선만 지원**: 꺾은 연결선(`bentConnector*`)과 곡선 연결선(`curvedConnector*`)은 사각형(`rect`)으로 변형됨 |
| **`<a:prstDash>`** (점선·파선) | 3 | 0 | 0 | 19 | 261 | 0 | **실선으로 변환**: `dsu-korean`에서 261회 사용된 점선/파선이 모두 실선으로 표시됨 |
| **`<a:custGeom>`** (사용자 지정 경로) | 11 | 0 | 0 | 18 | 108 | 0 | **수식 참조 시 사각형 변환**: 숫자 좌표만 지원하며 `<a:gdLst>` 수식 변수를 참조하면 `NaN`이 되어 사각형으로 대체됨 |
| **`<a:gradFill>`** (그라데이션 채우기) | 0 | 0 | 0 | 25 | 0 | 0 | **단색으로 축소**: 첫 번째 그라데이션 중지점 색상 하나로 통일됨 |
| **`<c:chart>`** (네이티브 차트) | 0 | 0 | 0 | 2 | 0 | 1 | **누락**: 차트 개체 전체가 가져오기에서 제외됨 |
| **`<p:transition>` / `<p:timing>`** (전환·애니메이션) | 71 / 16 | 191 / 0 | 183 / 2 | 111 / 2 | 4 / 1 | 0 / 3 | **단순화/누락**: `fade` 외 전환은 모두 `fade`로 바뀌고 `<p:timing>` 애니메이션은 전량 삭제됨 |

---

## 2. 코퍼스 자동 계측에서 확인된 텍스트 상자 넘침(`overflow_boxes`) 상세

`qa/results/release-1.4.1-corpus/corpus.json` 기준, `vertOverflow`가 `"clip"`이 아닐 때 `textOverflow: "visible"`을 적용하여 글자가 실제로 잘리는 현상(`clipped`)은 **0건**, 글자 간 겹침(`glyph_overlap_candidates`)은 **0건**, 슬라이드 밖 이탈(`off_slide_text_candidates`)은 **0건**입니다.

그러나 원본 텍스트 상자의 `clientHeight` / `clientWidth`보다 실제 렌더링된 텍스트의 `scrollHeight` / `scrollWidth`가 `2px` 이상 큰 **`overflow_boxes`가 총 50건** 존재하며, 이로 인해 텍스트를 클릭했을 때 **선택 테두리(Bounding Box)가 실제 글자 영역보다 작게 잡히거나 다른 개체와 경계 상자가 겹치는(`text_box_overlap_candidates` 103쌍) 문제**가 발생합니다.

### 2.1 샘플별 주요 `overflow_boxes` 발생 지점
1. **`cmu-lecture-1.pptx` (20건, `corpus.json:34-1011`)**
   - **Slide 70 (`el 0`)**: 원본 상자 높이 `138px`, 실제 텍스트 높이 `521px` (**`overflow_y: 383px`**) — `<a:spAutoFit>`이 지정된 다문단 목록(`"Please take the course survey..."`)이나 가져오기 시 `autoHeight`가 켜지지 않아 상자 높이가 138px로 고정됨.
   - **Slide 59 (`el 1`)**: `1146×650`, **`overflow_y: 89px`** (`"Waitlist Policy..."`).
   - **Slide 52 (`el 0`)**: `614×162`, **`overflow_y: 64px`** (`"Learn linear algebra..."`).
   - **Slide 4 (`el 7`)**: `867×126`, **`overflow_y: 48px`** (`"Take-home quizzes (10%)..."`).
   - **Slide 69 (`el 0`)**: **`overflow_y: 46px`**, **Slide 11 (`el 0`)**: **`overflow_y: 37px`**, **Slide 47 (`el 0`)**: **`overflow_y: 23px`**, **Slide 68 (`el 0`)**: **`overflow_y: 21px`**.
   - **Slide 54 (`el 1`, `el 6`) & Slide 62 (`el 2`)**: 긴 URL 문자열(`"https://piazza.com/cmu/spring2020/16385"` 등)이 고정 폭 상자에서 가로로 넘침(**`overflow_x: 3~7px`**).
2. **`cmu-lecture-2.pptx` (6건, `corpus.json:1027-2720`)**
   - **Slide 103 (`el 2, 3, 4`), Slide 105 (`el 4`), Slide 106 (`el 6`)**: `"gradient amplitude"`, `"vertical derivative"`, `"horizontal derivative"` 캡션 상자(`height: 47px`)에서 **`overflow_y: 11px`** 발생.
3. **`cmu-lecture-3.pptx` (6건, `corpus.json:2740-4554`)**
   - **Slide 146 (`el 0`)**: `503×233`, **`overflow_y: 18px`** (`"Gala Contemplating the Mediterranean Sea..."`).
   - **Slide 4 (`el 1`)**: `1245×624`, **`overflow_y: 8px`**.
4. **`cmu-lecture-4.pptx` (5건, `corpus.json:4575-5674`)**
   - **Slide 3 (`el 0`)**: `1231×624`, **`overflow_y: 42px`** (`"Readings • Szeliski Section 4.2..."`).
   - **Slide 1 (`el 1`)**: `1345×133`, **`overflow_y: 12px`**.
5. **`dsu-korean.pptx` (13건, `corpus.json:5692-6052`)**
   - **Slide 8 (`el 8, 9, 10, 11`)**: 세로쓰기(`vert="eaVert"` → `writingMode: "stacked"`) 상자 4개(`"서비스 제공 기능"`, `"지역조직화 교육"`, `"급식 서비스사업"`)에서 세로 높이가 상자보다 **`9px ~ 28px` 넘침**.
   - **Slide 5 (`el 3`)**: 연혁 목록(`756×465`)에서 **`overflow_y: 20px`**.
   - **Slide 2 (`el 1, 3, 4, 5`)**: 번호 배지(`30×56`)에서 **`overflow_y: 8px`**.

---

## 3. 타이포그래피·글꼴 대체·문단 레이아웃 정밀도 문제

### 3.1 글꼴 대체(Font Substitution)로 인한 자폭·굵기·줄바꿈 차이
- **`Calibri Light` → `Carlito` (Weight 300 부재 문제) (`src/carlito-fallbacks.css:367-547`, `FONT_NOTES.md:22-45`)**:
  - 오픈소스 대체 글꼴인 `@fontsource/carlito`에는 `400`(Regular)과 `700`(Bold)만 있고 `300`(Light) 웨이트 파일이 없습니다.
  - 현재 `Slide Studio Calibri Light`는 Carlito 400에 `size-adjust: 98.8%`를 씌워 자폭만 맞춘 상태이므로, Office가 설치되지 않은 환경에서는 **제목과 본문의 `Calibri Light`가 PowerPoint보다 획이 굵은 Regular(400) 굵기로 렌더링**됩니다.
- **macOS/Linux에서 `맑은 고딕(Malgun Gothic)` 및 상용 한글 글꼴 대체 (`src/text-layout.ts:4-23`, `FONT_NOTES.md:54-103`)**:
  - Office가 없는 macOS에서는 `맑은 고딕`이 `Apple SD Gothic Neo`로 대체됩니다. 동일 26.67px 기준 `"지역사회복지관 실습 오리엔테이션 2024"` 측정 시 `Apple SD Gothic Neo`(400)는 `313.88px`, 내장 `NanumBarunGothic`은 `338.59px`로 자폭 차이가 존재하여 긴 문단에서 한 글자 차이로 줄바꿈 위치가 달라질 수 있습니다 (`qa/results/fonts-after/font-metrics.json:264-328`).
  - `dsu-korean.pptx`에 사용된 상용 글꼴(`HY나무M`, `HY바다M`, 산돌 계열 등)은 사용자가 직접 TTF/OTF를 등록하지 않으면 시스템 기본 고딕으로 대체됩니다.
- **내장 `NanumBarunGothic` 기울임꼴(Italic) 파일 부재 (`src/fonts.css:1-28`, `src/SlideCanvas.tsx:490`)**:
  - `Normal` 스타일만 내장되어 있어 기울임 적용 시 브라우저 합성 기울임(`fontSynthesis: "style"`)에 의존합니다.
- **로컬 글꼴 추가 기능의 `.ttc` / `.otc` 컬렉션 미지원 및 문서 미포함 (`src/local-fonts.ts:18-22, 172-184`)**:
  - `파일 → 원본 글꼴 추가`는 `.ttf`와 `.otf`만 허용하며 macOS/Windows 시스템 글꼴에 흔한 `.ttc`/`.otc`(TrueType Collection) 파일을 등록할 수 없습니다. 또한 추가한 글꼴은 기기의 IndexedDB에만 저장될 뿐 `.slide`나 `.pptx` 파일에 임베딩되지 않습니다.

### 3.2 고정 `1.2` 줄간격 계수와 문단 간격(`spcPct`) 계산 오차
- **모든 글꼴에 고정된 `1.2` 기본 줄간격 적용 (`src/pptx-text.ts:241-246`, `src/SlideCanvas.tsx:234`)**:
  - PowerPoint는 `<a:lnSpc>`가 생략되었을 때 각 글꼴 파일 내부의 `hhea`/`OS/2` 테이블 메트릭(Ascender + Descender + LineGap)을 기준으로 줄간격을 계산합니다.
  - 반면 Slide Studio는 모든 글꼴에 일괄적으로 `1.2` 배수(`(1 - lineReduction) * 1.2`)를 적용합니다. `맑은 고딕`과 보정된 `Carlito`에서는 PowerPoint와 거의 일치하지만, 고유 행간(LineGap)이 큰 영문/장식 글꼴에서는 PowerPoint보다 줄 사이가 좁아집니다.
- **혼합 글자 크기 문단의 퍼센트 문단 간격(`spcBef`/`spcAft` `spcPct`) 오차 (`src/pptx-text.ts:214-224`)**:
  - `parseSpace()`가 문단 앞/뒤 퍼센트 간격을 계산할 때 문단 내 최대 글자 크기가 아니라 무조건 **첫 번째 런의 글자 크기(`runs[0]?.fontSize ?? 32`)**를 기준으로 삼습니다 (`src/pptx-text.ts:214`). 첫 번째 런이 작은 글자(예: 첨자나 작은 기호)이고 뒤에 큰 글자가 오는 문단에서는 문단 간격이 PowerPoint보다 작게 계산됩니다.
- **위첨자/아래첨자(`baseline`) 고정 축소 비율 (`src/SlideCanvas.tsx:151-153, 171`)**:
  - 첨자 렌더링 시 글자 크기를 무조건 `0.65`배로 축소하고 CSS `verticalAlign: "${r.baseline / 1000}%"`를 적용하여 줄 박스(line box) 높이에 미세한 변동을 줄 수 있습니다.

### 3.3 문장부호 내어쓰기(`hangingPunct`)가 문단의 마지막 줄에만 작동함
- **위치**: `src/SlideCanvas.tsx:34-91, 108-113`
- **원인 및 현상**:
  - PowerPoint의 `hangingPunct="1"`은 여러 줄로 자동 줄바꿈되는 문단에서 **어느 줄이든** 줄 끝에 걸리는 마침표(`.`)나 쉼표(`,`)를 텍스트 상자 오른쪽 여백 바깥으로 내어써서 불필요한 줄바꿈을 방지합니다.
  - 그러나 `SlideCanvas.tsx`의 `TextLine` 컴포넌트(`splitTrailingHangingChar`, `L34-48`)는 **문단(또는 강제 줄바꿈 블록)의 가장 마지막 글자 단 하나**만 검사하여 `width: 0px`로 만듭니다.
  - 따라서 3~4줄짜리 긴 문단의 **첫째 줄이나 둘째 줄 끝**에서 마침표/쉼표 때문에 줄바꿈이 밀리는 경우에는 `hangingPunct` 보정이 전혀 작동하지 않습니다.

### 3.4 다단 텍스트 상자(`textColumns`)의 그룹 스케일 누락 및 비사각형 도형 텍스트 줄바꿈
- **그룹 내 다단 간격(`spcCol`) 스케일 미적용 버그 (`src/pptx-text.ts:322`)**:
  - `readTextBody`에서 좌우 여백(`lIns`/`rIns`)과 들여쓰기(`marginLeft`/`indent`)는 그룹 스케일 `Math.abs(ctx.sx)`를 곱하지만, 다단 간격 `spcCol`은 `num(bodyProps, "spcCol", 0) / 9525`로만 계산하여 `Math.abs(ctx.sx)`가 누락되어 있습니다.
- **세로쓰기(`writingMode !== "horizontal"`) 및 다단(`textColumns > 1`)에서 자동 높이 조절 미지원 (`src/SlideCanvas.tsx:302-308`)**:
  - `automaticTextHeight()`가 가로쓰기·1단 상자에서만 동작하도록 제한되어 있습니다.
- **비사각형 도형의 텍스트 영역 (`src/io.ts:1890-1898`)**:
  - 타원(`ellipse`)과 도넛(`donut`)만 내접 사각형(`width * Math.SQRT1_2`)으로 텍스트 폭을 줄이고, 삼각형·마름모·육각형·화살표 등 다른 도형은 도형 내부의 실제 `<a:rect>` 텍스트 영역 대신 바깥 사각형 전체 폭을 사용하여 글자가 도형 빗변 밖으로 삐져나올 수 있습니다.
