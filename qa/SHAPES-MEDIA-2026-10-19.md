# 도형 호환성과 GIF·동영상 (2026-10-19)

아래는 공개 v1.6.1 이후 Git 소스와 로컬 앱에서 수행한 검증 기록이다. 초기 변경은 [1.6.2 배포](RELEASE-1.6.2.md)에 포함했다. 마지막의 '다음 배포 준비' 항목은 아직 공개 배포에 포함되지 않았다. APNG 전용 입력은 사용자 요청에 따라 범위에서 제외했다.

## 도형

- 원과 삼각형을 개체 이름이나 이전 모양으로 추측하지 않고 실제 DrawingML `prstGeom`으로 구분한다. 텍스트 상자에서 다른 도형으로 바뀌어 `txBox`가 남아 있는 경우에도 사각형 텍스트로 덮어쓰지 않는다.
- 오른쪽 굵은 화살표를 고정된 대체 경로로 바꾸던 처리를 제거했다. 187종의 기본 도형 정의와 원본 조절값으로 화살표 몸통 두께·머리 길이 등을 계산한다. 조절한 삼각형의 꼭짓점도 보존한다.
- DrawingML 타원 원호의 반지름 방향각을 SVG 매개변수각과 구분하고, PPTX 내보내기에도 역변환을 적용했다. 긴 원호·곡선 화살표·리본을 정사각형과 다른 비율에서도 계산한다.
- 경로를 닫은 뒤의 현재 좌표를 재설정해 다중 부분 경로를 처리한다. 도형의 밝고 어두운 면과 꺾인/곡선 연결선의 양쪽 화살촉도 보존한다.
- 기본 원·삼각형·사각형도 SVG로 그려 윤곽선을 실제 경로에 맞췄다. CSS 사각형 테두리를 삼각형으로 잘라 쓰던 방식을 제거했다.

`tests/shape-compatibility.spec.ts`는 187종 × 정사각형/가로형/세로형 = 561개 조건을 검사한다. 각 조건은 세 차례 PPTX 저장·재가져오기 후 경로별 채우기·윤곽선·음영과 브라우저 래스터 결과를 비교한다. 원래 조절값의 75%·125%를 세 비율에 적용한 738개 추가 조건도 검사한다. 원의 정체성, 80% 두께 화살표, 비대칭 삼각형, 연결선 화살촉과 타원의 45도 교점을 별도 회귀 사례로 둔다.

독립 비교에는 생성한 표준 PPTX를 LibreOffice로 PDF 변환한 뒤 Poppler로 렌더링한 24페이지를 사용했다. 검사 자료는 `qa/results/shapes-media/shape-catalog.pptx`, `.slide`, `reference/`, `render-*.png`에 있다. 모서리·윤곽선의 안티앨리어싱 차이는 남으며, 이 비교는 Microsoft PowerPoint 모든 버전의 픽셀 일치를 보장하지 않는다. 사용자에게서 문제 원본 PPTX를 받지 못했으므로 보고된 특정 원본의 원→삼각형 현상 자체는 직접 재현하지 못했다.

## GIF / MP4 / WebM

GIF는 원본 프레임·지연·투명도·반복 정보를 유지한다. 초기 1.6.2 검사에서는 그림 삽입, 프로젝트 저장·재열기, PPTX 왕복 뒤에도 원본 바이트가 같고 편집/발표 화면의 실제 픽셀이 바뀌는지 검사했다. 반복 횟수는 GIF 파일 설정을 따른다. 아래의 후속 변경부터 편집 화면은 정지 프레임으로 표시한다.

동영상은 **삽입 → 동영상** 또는 파일 드롭으로 추가한다. **서식 → 동영상 재생**에 자동 시작·반복·음소거를 둔다. 새 영상은 세 설정이 모두 켜진다. MP4(H.264), WebM(VP8/VP9)을 재생하며 한 영상은 20 MiB, 이미지·영상 합계는 100 MiB까지 허용한다. 코덱을 읽을 수 없거나 자동 시작이 차단되면 재생 오류 또는 수동 재생 버튼을 표시한다.

원본 영상과 별도 PNG 미리보기를 저장한다. 편집·썸네일·발표자 미리보기·PDF·인쇄에는 정지 미리보기를 사용하고 현재 발표 슬라이드에서만 플레이어를 만든다. 화면 가리기·장 이동·발표 종료 시 플레이어를 중단한다. PPTX에는 네이티브 영상 관계와 단순 자동 시작·반복·음소거 타이밍을 기록한다. 같은 영상 파일은 가져오기 중 한 번만 읽는다. 크기·합계 제한을 넘는 영상은 안내 후 정지 미리보기로 가져와 문서 전체가 열리지 않는 일을 방지한다.

`tests/animated-media.spec.ts`는 직접 만든 두 색상의 GIF/H.264 MP4/VP8 WebM으로 실제 프레임 변경, 반복 시 재생 시간 되돌림, 저장·복원, 원본 바이트, PPTX 설정/고유 ID/타이밍 순서, 과대 영상 미리보기 전환, 외부 URL 거부를 검사한다. `scripts/qa-animated-media.cjs`는 별도 프로필의 패키지 앱에서 세 형식을 삽입하고 자동 저장·다시 열기·발표 반복·종료를 검사한다.

사전 검사에서는 Mac 패키지의 실제 재생을 확인했다. 이후 [1.6.2 배포 검증](RELEASE-1.6.2.md)에서 Windows 및 Ubuntu 22.04/24.04 설치 앱의 동영상 재생도 확인했다. Microsoft PowerPoint 자체의 내보낸 영상 재생은 검증하지 않았다. 외부 영상 링크·오디오·복잡한 트리거/자르기/북마크/여러 장에 걸친 재생은 지원하지 않는다.

## 재검증

```sh
npm run build
npx playwright test tests/shape-compatibility.spec.ts tests/animated-media.spec.ts
node scripts/package-mac.cjs --no-install
node scripts/qa-animated-media.cjs '/absolute/path/Slide Studio.app/Contents/MacOS/Slide Studio'
```

네이티브 검사는 저장소의 합성 영상 `tests/fixtures/media/animated.*`를 사용한다. 실제 사용자 프로필을 테스트에 사용하지 않는다.

구현 기준은 [Microsoft DrawingML ArcTo](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.arcto?view=openxml-3.0.1), [PathFillModeValues](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.pathfillmodevalues?view=openxml-3.0.1), [PresentationML CommonMediaNode](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.commonmedianode?view=openxml-3.0.1)를 참고했다. `stroke="false"`와 `stroke="0"`를 모두 지원해 음영 면에 불필요한 윤곽선을 추가하지 않는다.

## 초기 소스 검사 결과

- `npm run build`, TypeScript와 엄격한 Mac 번들 서명 검증 통과.
- 전체 274개 실행: 270개 통과, 환경 조건에 따른 2개 건너뜀. 기존 클립보드 테스트 2개는 v1.6.1 이전 기대값(붙여넣기 비활성화)과 비동기 붙여넣기 전에 저장 상태를 읽는 문제로 실패했다. 제품 코드는 바꾸지 않고 기대값 및 완료 대기를 수정했다. 이후 우클릭 메뉴 파일 5개와 해당 표 붙여넣기 1개를 별도 재검사하여 모두 통과했다. 최종 소스에서 실행 가능한 272개 항목의 통과를 확인했다.
- 187종 × 세 비율의 가져오기/세 차례 PPTX 왕복, 조절값 738개 조건, 음영 윤곽선의 `false` 표현 회귀 검사 통과.
- Mac 패키지의 GIF/H.264 MP4/VP8 WebM에서 실제 픽셀 변화·반복·자동 저장 복원·발표 종료 후 재생 중단 통과. 결과: `qa/results/shapes-media/native/verification.json`.
- 300장 문서 로드 약 1.64초, 열 번의 키 입력 약 425ms, 편집 종료 후 저장 약 567ms를 기록했다. 이 측정은 이 Mac의 회귀 테스트 조건이며 모든 실무 문서의 속도를 보장하지 않는다.
- 로컬 앱 교체 전 사용자 프로필과 이전 앱을 별도로 백업했다. 새 앱에서 기존 6장 문서, 수정한 본문과 발표자 노트, 저장 상태 및 새 동영상 삽입 버튼을 확인했다.
- 설치 앱: `/Applications/Slide Studio.app`. 로컬 버전 표시는 1.6.1이며 미배포 소스 변경을 포함한다. ASAR SHA-256: `20634e919acfb2358aee536a6373fa34ce69fcb215351a71fd32d8e83048b122`.
- GitHub Release, 공개 다운로드 파일 및 리토스 문서는 수정하지 않았다.

## 삼각형 꼭짓점·개별 조절값 추가 검증

삼각형 꼭짓점 위치가 기본값으로 돌아간다는 후속 보고를 확인했다. 같은 생성 PPTX를 공개 `v1.6.1`의 가져오기 코드와 현재 코드로 각각 읽었다. 공개 버전에서는 조절값이 있는 `triangle`도 기본 삼각형으로 처리해 꼭짓점이 모두 가로 50%에 놓인다. 현재 코드는 `61eb867`에서 추가된 분기로 원본 조절값의 경로를 계산한다. 이 비교의 이전 가져오기 모듈은 `v1.6.1:src/io.ts`를 사용했고, 상대 import만 현재 공통 모듈 경로로 연결했다. 당시 앱 전체를 실행한 비교는 아니다.

| 원본 꼭짓점의 가로 위치 | 공개 v1.6.1 가져오기 코드 | 현재 가져오기 코드 |
| --- | --- | --- |
| 0% | 50% | 0% |
| 10% | 50% | 10% |
| 20% | 50% | 20% |
| 50% | 50% | 50% |
| 80% | 50% | 80% |
| 90% | 50% | 90% |
| 100% | 50% | 100% |

`tests/shape-adjustments.spec.ts`를 추가했다. 187종 중 조절값이 정의된 123종의 300개 값을 각각 바꿔 정사각형·가로형·세로형의 1,800개 조건을 검사한다. 실제 PPTX 가져오기 → 프로젝트 저장/복원 → PPTX 내보내기/재가져오기에서 누락·기본값 복귀 없이 경로가 유지됐다. 말풍선 꼬리·연결선 굽힘은 도형 밖에도 위치하므로 래스터 비교 외에 전체 경로 좌표도 비교한다. 나눗셈 도형의 점 간격은 기본 반지름에서 범위가 0으로 고정되므로, 해당 검사에서는 반지름을 먼저 줄여 점 간격 변화가 실제로 나타나는 조건을 사용했다. 300개 모두 최소 한 조건에서 경로 변화가 발생하고, 세 단계에서 유지됨을 확인했다.

별도 삼각형 검사에서는 0/10/20/50/80/90/100%의 꼭짓점과 점 편집으로 만든 사용자 경로를 좌표 계산으로 확인하고, 실제 파일 열기 후 편집 화면과 발표 화면의 SVG 경로 및 스크린샷도 검사했다. 기존 도형 검사 5건과 새 검사 2건이 통과했다. 이번 추가 검사에서는 제품 동작 코드를 더 변경하지 않았다.

재현 파일과 결과는 `qa/results/shape-adjustments/triangle-apex.pptx`, `audit.json`, `released-comparison.json`, `triangle-editor.png`, `triangle-presentation.png`에 있다. 기준은 [Microsoft AdjustValueList](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.adjustvaluelist?view=openxml-3.0.1)다. 생성 파일을 이용한 일반 PPTX 검사이며, 사용자가 보고한 원본 파일과 별도로 추가된 Windows DRM 가져오기는 검증하지 않았다. 기존 v1.6.1 배포 파일에는 이 수정이 없으므로 1.6.2로 업데이트하거나 PC 빌드를 만들 때 `61eb867` 이후의 소스를 포함해야 한다.

```sh
npx playwright test tests/drawing-guides.spec.ts tests/shape-compatibility.spec.ts tests/shape-adjustments.spec.ts
```

## 삼각형 꼭짓점 직접 편집 — 다음 배포 준비

원본 모양 보존과 앱 안의 꼭짓점 편집은 별개 기능이다. 후속 요청에 맞춰 직선 삼각형을 선택하면 세 꼭짓점에 노란 조절점을 표시하고, 각 점을 드래그하거나 방향키로 이동하도록 추가했다. 기존 흰색 크기 조절점은 바깥쪽으로 띄워 두 조작이 겹치지 않게 했다. 회전·좌우/상하 뒤집기와 화면 배율을 반영하며, 도형의 상자·나머지 점·텍스트·채움·외곽선을 유지한다. 한 번의 드래그는 한 번의 실행 취소로 되돌린다. 잠금·여러 개체 선택·텍스트 편집 중에는 꼭짓점 핸들을 표시하지 않는다.

기본 삼각형과 `prstGeom triangle`의 조절값, PowerPoint 점 편집의 `custGeom`을 구분한다. 기본값으로 새 삼각형을 만드는 대신 가져온 실제 경로에서 세 점을 읽는다. 상자 바깥의 점과 닫는 선이 명시된 경로도 포함한다. 곡선·복합 경로는 삼각형으로 추측해 변경하지 않으며 기존 가져오기 경로를 보존한다. 편집한 삼각형은 자유형 경로로 PPTX에 저장한다. PowerPoint에서는 점 편집으로 계속 수정할 수 있고, 프리셋의 원래 노란 조절점 정보는 복원하지 않는다.

검증 중 일반 문자열 텍스트가 들어 있는 사용자 도형은 PPTX 내보내기에서 문단 처리 뒤 `continue`로 경로 작성까지 생략하는 문제를 찾았다. 원래 문단은 유지하고 도형 경로 작성은 계속하도록 고쳤다. 텍스트가 있는 삼각형을 편집·저장·다시 열어도 사각형으로 돌아가지 않는다.

- TypeScript/Vite 빌드와 Mac 패키지 서명 검사 통과.
- `triangle-points`, `shape-adjustments`, `shape-compatibility`, `shape-text-alpha`, `round-shape-layout`: **16개 통과**. 원본 조절값/직접 편집 좌표, 실제 마우스 드래그, 실행 취소/복원, `.slide`와 PPTX 왕복, 회전·뒤집기, 방향키·크기 조절 공존·잠금·다중 선택을 확인했다. 기존 187종 도형/조절값 300개·1,800개 조건의 회귀 검사도 포함한다.
- 그룹 선택/회전, 가져오기 상속·그룹, 문단 레이아웃, 부분 글자 서식의 관련 **20개 통과**.
- 빌드한 Mac 앱을 별도 임시 프로필로 실행하여 PPTX 꼭짓점 표시·드래그·상자 고정·실행 취소/다시 실행·자동 저장 복원·PPTX 재가져오기를 확인했다. 결과와 화면은 `qa/results/triangle-points/native-verification.json`, `native-triangle-points.png`에 있다. 실제 사용자 프로필은 테스트에 사용하지 않았다.

사용자가 보고한 실제 원본 PPTX와 별도 Windows DRM 가져오기 경로는 이번에도 제공되지 않아 직접 검증하지 않았다. 현재 수정은 미배포 소스/로컬 후보 앱에만 있으며 공개 1.6.2 다운로드와 리토스 문서는 교체하지 않았다. Mac 잠금으로 기존 사용자 앱의 문서를 확인할 수 없어 설치 앱의 교체·재실행은 보류했다.

## GIF 정지 미리보기 (2026-10-20) — 다음 배포 준비

편집·축소판·삽입 미리보기·발표자 미리보기·PDF/인쇄에서는 GIF의 첫 프레임만 표시한다. 슬라이드 쇼의 현재 장에서만 원본 GIF를 사용하고, 검은/흰 화면·다른 장 이동·종료 시 정지 이미지로 바꾸거나 원본 이미지 요소를 제거한다. MP4/WebM은 기존처럼 현재 발표 장에서만 재생한다. 동영상의 미리보기 이미지 자체가 GIF인 경우도 첫 프레임으로 고정한다.

`gif-preview.ts`는 GIF의 논리 화면·팔레트·투명도·첫 이미지 데이터만 읽어 한 프레임짜리 GIF를 만든다. 애니메이션을 보이지 않는 이미지나 캔버스 뒤에서 계속 재생하지 않는다. 미리보기는 메모리에서만 사용하며, 원본 `src`와 프로젝트/PPTX 데이터는 변경하지 않는다. 반복 변환을 줄이기 위해 이미지별 메모와 개수/문자 수에 한도가 있는 공유 캐시를 사용한다. 잘못된 GIF는 정지 대체 화면으로 처리하고 원본 애니메이션으로 되돌아가지 않는다. 형식 기준은 [GIF89a의 이미지·제어·하위 블록 구조](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)다.

- TypeScript/Vite 빌드와 Mac 패키지 서명 검사 통과.
- GIF/MP4/WebM, GIF 첫 프레임, 발표 탐색·편집 분리, 사진 앨범·삽입과 PPTX 왕복 관련 **32개 항목 통과**. 첫 묶음 25개와 앨범 추가 후 10개를 실행했고, 중복 3개를 제외한 수다.
- 첫 프레임의 투명도·로컬 팔레트·인터레이스·부분 이미지 위치를 원본 디코딩 픽셀과 비교했다. 잘린 파일·잘못된 블록, 서버 정적 렌더링과 GIF 동영상 포스터도 확인했다.
- GIF 40개와 빈 마지막 장으로 구성한 41장 문서에서 편집·축소판·인쇄에는 원본 애니메이션을 마운트하지 않고, 발표 중에만 현재 장의 원본 이미지 하나를 사용하는 것을 확인했다. 화면 가리기·이동·종료 시 원본 이미지가 남지 않는다.
- 프로젝트 자동 저장 및 PPTX 저장/재가져오기 뒤에도 GIF 원본 바이트가 동일했다.
- 사진 앨범의 GIF 파일 선택 미리보기도 정지 프레임으로 처리한다. 파일별 미리보기는 약한 참조로 캐시하고 순서 변경·닫기 중 완료된 비동기 결과는 이전 목록에 반영하지 않는다. 삽입 후 원본 보존과 기존 PNG 미리보기 URL 해제·실행 취소도 검사했다.
- 빌드한 Mac 앱을 임시 프로필로 실행하여 GIF 편집/축소판/인쇄 정지, 발표 실제 프레임 변화·반복·종료, MP4/WebM 재생, 자동 저장 복원을 확인했다. 결과는 `qa/results/gif-preview/native/animated-media.json`에 있다. 실제 사용자 프로필은 사용하지 않았다.

지속적인 애니메이션 재생을 제거하는 구조와 동작을 확인한 것이며 CPU/GPU·전력 절감률을 수치로 측정한 검사는 아니다. 이번 변경의 Windows/Linux 설치본 실행은 별도로 수행하지 않았다. 공개 다운로드·리토스 문서는 유지했으며, Mac 잠금 때문에 기존 사용자 앱의 교체·재실행은 보류했다. 새 Mac 후보 앱에는 앞서 커밋한 삼각형 꼭짓점 편집도 포함된다.

```sh
npx playwright test tests/gif-preview.spec.ts tests/animated-media.spec.ts tests/presentation-navigation.spec.ts tests/presentation-isolation.spec.ts tests/priority-roundtrip.spec.ts tests/insert-extras.spec.ts
node scripts/qa-animated-media.cjs '/absolute/path/Slide Studio.app/Contents/MacOS/Slide Studio' qa/results/gif-preview/native
```
