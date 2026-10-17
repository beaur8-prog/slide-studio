# Slide Studio

Mac과 Windows에서 독립적으로 실행하는 프레젠테이션 편집 앱입니다. PowerPoint의 공개 사용법에 나오는 리본, 슬라이드 목록, 개체 편집과 발표 흐름을 참고해 새로 구현했습니다. Microsoft PowerPoint 원본이나 원본 소스를 복원한 제품은 아닙니다.

**1.4.1**은 발표 탐색·입력 격리, 문단 편집과 PPTX 가져오기를 보정하고, 문서 목록을 닫은 뒤 이미지 데이터가 메모리에 남던 문제를 수정했습니다. 숨긴 슬라이드, 번호로 장 이동, 빈 문단·줄바꿈·번호 서식 보존을 개선했습니다. 분석 근거는 [Windows PowerPoint 관찰 기록](POWERPOINT-ANALYSIS.md), 이번 배포 검증은 [1.4.1 검증 기록](qa/RELEASE-1.4.1.md)을 참고하세요.

**Ctrl+K**로 명령과 슬라이드를 검색하고, **Ctrl+F1**로 리본을 접을 수 있습니다. 오른쪽 위 **서식** 버튼으로 서식 패널을 열고, 해/달 버튼으로 편집 화면의 밝기를 바꿉니다.

## 다운로드와 실행

[최신 버전 다운로드](https://github.com/beaur8-prog/slide-studio/releases/latest)에서 운영체제에 맞는 ZIP을 받으세요. 앱 안에 실행 환경이 포함되어 있으므로 **PowerPoint, Node.js, 인터넷 연결 없이** 사용할 수 있습니다.

| 운영체제 | 다운로드 | 실행 방법 |
| --- | --- | --- |
| macOS 12 이상 · Apple Silicon(M1 이후) | [Mac ARM64 ZIP](https://github.com/beaur8-prog/slide-studio/releases/latest/download/Slide-Studio-mac-arm64.zip) | ZIP을 풀고 Slide Studio.app을 응용 프로그램 폴더로 옮겨 실행 |
| Windows 10/11 · Intel/AMD 64비트 | [Windows x64 ZIP](https://github.com/beaur8-prog/slide-studio/releases/latest/download/Slide-Studio-win-x64.zip) | ZIP 전체를 풀고 Slide Studio.exe 실행 |

다운로드 주소는 버전이 바뀌어도 동일합니다. 같은 주소를 사용하는 리토스 문서의 다운로드 버튼도 최신 공개 릴리스를 받으며, 파일 교체를 위해 공유 서버를 재시작할 필요가 없습니다.

Windows에서는 EXE와 `resources`, `locales`, DLL을 함께 보관하세요. Mac 빌드는 Apple 공증을 받지 않았고 Windows 빌드는 배포용 코드 서명이 없습니다. Mac 직접 실행과 Windows 패키지 검사의 범위는 [1.4.1 검증 기록](qa/RELEASE-1.4.1.md)에 있습니다. Windows 변경 사항은 앞선 PC 실기 검증 기록이 있지만, 이번에 재생성한 1.4.1 Windows ZIP은 Mac에서 패키지 검사만 수행했습니다. 실제 키보드 IME와 종이 출력은 미검증입니다. Intel Mac, Windows ARM 및 32비트용 패키지는 제공하지 않습니다.

다운로드한 파일의 해시는 릴리스에 첨부된 `SHA256SUMS.txt`와 비교할 수 있습니다.

## 처음 사용하기

1. **파일 → 새 프레젠테이션**으로 시작하거나 **파일 → 파일 열기**에서 `.pptx` / `.slide` 파일을 엽니다.
2. **새 슬라이드**를 눌러 장을 추가하고, 왼쪽 목록을 끌어 순서를 바꿉니다.
3. 글자를 더블클릭해 입력합니다. 위쪽 도구에서 글꼴·크기·색을 바꾸고 **삽입**에서 도형과 이미지를 추가합니다.
4. **파일 → 프로젝트 저장**으로 편집용 `.slide` 파일을 보관합니다. 전달용 파일은 **PPTX 내보내기** 또는 **파일 → PDF 내보내기**로 만듭니다.
5. **발표하기**를 누르고 방향키 / Space / 마우스 휠로 이동합니다. 숫자 다음 Enter로 원하는 장에 이동하며, Esc로 편집 화면에 돌아옵니다.

편집 화면의 슬라이드 위에서 마우스 휠을 내리면 다음 장, 올리면 이전 장으로 이동합니다. 확대 상태에서는 먼저 화면을 스크롤한 뒤 가장자리에서 장을 넘깁니다. **Ctrl+휠**은 확대·축소하며, 왼쪽 목록은 자체적으로 스크롤됩니다.

큰 슬라이드 편집 영역 오른쪽의 스크롤바는 화면에 맞춤 상태에서도 항상 표시됩니다. 손잡이를 끌어 원하는 장으로 이동하거나 아래쪽 이전/다음 장 버튼을 사용할 수 있습니다. 확대 상태에서는 슬라이드 내부 위치도 조절하며, 스크롤바에 키보드 포커스를 두면 방향키·Page Up/Down·Home/End로 이동할 수 있습니다.

자동 저장은 현재 기기에만 남으며 기기 간 동기화를 하지 않습니다. 중요한 작업은 `.slide` 파일로도 저장하세요. 이전 문서는 왼쪽 위 로고 또는 **파일 → 내 프레젠테이션**에서 찾을 수 있습니다.

| 기능 | Mac | Windows |
| --- | --- | --- |
| 파일 열기 / 프로젝트 저장 | ⌘O / ⌘S | Ctrl+O / Ctrl+S |
| 실행 취소 / 다시 실행 | ⌘Z / ⇧⌘Z | Ctrl+Z / Ctrl+Y |
| 새 슬라이드 / 복제 | ⌘M / ⌘D | Ctrl+M / Ctrl+D |
| 발표 / 인쇄 | ⌘Enter / ⌘P | Ctrl+Enter / Ctrl+P |

## 소스에서 실행

Node.js 22 이상과 npm을 준비한 뒤 다음 명령을 사용합니다.

```sh
git clone https://github.com/beaur8-prog/slide-studio.git
cd slide-studio
npm ci
npm run build
npm start
```

브라우저에서 개발하려면 `npm run dev`를 실행하고 http://127.0.0.1:5190 을 엽니다. 데스크톱 앱 개발 모드는 개발 서버를 켠 뒤 `npm run desktop`으로 실행합니다.

## 편집 기능

- 제목, 본문, 두 단, 빈 화면 레이아웃으로 슬라이드를 추가합니다. 목록에서 끌어서 순서를 바꾸고 복제·삭제할 수 있습니다.
- 텍스트를 더블클릭하거나 선택 후 Enter를 눌러 편집합니다. 글꼴, 크기, 굵게, 기울임, 밑줄, 정렬과 색상을 변경할 수 있습니다.
- 이미지와 기본 도형을 삽입하고 마우스로 이동·크기 조절합니다. 오른쪽 패널에서 위치, 크기, 회전과 불투명도를 정확하게 지정합니다.
- Shift로 여러 개체를 선택합니다. 복사·붙여넣기, 복제, 레이어 순서, 잠금, 정렬, 눈금 맞춤과 안내선을 지원합니다.
- 테마와 배경, 16:9 / 4:3 비율을 변경합니다. 발표자 노트와 페이드 전환을 설정합니다.
- 발표를 시작하면 자동으로 전체 화면으로 전환합니다. 클릭·방향키·Space로 이동하고 숫자 + Enter로 원하는 장에 바로 이동합니다. 영문 입력 상태에서 B로 검은 화면을 켠 뒤 탐색하면 같은 장이 먼저 다시 표시됩니다. Esc로 중단하면 현재 발표 장을 편집하며, 마지막 장 뒤에는 종료 안내가 나옵니다.
- **슬라이드 쇼 → 슬라이드 숨기기**로 일반 발표에서 제외할 장을 지정합니다. 축소판 번호에 취소선이 표시되며 PPTX와 프로젝트 파일에 숨김 설정을 보존합니다. 현재 장부터 시작하거나 번호로 직접 이동하면 숨긴 장도 볼 수 있습니다.
- 실행 취소와 다시 실행을 지원합니다. 변경 내용은 이 기기의 IndexedDB에 자동 저장합니다. 로고 또는 파일 메뉴의 **내 프레젠테이션**에서 이전 문서를 열 수 있습니다.

## 파일

- **프로젝트 저장 (.slide)**: 앱의 편집 상태를 온전히 보관하는 JSON 형식입니다. 백업과 작업 이어가기에 사용합니다.
- **PowerPoint (.pptx)**: 문단·부분별 글자 서식, 도형·이미지, 셀별 텍스트·배경·테두리를 편집 가능한 개체로 내보냅니다. 슬라이드 크기, 노트, 단순 페이드 전환을 포함합니다.
- **PPTX 열기**: 텍스트·도형·이미지·노트와 테마·레이아웃 상속을 가져옵니다. 문단 간격, 한글 세로쓰기, 표의 셀과 병합 영역, TIFF 이미지, 이미지 자르기, 지원하는 자유형 도형과 마스터 장식도 보존합니다. 표는 개별 셀 개체로 편집합니다. 호환되지 않는 항목은 가져오기 후 안내합니다.
- **PDF 내보내기**: 데스크톱 앱의 파일 메뉴에서 현재 모든 슬라이드를 PDF로 저장합니다. 브라우저에서는 인쇄 대화상자의 PDF 저장을 사용합니다.
- **인쇄**: 프린터를 운영체제에 등록한 뒤 **파일 → 인쇄** 또는 **⌘P / Ctrl+P**를 사용합니다. 슬라이드 한 장을 한 페이지로 출력하며 편집 도구와 발표자 노트는 제외합니다. 프린터가 없는 Mac에서는 인쇄 창이 열리지 않으므로 **PDF 내보내기**를 사용하세요. 브라우저에서는 파일 메뉴로 브라우저 인쇄 창을 엽니다.

차트, 매크로, 영상 재생, 복잡한 애니메이션은 구현 범위 밖입니다. SmartArt는 파일 안에 저장된 도형 배치가 있는 경우 개별 도형으로 가져오며 자동 재배치는 지원하지 않습니다. Calibri 대체용 Carlito와 나눔바른고딕 글꼴을 앱에 포함합니다. 원본의 한영 글꼴 구분·자간·커닝·탭과 줄바꿈 설정을 보존하며, 원본 글꼴이 설치되어 있으면 우선 사용합니다. 없는 상용 글꼴은 대체되므로 일부 모양·줄바꿈 차이가 남습니다. [글꼴 처리와 한계](FONT_NOTES.md)를 참고하세요. 복잡한 그룹 변환·효과와 일부 벡터 형식도 제한됩니다. 세부 호환 범위는 [IO_NOTES.md](IO_NOTES.md)를 참고하세요.

파일 입력 상한은 256 MiB이며, 압축 해제 크기·이미지·개체 수에는 별도 제한이 있습니다. 공개 PPTX 5개, 총 465장으로 검사하고 확인된 글자 겹침·잘림과 표·그림 누락을 수정했습니다. 검사 범위와 재현 방법은 [검증 안내](qa/README.md)를 확인하세요.

발표자 노트는 편집 화면에서 작성하며 발표 화면에는 표시하지 않습니다. 별도 모니터로 분리된 발표자 화면 기능은 없습니다.

PPTX 가져오기의 자동 번호, 빈 줄 높이, 기본 줄 간격과 번호 들여쓰기를 보정했습니다.
이전에 가져와 저장한 문서의 잘못된 번호는 원본 PPTX를 다시 열어 적용하세요.
후속 수정의 검증 결과는 [Windows 비교 기록](POWERPOINT-ANALYSIS.md#문단-레이아웃-후속-수정)에 있습니다.

## 검증과 빌드

```sh
python3 scripts/fetch-qa-samples.py  # 공개 PPTX 회귀 검사에 필요한 자료
npm run build
npm test
npm run package:mac  # macOS에서 실행
npm run package:win  # Windows x64 ZIP 생성, macOS에서도 가능
```

테스트는 설치된 Google Chrome을 사용합니다. PPTX 왕복 변환, 슬라이드 순서, 테마·레이아웃 상속, 한글 조합·저장·실행 취소, 300장 편집 성능, 잘못된 프로젝트 입력과 압축 파일 경계 조건을 확인합니다. 공개 자료 회귀 검사는 `python3 scripts/fetch-qa-samples.py`로 받은 샘플이 필요하며, 배포용 자산 검사는 먼저 빌드해야 합니다. `npm run package` / `npm run package:mac`은 Mac 앱 번들과 ZIP을 만듭니다. `npm run package:win`은 공식 Electron Windows x64 런타임의 SHA-256을 검증한 뒤 PC용 ZIP을 만듭니다. Windows 패키징 도구는 macOS에서도 실행됩니다. 앱은 로컬 임시 서명을 사용하며 Apple 공증 배포본은 아닙니다.

macOS의 동기화 폴더가 앱 번들에 Finder 메타데이터를 추가할 수 있으므로 배포에는 서명 검증을 마친 임시 빌드에서 생성한 ZIP을 사용합니다. 패키징과 네이티브 연동은 [DESKTOP.md](DESKTOP.md)에 설명했습니다.

## 구현

React + TypeScript 편집기, Electron 데스크톱 셸, IndexedDB 자동 저장, JSZip 기반 PPTX 읽기와 PptxGenJS 기반 PPTX 쓰기를 사용합니다. 원본 PowerPoint 바이너리나 Microsoft 리소스를 앱에 포함하지 않습니다.

- `src/App.tsx`: 편집 상태, 리본, 슬라이드 목록, 서식 패널, 발표 모드
- `src/SlideCanvas.tsx`: 개체 선택, 이동, 크기 조절, 텍스트 직접 편집
- `src/model.ts`: 문서 모델 생성, 레이아웃, 예제와 테마
- `src/io.ts`: 프로젝트 검증과 PPTX 읽기·쓰기
- `src/storage.ts`: 기기 내 자동 저장과 문서 목록
- `electron/`: 로컬 파일 대화상자, PDF, 앱 메뉴

## 공개 UX 참고 자료

- [Microsoft: 프레젠테이션 만들기의 기본 작업](https://support.microsoft.com/en-us/powerpoint/basic-tasks-for-creating-a-powerpoint-presentation)
- [Microsoft: 슬라이드 추가·재정렬·복제·삭제](https://support.microsoft.com/en-gb/powerpoint/training/add-rearrange-duplicate-and-delete-slides-in-powerpoint)
- [Microsoft: Mac용 Office 패키지 배포 정보](https://learn.microsoft.com/en-us/officeupdates/update-history-office-for-mac)

기존 구현은 위 공개 문서를 참고했고, 이번 Windows UI 변경은 [실행 화면 관찰](POWERPOINT-ANALYSIS.md)을 추가로 반영했습니다. PowerPoint 내부 코드를 복원한 결과는 아닙니다. 원본 설치 패키지, 다운로드한 테스트 문서, 로컬 공유 설정과 생성 결과는 저장소와 배포 앱에 포함하지 않습니다. 포함한 글꼴·디코더의 라이선스는 [public/licenses](public/licenses)에 있습니다.
