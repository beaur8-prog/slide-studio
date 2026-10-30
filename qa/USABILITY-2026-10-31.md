# PowerPoint 비교와 5시간 개선 — 2026-10-31

작업 기준은 Git `f735493` / 개발 버전 1.6.16입니다. 작업 시간은 2026-10-31 01:21:51–06:21:51 KST(2026-10-30 16:21:51–21:21:51 UTC)로 계획했습니다. 공개 릴리스·다운로드 파일·리토스 문서는 갱신하지 않습니다.

## 비교 방법과 우선순위

Microsoft의 공개 PowerPoint 사용법과 현재 소스·실제 편집 시나리오를 비교합니다. 이 Mac에는 Microsoft PowerPoint 앱이 없어 해당 앱을 직접 실행한 비교로 표시하지 않습니다. 데이터 손상과 예측하지 못한 편집을 기능 수보다 우선합니다.

| 순서 | 확인할 차이/문제 | 목표 |
|---|---|---|
| 1 | 내부 CSS 픽셀 크기가 글자 크기 입력에 그대로 표시됨 | 원본 PowerPoint의 포인트(pt)와 표시·입력·저장 크기가 일치하고 부분 선택과 실행 취소가 유지됨 |
| 2 | 크기 0인 개체를 포함한 다중 선택 조절, Shift+눈금 맞춤 | 유한한 좌표·크기와 수평/수직 제약을 유지하고 취소·저장 왕복을 검증 |
| 3 | 홈에서 글자 크기 증감·개체 정렬 접근, 맞춤 옵션 구분 | 자주 쓰는 작업의 클릭 수를 줄이고 선택·편집 포커스를 보존 |
| 4 | 독립 오디오가 앱에서 재생되지 않음 | 삽입·발표 재생·자동 시작·반복 등 기본 흐름과 PPTX 저장·재열기를 구현 |
| 5 | 관련 회귀·대용량·설치형 앱 | 마지막 약 1시간을 광범위 검사, 수정 재검증, 패키징·Git 반영·로컬 재실행에 사용 |

00:00–00:35 비교·재현, 00:35–01:40 글자 크기와 핵심 조작, 01:40–02:35 정렬과 이동/크기 조절, 02:35–04:00 오디오, 04:00–05:00 전체 회귀와 실제 패키지를 목표로 합니다. 실제 재현과 회귀 위험에 따라 순서를 조정하고 결과를 이 문서에 기록합니다. 복잡한 개체 애니메이션은 원본 보존을 유지하며 후속 과제로 남깁니다.

## 비교 근거

- [PowerPoint 글자 크기와 증감 버튼](https://support.microsoft.com/en-us/office/fonts/change-the-font-size)
- [PowerPoint 편집 키보드 단축키](https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations)
- [눈금·맞춤·안내선](https://support.microsoft.com/en-us/powerpoint/work-with-gridlines-and-use-snap-to-grid-in-powerpoint)
- [개체 정렬](https://support.microsoft.com/en-au/office/graphics-visuals/align-or-arrange-objects)
- [오디오 삽입과 재생](https://support.microsoft.com/en-gb/powerpoint/training/add-or-delete-audio-in-your-powerpoint-presentation)

## 실행 기록

검증 전에는 수정 완료나 PowerPoint 전체 호환을 주장하지 않습니다. 재현 결과·구현·검사 수·환경 한계·Git 및 로컬 앱 상태를 작업 중 갱신합니다.

### 1차 편집 개선 (약 00:30–00:40)

- 24pt 원본 제목이 32로 표시되는 문제, 0 크기 개체를 포함한 그룹 크기 조절의 무한대 좌표, Shift+눈금 이동의 반대 축 변경을 먼저 재현했습니다(3/3 실패). 표시·입력만 pt로 변환해 기존 CSS px 모델과 PPTX 외관을 유지했습니다.
- 글자 크게/작게와 Ctrl/⌘+Shift+>/<, 서로 다른 크기를 걸친 부분 선택, 커서에서 연속 크기 변경과 이후 한글 입력을 추가했습니다. 경계에 닿기만 한 앞 텍스트를 선택에 포함하는 계산과 아직 입력하지 않은 글자의 크기 표시도 수정했습니다.
- 홈에 개체 맞춤 메뉴와 정렬 기준·동일 간격을 추가했습니다. 눈금 표시, 눈금 맞춤, 가운데 안내선과 개체 맞춤은 독립 옵션입니다. Alt로 끄는 임시 맞춤 해제와 Shift 축 제약을 적용했습니다. 개체가 남아 있으면 실행 취소 후 선택을 유지합니다.
- 관련 기존 편집·표·그룹 회귀 44개가 통과했고, 새 시나리오 9개도 통과했습니다. 이 기록은 전체 회귀와 설치형 검증을 대신하지 않습니다. 자세한 실행 결과는 `qa/results/usability-20261031/`에 남겼습니다.

### 오디오 구현 범위

내장 MP3·PCM WAV·AAC M4A(각 20 MiB), 삽입·미리 듣기·자동/클릭 시작·반복·볼륨·음소거·여러 슬라이드 연속 재생을 구현하고 있습니다. 편집 썸네일과 인쇄는 정지 아이콘이며, 발표자 보기에 중복 플레이어를 만들지 않습니다. 앱 발표에서 아이콘을 숨기는 설정은 앱 확장 메타데이터에 저장합니다. PowerPoint의 녹음·트리밍·복잡한 타이밍 전체를 지원한다는 뜻은 아닙니다.

표준 오디오 파일 연결과 `p:audio/cMediaNode`의 볼륨·반복·슬라이드 수는 [Microsoft Open XML 오디오 설명](https://learn.microsoft.com/en-us/office/open-xml/presentation/how-to-add-an-audio-to-a-slide-in-a-presentation)과 [CommonMediaNode 명세](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.commonmedianode?view=openxml-3.0.1)를 기준으로 확인합니다. PptxGenJS가 audio에도 videoFile을 쓰는 부분은 저장 후 표준 audioFile로 교정합니다.

### 설치형 1차 검증과 추가 우선순위

MP3·AAC M4A의 실제 코덱 재생과 2회 PPTX 왕복 원본 바이트 보존을 확인했습니다. 별도 PCM WAV 재현과 함께 오디오 6개, 기존 GIF·동영상·보존 회귀를 검증했습니다. 오디오 설정을 바꾼 PPTX는 3회 왕복에서도 옆 개체 애니메이션과 효과음을 유지했습니다. 생성 PPTX 4종은 Open XML 구조 검증도 통과했습니다.

검수용 Mac 패키지의 별도 사용자 프로필에서 5장 MP3/AAC/WAV 자료 열기, 한글·pt 편집, Undo/Redo, 실제 디스크 저장·재열기, 원본 미디어 해시, 연속 재생·검은 화면 일시 정지·종료 자원 정리와 PDF 출력 등 10개 흐름을 통과했습니다. 오류·CSP 차단은 없었습니다. 이 단계의 패키지는 사용자 설치 앱을 교체하지 않은 후보입니다.

추가 비교에서 일반 저장이 항상 이름/위치 선택 창을 여는 차이를 확인했습니다. [Microsoft의 저장 설명](https://support.microsoft.com/en-us/powerpoint/save-your-presentation-file)과 [저장/다른 이름으로 저장 단축키](https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations)를 기준으로, 남은 시간에는 기존 파일 저장과 다른 이름 저장을 분리하고 원본의 외부 변경·취소·새 문서 전환에서 잘못 덮어쓰지 않도록 검증합니다. 공개 배포 범위는 바뀌지 않습니다.

### 1차 전체 회귀와 추가 재현 (약 01:10)

전체 521개에서 496개 통과·22개 환경/선택 샘플 조건 생략·3개 실패였습니다. 970px 홈 리본의 12px 넘침을 더 좁은 배치로 고쳤고, 이전 px 입력을 전제한 릴리스 검수 스크립트를 pt와 동등한 값으로 바꿔 재검증 4개가 통과했습니다. SVG/EMF/WMF 검사의 실행 컨텍스트 종료는 개발 서버 로그에서 `emf-converter` 최초 최적화에 따른 재로딩으로 확인했고 선행 최적화 후 재검증이 통과했습니다. 검수 추적 HTML이 저장될 때 개발 화면이 재로딩되는 것도 막았습니다. 최종 전체 회귀는 추가 수정 후 다시 수행합니다.

일반 저장의 불필요한 이름 선택 창 외에, 너비 입력란에서 `200`을 입력한 뒤 Enter 없이 네이티브 저장을 실행하면 원래 `260`이 PPTX에 저장되는 문제를 재현했습니다. 저장 직전 입력 중인 숫자를 확정하고 최신 문서 스냅샷을 쓰도록 수정할 계획입니다. 열린 파일에만 사용할 수 있는 임시 토큰과 내용 해시를 준비했고, 파일을 쓰는 중 다른 프로그램이 원본을 바꾸면 그 내용을 보존하고 임시 파일을 정리하는 검사가 통과했습니다.
