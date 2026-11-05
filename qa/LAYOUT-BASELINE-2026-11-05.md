# PowerPoint 레이아웃 비교 기준 — 2026-11-05

이 문서는 레이아웃 개선 계획 A 단계의 입력 자료와 수정 전 화면을 고정한다.
Microsoft 기준 화면은 **2026-10-31 웹 PowerPoint 캡처**이며, 2026-11-05에
새로 PowerPoint에서 열어 검사했다는 뜻이 아니다. 현재 앱 기준은
`fd5a04cd77b49e70de5d1734f814e97a41b0e856` 소스를 `git archive`로 분리한
Vite/Chrome 렌더링이다. 실제 설치 앱·운영체제 파일 선택창·저장 왕복은 별도 검사다.

## 살아 있는 근거와 자료

- `qa/layout-baseline-2026-11-05.json`에 공개 PPTX **17개·62장**과 대표 12장을
  고정한다. 이미지로만 구성된 별도 31장은 편집 레이아웃 표본에서 제외한다.
- 원본 PPTX 17개의 크기·SHA-256과 과거 Web/수정 전/개선 후 crop PNG
  **186개**의 SHA-256·크기를 2026-11-05에 다시 확인했다.
- `../qa/layout-improvements-20261031/comparison-review/`에 62장 비교 manifest,
  186개 crop, 비교판·검토 기록이 남아 있다. 증거 manifest의 SHA-256은
  `515ffb8fb6ec5577643eeaebac60538491951f03214706c9493d743708e5a999`다.
- 이전 원본 전체 화면 대부분은 임시 폴더 정리 후 없다. DSU 22장과 Dickinson
  9장의 Web 전체 화면만 `../qa/layout-comparison-20261031/powerpoint-web/`에
  남아 있다. 보존된 crop의 해시는 당시 증거 manifest와 일치한다.
- 원본 샘플은 `qa/samples/`의 기존 로컬 자료를 재사용한다. 2026-11-05에
  새로 다운로드하거나 Microsoft에 업로드하지 않았다. 웹의 실제 선택 글꼴은
  과거 캡처 때 계측하지 않았으므로 현재 Chrome의 face와 같다고 가정하지 않는다.

## 대표 12장

| 자료 / 장                     | 선택 이유                           |
| ----------------------------- | ----------------------------------- |
| DSU / 20                      | 긴 한글 문단과 줄바꿈               |
| DSU / 14                      | 긴 한글 표 셀과 행 높이             |
| DSU / 16                      | 표 대각선, 한글·숫자 혼합           |
| DSU / 13                      | 원본의 그룹 5개와 반투명 도형 겹침  |
| Dickinson / 6                 | 영문 목록과 문단 간격               |
| Dickinson / 4                 | 원본 차트·축·라벨과 주석            |
| Dickinson / 5                 | 표의 테마색과 텍스트                |
| Dickinson / 8                 | 레이아웃에서 상속한 사진 자리표시자 |
| POI themes / 8                | 테마 제목 글꼴과 Medium 서체 대체   |
| POI shapes / 3                | 실제 `p:grpSp` 그룹 도형            |
| POI smartart-rotated-text / 1 | SmartArt 도형 배치와 회전한 글자    |
| POI table_test2 / 1           | 회전·병합된 표 셀                   |

이 12장에 양쪽 정렬의 모든 경우가 있다는 뜻은 아니다. 새 정렬 결함의 원인과
기대 결과는 별도의 최소 예제로 확인하고 이 자료는 주변 기능의 회귀를 점검한다.

## 실행과 산출물

`scripts/qa-layout-baseline.mjs`는 기존 공개 PPTX를 읽어 `importPptx`와
`SlideVisual`로 렌더링한다. 앱의 사용자 프로필이나 문서 저장 위치는 사용하지
않고, 매 자료마다 별도 Chrome context를 만든다. 출력은 Git에서 제외한
`qa/results/` 아래 새 폴더에만 쓰며 기존 실행 결과를 덮어쓰지 않는다.

```sh
# 입력 17개와 역사적 crop 186개를 검사한다. 출력 폴더는 실행마다 새 이름을 쓴다.
node scripts/qa-layout-baseline.mjs --verify-only \
  --out qa/results/layout-baseline-20261105/inventory-new

# 고정한 수정 전 소스를 전용 5193 포트에서 실행한 다음 62장을 수집한다.
node scripts/qa-layout-baseline.mjs --all \
  --url http://127.0.0.1:5193 \
  --source-root qa/results/layout-baseline-20261105/source-fd5a04c \
  --source-commit fd5a04cd77b49e70de5d1734f814e97a41b0e856 \
  --out qa/results/layout-baseline-20261105/before-new

# 수정본 5190 서버에서 대표 12장을 다시 수집해 수정 전 기록과 비교한다.
node scripts/qa-layout-baseline.mjs \
  --url http://127.0.0.1:5190 --source-root . \
  --source-commit working-tree-after-justify \
  --before qa/results/layout-baseline-20261105/before-62-verified/run.json \
  --out qa/results/layout-baseline-20261105/after-new
```

수정 전 소스 폴더를 새로 만들 때는 고정 커밋의 `git archive`를 사용한다.
다른 Vite 서버와 **`node_modules` 및 최적화 캐시를 공유하지 않는다.** 이번에는
macOS의 `cp -cR`로 의존성 폴더를 독립 복제하고 복제본의 `.vite` 캐시를 새로
만들었다. Vite가 글꼴 파일을 소스 폴더 밖의 심볼릭 링크로 해석하면 접근이
거절될 수 있다. 5193은 수정 전 전용, 5190은 현재 작업본 전용이다.

다른 컴퓨터에서는 `--sample-root`와 `--reference-root`로 보유 자료의 위치를
지정한다. 참조가 없거나 해시가 다르면 실행이 실패하며 자동 다운로드하지 않는다.

출력:

- `inventory.json`: 파일과 기준 이미지 검증 시각·해시.
- `run.json`: 소스 fingerprint, OS·CPU·Node·Chrome·배율, 가져오기 경고,
  현재 글자 경계·CSS 속성·요청 글꼴·실제 face 관찰, 오류와 이미지 로딩 상태.
- PNG: 슬라이드 영역을 Microsoft crop과 같은 종횡비·크기로 캡처한 화면.
- `index.html`: 과거 Microsoft / 선택한 수정 전 / 현재 화면 / 절대 RGB 차이.
- 차이 PNG와 측정값은 검토 순서를 정하는 자료다. 안티앨리어싱·글꼴 대체·캡처
  조건 차이가 들어 있으므로 정확도 점수나 자동 합격 판정으로 사용하지 않는다.

실제 글꼴은 CDP `CSS.getPlatformFontsForNode`로 **직접 텍스트 노드를 가진 부모**에
대해 조사한다. 컨테이너를 조사해 빈 배열을 받으면 글꼴이 확인된 것으로 처리하면
안 된다. 빈 결과는 `not-reported`, 명령 실패는 `unavailable`로 남긴다.
CSS 굵기·기울임·문자 내용은 같은 `fontNode` ID의 정보와 연결한다. face별
정확한 문자 분배까지 CDP가 알려주는 것은 아니다. 브라우저 context는 로컬
추가 글꼴 저장소나 데스크톱 Office 전용 글꼴 IPC를 불러오지 않으므로 설치 앱과의
글꼴 차이는 별도로 확인한다.

## 수정 전 실행 결과와 실패 기록

사용할 기준은 `qa/results/layout-baseline-20261105/before-62-verified/`이다.
2026-11-05 10:20:46–10:21:15 KST에 17개 파일·62장을 수집했다. 결과는
`status: captured`, JavaScript 오류·HTTP/요청 실패·이미지 로딩 실패 각 0개이며
소스 fingerprint는 캡처 전후 같았다. 실제 face가 보고된 텍스트 부모는 1,321개,
CDP가 face를 보고하지 않은 부모는 44개다. Carlito-Regular/Bold/BoldItalic의
실제 사용도 확인했다. Apple M4, Darwin 24.6.0 arm64, Node v26.5.0,
Chrome 156.0.8078.80, device scale factor 1 조건이다.

소스 fingerprint는 `d50f76923764eab89f33d25440bd8ba0ace1c466dd52873a2990edc1fb202ecb`다.
이 문서의 캡처 완료는 픽셀 일치나 육안 전수검토를 의미하지 않는다.

같은 고정 소스의 대표 12장을 `baseline-repeat-12/`에서 다시 캡처해 `--before`
비교 경로를 검증했다. 11장은 픽셀이 같았고 DSU 16장은 1,555,200개 픽셀 중
94개에서 RGB 채널 차이가 16을 넘었다(평균 절대 채널 차이 0.00477/255).
소스 변경·JS·네트워크·이미지 오류는 없었다. 원인은 아직 분리하지 않았으며,
이 정도 반복 측정 차이도 있으므로 작은 pixel diff만으로 제품 회귀를 확정하지 않는다.

초기 `before-12`, `before-62` 실행은 **유효한 기준이 아니다.** 의존성 심볼릭
링크가 원인이 되어 bundled Carlito 요청에 HTTP 403이 발생했고, 동시에
실행한 개발 서버의 Vite 최적화 캐시와 충돌했다. JavaScript `pageerror`만
수집해서 이 문제를 놓쳤다. 해당 기록에 `invalid-shared-dependency-font-assets`
상태와 원인을 남겼고 채택하지 않았다. 첫 실행의 글꼴 컨테이너 조사 문제도
직접 텍스트 부모 조사로 수정했다.

현재 도구는 HTTP 400 이상, 요청 실패, JavaScript 오류, 이미지 로딩 실패가
있으면 캡처를 유효한 기준으로 완료하지 않는다. 캡처 중 소스 변경도 거부한다.
이전 비교 결과가 유효한 `captured` 상태가 아니거나 다른 manifest를 사용했다면
`--before` 비교에 사용하지 않는다. 실패를 삭제하거나 정상 결과로 바꾸지 않는다.

## 다음 재검증

1. 변경한 최소 예제의 원인·기대 동작·수정 후 결과를 별도로 기록한다.
2. 대표 12장을 동일 기기·브라우저·글꼴 조건으로 재캡처한다.
3. 동일 소스와 변경 없는 내용에서 새 차이가 생긴 장을 우선 시각 검토한다.
4. 변경 영향이 문단·표·그룹 전체에 걸치면 `--all`로 62장을 재캡처한다.
5. 앱이 저장한 수정본은 실제 웹 PowerPoint에서 열어 복구 경고와 외관을 확인한다.
   이 도구는 Microsoft에 접속하거나 저장본의 외부 호환성을 대신 검사하지 않는다.

샘플 원본, 큰 PNG, 분리한 소스·의존성, 브라우저 결과는 Git·설치 파일에 넣지
않는다. manifest·도구·이 요약만 추적하고, 새 결과는 해당 수정 보고서와 연결한다.
