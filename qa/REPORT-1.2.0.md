# Slide Studio 레이아웃 수정 검증

검사일: 2026-10-17. 대상: **1.2.0**. 이전 결과는 [1.1.1 보고서](REPORT-1.1.1.md)에 보존했습니다.

**확인된 글자 겹침·잘림과 표·그림·도형 누락을 수정했습니다.** 공개 PPTX 5개, 465장을 다시 열고 저장했으며, 대표 화면과 회귀 검사에서 수정 결과를 확인했습니다. 모든 PowerPoint 기능이나 모든 원본 글꼴의 동일한 표현을 보장하는 결과는 아닙니다.

앱을 다시 열고 **원본 PPTX를 다시 불러오면** 새 가져오기 기능이 적용됩니다. 이전 버전에서 이미 누락된 개체는 기존 자동 저장 문서만 열어서는 복구되지 않습니다.

## 수정한 화면

| 자료·페이지 | 수정 결과 | 비교 화면 |
| --- | --- | --- |
| CMU 1, 1쪽 | 겹친 하단 두 문구 분리, 잘림과 불필요한 제목 테두리 제거, TIFF 표지 이미지 복원 | [이전](results/final/cmu-lecture-1-slide-001.png) · [현재](results/layout-final/cmu-lecture-1-slide-001.png) · [원본 PDF](results/final/reference-cmu-1-001.png) |
| CMU 2, 28쪽 | 빠진 표 격자·숫자 복원, 수식 이미지와 자르기 정보 보존 | [이전](results/final/cmu-lecture-2-slide-028.png) · [현재](results/layout-final/cmu-lecture-2-slide-028.png) · [원본 PDF](results/final/reference-cmu-2-028.png) |
| CMU 3, 34·35쪽 | 알고리즘 마지막 문장과 하단 질문·답이 끝까지 표시됨 | [이전 34쪽](results/final/cmu-lecture-3-slide-034.png) · [현재 34쪽](results/layout-final/cmu-lecture-3-slide-034.png) · [35쪽](results/layout-final/cmu-lecture-3-slide-035.png) |
| CMU 4, 1쪽 | 하단 겹침·잘림과 불필요한 제목 테두리 제거 | [이전](results/final/cmu-lecture-4-slide-001.png) · [현재](results/layout-final/cmu-lecture-4-slide-001.png) |
| 한글 자료, 2쪽 | 어색한 단어 줄바꿈 개선, 사람 실루엣과 하단 자유형 도형 복원 | [이전](results/final/dsu-korean-slide-002.png) · [현재](results/layout-final/dsu-korean-slide-002.png) |
| 한글 자료, 8쪽 | 세로 방향 한글 4개가 한 열씩 끝까지 표시됨 | [이전](results/final/dsu-korean-slide-008.png) · [현재](results/layout-final/dsu-korean-slide-008.png) |
| 한글 자료, 6쪽 | 비어 있던 조직도의 도형·연결선·8개 제목을 저장된 SmartArt 배치에서 복원 | [현재](results/layout-final/regression-dsu-korean-pptx-slide-6-diagram.png) |
| 한글 자료, 12쪽 | 표의 배경·테두리·텍스트 복원, 긴 문장이 있는 행 높이 수정 | [현재](results/layout-final/dsu-korean-slide-012.png) |
| CMU 1, 70쪽 | 서로 다른 글자 크기가 섞인 빈 줄의 높이를 바로잡아 제목과 마지막 문장을 화면 안에 표시 | [수정 중 발견한 문제](results/layout-review/cmu-lecture-1-slide-070.png) · [현재](results/layout-final/cmu-lecture-1-slide-070.png) |
| CMU 3, 117·118쪽 | 첫 문단 앞 여백의 기본 생략 규칙을 반영해 하단 설명 잘림 제거 | [현재 117쪽](results/layout-final/cmu-lecture-3-slide-117.png) · [118쪽](results/layout-final/cmu-lecture-3-slide-118.png) |

문단별 정렬·간격과 글자별 서식, 상속된 글꼴, 여백, 세로쓰기, 이미지 자르기·뒤집기, 숫자로 표현된 자유형 경로, 레이아웃·마스터 장식의 관계 정보를 가져오도록 수정했습니다. Calibri 대체용 Carlito 글꼴을 앱에 포함했습니다. 원본에 명시된 넘침과 잘림 설정도 구분합니다.

표는 셀별 텍스트·배경·테두리로, 저장된 도형 배치가 있는 SmartArt는 개별 도형·선·텍스트로 편집합니다. 수식이 이미지로 들어 있는 경우 이미지로 보존하며 수식 편집기로 변환하지 않습니다.

## 범위와 판정

465장 전체의 텍스트 상자와 DOM Range 줄 경계를 자동 검사했습니다. 최종 대표 화면 **41장**과 조직도 회귀 화면 **1장**을 육안 확인했고, 문제 사례는 공개 원본 PDF와 대조했습니다. 465장을 모두 원본과 한 장씩 육안 대조하지는 않았습니다.

- 슬라이드 바깥으로 나가는 텍스트 줄 경계 후보: **0개**.
- 잘림 설정이 있는 상자에서 넘치는 텍스트 후보: **0개**.
- 상자를 넘어 표시되는 텍스트: **98개**. 원본의 넘침 허용 설정을 따른 경우도 포함합니다.
- 텍스트 상자 겹침 후보: **103쌍**. 줄 경계로 좁히면 **30쌍**이며 CMU 2의 14–22쪽과 CMU 3의 46–48쪽에 반복됩니다. 대표 화면에서 제목·그림 설명 또는 알고리즘의 줄 사이 간격이 보이며 실제 글자 획의 접촉은 확인되지 않았습니다. DOM Range는 글자 획보다 큰 글꼴 영역을 포함하므로 후보 수는 결함 수가 아닙니다.

이전의 넘침 후보 278개와 새 잘림 후보 0개는 같은 지표가 아닙니다. 넘침 허용/잘림을 구분하도록 검사기를 보완했고, 실제 결함 수정은 비교 화면과 별도 회귀 검사로 확인했습니다.

화면 목록: [CMU 1](results/layout-final/cmu-lecture-1-contact.png) · [CMU 2](results/layout-final/cmu-lecture-2-contact.png) · [CMU 3](results/layout-final/cmu-lecture-3-contact.png) · [CMU 4](results/layout-final/cmu-lecture-4-contact.png) · [한글](results/layout-final/dsu-korean-contact.png).

## 대용량 열기와 저장

각 파일을 새 브라우저 컨텍스트에서 3회, 총 **15회** 열었습니다. 열기·자동 저장·대표 슬라이드 이동을 모두 완료했고 JavaScript 예외는 **0건**이었습니다. 열기와 자동 저장은 3회 중앙값, PPTX 쓰기는 파일별 첫 실행값입니다. 다운로드 시간은 포함하지 않습니다.

| 자료 | 크기 | 장수 | 편집 UI 표시 | 자동 저장 완료 | PPTX 쓰기 |
| --- | ---: | ---: | ---: | ---: | ---: |
| CMU lecture 1 | 191.80 MiB | 70 | 2.04초 | 2.09초 | 3.07초 |
| CMU lecture 2 | 11.72 MiB | 116 | 1.60초 | 2.18초 | 2.10초 |
| CMU lecture 3 | 48.94 MiB | 151 | 1.19초 | 1.65초 | 2.15초 |
| CMU lecture 4 | 14.84 MiB | 106 | 0.78초 | 1.21초 | 1.20초 |
| 한글 실습 발표 자료 | 1.89 MiB | 22 | 0.28초 | 0.73초 | 0.23초 |

표와 TIFF 이미지 등 이전에 생략하던 데이터를 복원해 처리량이 늘었습니다. 예를 들어 CMU 2는 6,045개 편집 개체를 가져오며 편집 화면 표시 중앙값은 기존 0.82초에서 1.60초로 늘었습니다. 최대 파일 약 201MB는 2.04초입니다. 슬라이드 이동 중앙값은 파일별 약 66–132ms였습니다.

5개 자료 모두 가져온 모델을 PPTX로 내보내고 다시 읽었을 때 **슬라이드 수, 슬라이드별 텍스트 전체와 이미지 수가 보존**됐습니다. 이는 지원 범위에 속한 개체의 왕복 검사이며 원본의 미지원 영상·차트 등을 포함한 완전 보존을 뜻하지 않습니다.

300장 합성 편집 자료의 최종 측정: 문서 재열기 **1.476초**, 자동 10키 입력 **0.166초**, 편집 종료부터 자동 저장 완료까지 **0.885초**. 단일 실행값이며, 실제 대형 이미지 300장이나 장시간 메모리 누수 검사는 아닙니다. [원시 기록](results/layout-final/editor-metrics.json).

## 한글·저장 회귀 검사

기본 회귀 테스트 **25개 통과**. 공개 문제 사례 10개, 병합 셀과 테두리, 마스터·레이아웃 장식, 혼합 서식·자유형 경로·이미지 자르기의 프로젝트/PPTX 왕복, 입력 검증과 기존 동작을 포함합니다.

Chromium 조합 엔진에서 `ㅎ → 하 → 한`, `ㄱ → 그 → 글`을 입력·확정했습니다. 한영 혼용·받침·자모·줄바꿈, 실행 취소/다시 실행, 자동 저장 후 재열기, `.slide` 및 PPTX 왕복에서 아래 문장이 유지됐습니다. 이번에는 가져온 문서와 같은 문단 서식이 있는 텍스트 상자에서도 검사했습니다.

```text
한글 입력 정상 — Hello 123
둘째 줄: ㄱㄴㄷ, 값·꽃·읽기
```

[한글 입력 화면](results/layout-final/korean-composition.png).

배포용 `dist`만 제공하는 별도 로컬 서버에서도 **1개 추가 검사 통과**: 201MB 자료의 TIFF 복원, 포함된 Carlito 글꼴 로드, 한글 조직도·표 표시, 실제 내보내기 버튼으로 PPTX 다운로드 후 재열기를 확인했습니다. 개발 회귀 25개와 합해 **26개 검사 통과**입니다. [배포본 검증 화면](results/layout-final/production-diagram.png) · [실제로 저장한 PPTX](results/layout-final/production-roundtrip.pptx) · [테스트 기록](results/layout-final/test-summary.json).

TypeScript·프로덕션 빌드·패키징을 완료하고 `/Applications/Slide Studio.app`을 **1.2.0**으로 업데이트했습니다. 설치된 앱의 엄격한 서명 검증이 통과했으며 `app.asar` SHA-256이 검증된 빌드와 일치합니다. [배포 ZIP](../release/Slide-Studio-mac-arm64.zip)도 갱신했습니다. 이미 실행 중인 앱은 다시 열어야 새 버전이 적용됩니다.

## 남아 있는 호환 범위

원본 글꼴이 없으면 대체 글꼴의 굵기·글자 모양·줄바꿈이 달라질 수 있습니다. 예를 들어 CMU 3의 알고리즘 마지막 문장은 원본 한 줄 대신 두 줄로 표시되지만 내용은 잘리지 않습니다. 차트, 자동 재배치가 필요한 SmartArt, 영상 재생, 복잡한 애니메이션·그룹 변환·효과, 일부 벡터 형식은 완전 지원하지 않습니다. [상세 호환 범위](../IO_NOTES.md).

Mac 잠금 상태 때문에 macOS 한글 입력기에서 실제 키보드로 조합하는 검사, 설치 앱 창의 재실행과 네이티브 인쇄 창 검사는 이번에 하지 못했습니다. 사용자의 잠금을 해제하거나 기존 브라우저 프로필을 사용하지 않았습니다.

## 환경·재현·출처

Apple M4 / macOS arm64 / Chrome 155.0.8059.80, 격리된 headless 프로필, 1440×1000 화면의 개발용 편집기에서 측정했습니다. 파서 검사를 먼저 실행하므로 모듈·파일 캐시가 준비된 상태입니다. 실제 Electron 앱의 최초 기동이나 Finder 파일 선택 시간을 뜻하지 않습니다. 화면 검사는 앱과 같은 슬라이드 렌더러의 인쇄 모드를 사용했습니다.

```sh
python3 scripts/fetch-qa-samples.py
npm run dev
# 별도 터미널에서:
node scripts/qa-corpus.mjs layout-final --repeat=3 --round-trip
npm test
npm run package
npm test -- tests/production.spec.ts
```

[최종 원시 결과](results/layout-final/corpus.json) · [요약](results/layout-final/summary.json). 배포 파일과 설치 검증은 [빌드 기록](../release/BUILD.json)에 기록합니다.

자료 출처: [CMU 16-385](https://www.cs.cmu.edu/~16385/), [동서대학교 공개 자료](https://cess.dsu.ac.kr/lifelong/index.php?idx=2039&mode=view&pCode=lecture). 다운로드 URL·파일 크기·SHA-256은 [sources.json](samples/sources.json)에 있습니다. 자료와 결과는 로컬 `qa/`에 보관하며 배포 앱에 포함하지 않습니다.
