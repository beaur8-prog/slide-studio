# 검증 범위와 재현

2026-10-17, 현재 배포 버전은 Slide Studio 1.4.0입니다.

## 1.4.0 배포 검증

- 자동 검사 **58개 통과, 2개 환경 조건으로 제외**: Windows 네이티브 전체 화면과 Office 캐시 글꼴 검사는 이 Mac에서 실행할 수 없습니다.
- 실제 Mac 배포 ZIP을 풀어 설치하고 전체 화면 발표·방향키·Esc 복귀, 한글/영문 두 줄 편집·실행 취소, 프로젝트 저장, PPTX 저장·재열기와 PDF 내보내기를 확인했습니다.
- 공개 PPTX 5개 / 465장을 다시 열고 PPTX 왕복을 검사했습니다. 가장 큰 201 MB 파일을 포함해 지원 텍스트와 이미지 수를 보존했습니다. 상세 수치와 레이아웃 검사 범위는 [1.4.0 검증 기록](RELEASE-1.4.0.md)에 있습니다.
- 두 ZIP의 CRC32, 동일한 1.4.0 앱 ASAR, Mac 서명과 Windows PE/런타임 구성을 확인했습니다. 이번 Windows ZIP의 실제 실행은 이 Mac 세션에서 검증하지 않았습니다.

원본 맑은 고딕이 없는 Mac에서는 대체 글꼴의 폭 때문에 정확한 줄바꿈 위치가 달라질 수 있습니다. 두 환경 모두 내용 보존과 상자 내 배치를 검사하고, Windows 원본 글꼴이 있을 때만 원본과 동일한 줄바꿈을 요구합니다. 실제 OS IME 입력과 종이 출력은 별도 검증이 필요합니다.

## Windows 실기 비교 추가

2026-10-17 후속 수정에서는 발표 중 숨긴 장 탐색·종료·검은 화면 복귀·번호
이동과 문단 자동 번호·빈 줄 높이·기본 간격·내어쓰기 번호 배치를 확인했다.
**전체 자동 검사 71개 통과**, 공개 샘플 5개·465장 왕복에서 지원 텍스트와
이미지 수 보존, 자동 텍스트 잘림·페이지 밖 텍스트 후보·실행 오류 각각 0개를
확인했다. 결과는 `results/windows-paragraph-final/`에 있다. DSU 3·7·14장,
CMU 4의 49장을 원본 PowerPoint PDF와 시각 비교하고, 수정 후 내보낸 CMU 49장
PPTX를 실제 PowerPoint에서 열어 번호와 수식 배치도 확인했다. 상세 수치와
한계는 [문단 레이아웃 후속 수정](../POWERPOINT-ANALYSIS.md#문단-레이아웃-후속-수정)에 있다.

Windows PowerPoint와 패키지 EXE에서 공개 샘플 5개를 모두 열어 대표 화면을
대조했습니다. CMU 강의 1~4와 동신대학교 발표 예시, 총 465장입니다.
동신대학교와 CMU 강의 4는 이 PC의 PowerPoint에서 PDF로 내보내 표 간격,
선 끝 모양, 실제 대체 글꼴을 확인했습니다. 발견한 표 셀 기본 줄 간격,
양끝 원·화살표 손실, Office 전용 light 글꼴 차이를 수정했습니다.
자세한 근거와 남은 차이는 [Windows 비교 보고서](../POWERPOINT-ANALYSIS.md)에 있습니다.
회귀 검사 51개를 검증했고(실행 중 코드 갱신으로 중단된 1개는 재실행 통과),
샘플 465장의 왕복에서 지원 텍스트·이미지 수를 보존했습니다. 자동 검사에서
텍스트 잘림·슬라이드 밖 텍스트 후보·페이지 오류는 0개였습니다.

로컬 결과 경로는 `results/windows-before/`, `results/windows-native/`,
`results/windows-final/`입니다. 전체 슬라이드의 자동 검사와 대표 장면의
시각 비교를 병행했으며, 465장 전부의 픽셀 일치를 검증한 것은 아닙니다.

```sh
# 개발 서버 실행 후, 이 PC의 Office 캐시가 있다면 같은 글꼴로 검사
node scripts/qa-corpus.mjs windows-final --round-trip --office-fonts
```

Office 글꼴은 PC의 기존 캐시에서 읽으며 샘플·글꼴 파일은 배포물에 포함하지
않습니다. 아래 항목은 앞서 진행한 Mac 중심 1.3.0 검증 이력입니다.

## 기존 1.3.0 검증 이력

- 공통 편집기, PPTX 입출력, 한글 조합·실행 취소·자동 저장, 글꼴·레이아웃, Windows 파일명·단축키를 포함한 자동 검사 33개를 통과했습니다.
- 공개 PPTX 5개, 총 465장을 검사했습니다. 가장 큰 파일은 201,116,481바이트입니다. 반복 열기·저장과 지원 개체의 PPTX 왕복을 확인했습니다. 대표 화면을 원본 PDF와 비교했으며 465장 전체를 한 장씩 육안 대조한 결과는 아닙니다.
- 300장 합성 문서의 편집·저장·재열기를 검사했습니다. macOS의 Chrome에서 수행한 결과이며 모든 PC의 속도를 보장하지 않습니다.
- Mac·Windows ZIP의 압축 무결성과 동일한 앱 ASAR 포함 여부를 확인했습니다. Mac의 ad-hoc 서명과 Windows PE x64 구조·메타데이터·런타임 코드 보존을 확인했습니다.
- 설치된 Mac 1.2.1에서 네이티브 PDF 저장 창으로 4장짜리 PDF를 저장하고 한글·배경·줄바꿈을 확인했습니다. 인쇄 실행 시 등록된 프린터가 없어 인쇄 창은 열리지 않았습니다. 실제 종이 출력은 미검증입니다.
- Windows UI 자동 검사는 Mac의 Chrome에 Windows 플랫폼과 데스크톱 브리지를 설정한 검사입니다. 실제 Windows 실행·IME·프린터 검증을 대신하지 않습니다.

## 실행

Node.js 22 이상, npm, Google Chrome을 준비합니다. 공개 자료 다운로드에는 Python 3이 필요합니다.

```sh
npm ci
python3 scripts/fetch-qa-samples.py
npm run build
npm test
```

공개 자료가 없으면 해당 회귀 검사는 건너뜁니다. 배포용 자산 검사는 `dist`와 공개 샘플이 필요합니다. 다운로드 파일은 `qa/samples/`, 생성 결과는 `qa/results/`에 저장되며 Git에서 제외됩니다.

전체 자료의 렌더링·성능을 별도로 수집하려면 개발 서버를 실행한 상태에서 다음 명령을 사용합니다.

```sh
npm run dev
# 별도 터미널
node scripts/qa-corpus.mjs current --repeat=3 --round-trip
```

자료 출처는 [CMU 16-385 강의 자료](https://www.cs.cmu.edu/~16385/)와 [동신대학교 공개 게시물](https://cess.dsu.ac.kr/lifelong/index.php?idx=2039&mode=view&pCode=lecture)입니다. 다운로드 스크립트가 URL·바이트 수·SHA-256을 `qa/samples/sources.json`에 기록합니다. 원본 자료와 파생 비교 이미지는 재배포하지 않습니다.

`REPORT*.md`, `RELEASE-*.md`, `../VALIDATION.md`는 버전별 검증 기록입니다. 그 문서들의 `results/`, `samples/`, `release/` 링크는 로컬 검증 산출물을 가리키며 GitHub 저장소에는 포함하지 않습니다. 현재 다운로드는 [GitHub Releases](https://github.com/beaur8-prog/slide-studio/releases/latest)를 사용하세요.
