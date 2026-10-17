# Slide Studio 1.3.0 배포 검증

2026-10-17. Windows x64 ZIP과 Mac Apple Silicon ZIP을 준비하고 Lithos 보관함에 다운로드 안내와 간단 사용설명서를 게시했다.

## 변경

- Windows 실행 파일의 제품 이름·버전·아이콘을 적용하고 공식 Electron 42.11.15 런타임을 포함했다. 별도 설치 없이 ZIP 전체를 풀어 실행한다.
- Windows에는 Ctrl 기반 메뉴 힌트와 앱 ID를 적용했다. 저장 파일명의 예약 장치 이름과 끝의 점을 처리했다.
- Mac과 Windows에 동일한 프로덕션 app.asar를 포함했다.
- 재현 명령: npm run package:mac, npm run package:win.

## 확인 결과

- TypeScript 및 Vite 프로덕션 빌드 통과.
- 기존 한글 조합·PPTX·공개 샘플 레이아웃·300장 편집·프로덕션 자산 검사와 Windows 파일명 검사를 포함한 32개 검사 통과.
- 추가 Windows UI 검사에서 네이티브 메뉴 대신 브라우저 키 이벤트로 인쇄를 보내던 테스트 설정을 수정했다. Ctrl 저장, 단축키 표시, 네이티브 메뉴 콜백과 화면의 인쇄 버튼 검사를 재실행해 통과했다. 총 33개 검사 통과.
- 두 ZIP 전체 CRC32 검사 통과. app.asar SHA-256이 서로 동일하다.
- Mac ZIP을 별도의 임시 폴더에 풀어 codesign --verify --deep --strict와 버전 1.3.0을 확인했다.
- Windows 런타임 다운로드는 Electron npm 패키지에 배포된 SHA-256과 일치한다. x64 PE32+, 제품 정보, 필수 DLL·한국어 로케일·프로덕션 ASAR를 확인했다.
- 공개 HTTPS 링크에서 Mac ZIP 128,854,254바이트와 Windows ZIP 156,027,173바이트 전체를 받아 SHA-256 일치를 확인했다. 설명서 TXT·체크섬 파일도 일치하며 다운로드 버튼 4개가 표시된다. 로그인 없는 새 브라우저에서 두 문서와 설명서 이미지, 모바일 스크롤·단축키 표를 확인했고 페이지 오류와 가로 넘침은 없었다.
- 공식 Windows 런타임과 완성 EXE의 실행 코드 섹션 4개를 별도 PE 파서로 비교해 바이트 단위 일치를 확인했다.
- 실제 Windows 기기에서의 실행, Windows IME 및 프린터 검사는 하지 않았다. Windows UI 검사는 Mac의 Chrome에 Windows 플랫폼 및 데스크톱 브리지를 설정해 수행했다.
- Mac은 ad-hoc 서명이며 공증하지 않았다. Windows는 배포 서명을 적용하지 않았다.

## 결과 파일

- release/VERIFICATION.json: ZIP 크기, SHA-256, app.asar 일치 및 Mac 서명 검증.
- release/BUILD-win-x64.json: 런타임 출처와 체크섬, Windows 패키지 검증.
- qa/results/release-1.3.0/publication-verification.json: 공개 HTTPS 다운로드 전체 해시 검증 및 로그인 없는 브라우저 검사.
- qa/results/release-1.3.0/: 공유 문서의 데스크톱·모바일 화면.
- publication/PUBLISHED.json: 현재 공유 주소.

## 공유 운영

원본 노트는 ~/Lithos Vault/앱/에 있다. 공유는 기존 Lithos ShareServer를 사용하는 독립 프로세스이며, 데스크톱 앱의 기존 공유 링크는 변경하지 않는다. 이번 문서의 공유 저장소는 ~/Library/Application Support/Lithos/slide-studio-download-share/이다. 문서는 읽기 전용이고 만료일은 지정하지 않았다.

Mac이 꺼지거나 수동 잠자기·네트워크 단절로 터널이 중단되면 접근할 수 없다. 활성 공유 프로세스는 자동 잠자기만 방지한다. 재부팅 후에는 node scripts/publish-lithos.cjs로 다시 시작할 수 있으며 터널 주소가 바뀐다. 실행 중인 공유 서버가 있으면 기존 주소를 반환한다.

이번 작업은 배포 ZIP을 갱신했으며 /Applications의 기존 Mac 설치본을 교체하거나 재시작하지 않았다.

## 문서 통합 갱신

2026-10-17 사용자 요청으로 다운로드 문서에 화면 안내·편집 순서·저장 형식·발표와 인쇄·단축키·PPTX 호환 범위를 통합했다. 별도 사용설명서 노트와 TXT는 Lithos 휴지통으로 옮겼고 설명서 공유 토큰을 폐기했다. 현재 문서는 하나이며 다운로드는 Mac ZIP·Windows ZIP·SHA-256 파일의 3개다. 앱 바이너리는 변경하지 않았다. 터널 재시작으로 새 공유 주소가 발급되었으며 현재 주소는 publication/PUBLISHED.json에 기록되어 있다.
