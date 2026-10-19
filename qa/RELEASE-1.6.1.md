# Slide Studio 1.6.1

2026-10-19. Sheet Studio 0.7.10 / Word Studio 1.2.11과 함께 업데이트하세요.

## 변경

- 표 하나 또는 선택 셀을 HTML 표·TSV로 복사해 다른 Studio 앱에 전달합니다.
- 외부 HTML 표를 편집 가능한 표 개체로 붙이며 기존 표 셀에도 적용합니다.
- 병합·글자·빈 셀·줄바꿈·열 비율·글꼴·색·네 변 테두리를 전달합니다. 점선·파선·이중선은 현재 표 모델에서 실선으로 변환됩니다.
- 비동기 클립보드 읽기 중 문서·선택 변경을 보호하고, 잘못된 표·병합·UTF-8 10 MB 제한을 검사합니다.
- 홈과 우클릭 붙여넣기가 현재 OS 클립보드를 사용합니다. 텍스트 편집·발표·잠금 상태를 보호하고 기존 내부 개체 복사를 유지합니다.

## 배포 파일

Mac Apple Silicon ZIP, Windows x64 Setup, Linux amd64 DEB를 제공합니다. Mac Intel은 제공하지 않습니다. 설치·실행·OS 보안 경고 설명은 README와 기존 리토스 다운로드 페이지에 있습니다.

## 검증

Mac에서 개발 실행과 실제 패키지의 OS 클립보드를 사용해 Sheet↔Word, Sheet↔Slide, Word↔Slide 여섯 방향을 확인합니다. 사용자 문서를 열지 않는 격리 프로필로 검사하며 실행 취소·서식·병합·줄바꿈을 확인합니다. 운영체제별 설치·실행 검사는 해당 릴리즈의 GitHub Actions 결과를 따릅니다. 실제 Microsoft Office나 프린터의 전체 호환성을 검증한 결과는 아닙니다.

[표 교환 계약·상대 앱 구현·재현 명령](https://github.com/beaur8-prog/sheet-studio/blob/main/docs/STUDIO-CLIPBOARD.md)

## 배포 전 추가 검증

클립보드·안전성·네이티브 파일·리본·프로덕션 관련 검사 **30개가 모두 통과**했습니다. Mac 앱의 실행 코드 51개는 빌드 소스와 일치하며, 사용자 프로필과 기존 6장 문서·노트를 보존한 로컬 앱 실행을 확인했습니다.

Windows·Ubuntu 설치 앱 검사에 실제 OS 클립보드 시나리오를 추가했습니다. HTML·TSV의 홈/키보드 붙여넣기, 병합 표 편집·서식·한글·줄바꿈, 표 복사 출력, 오래된 내부 복사 대신 현재 외부 자료 사용, 부분 병합 보호, 범위 교체·실행 취소·재실행·재열기를 검사합니다. 같은 검사는 격리된 Mac 1.6.1 앱에서 통과했습니다. 세 앱을 함께 실행한 여섯 방향 검증은 Mac에서 수행했으며, Windows/Linux에서 상대 앱까지 모두 실행한 시험과 구분합니다.

Mac은 Apple 공증을 받지 않았고 Windows는 배포용 코드 서명이 없습니다. 다운로드 경고와 **‘Windows의 PC 보호’ → ‘추가 정보’ → ‘실행’** 안내를 유지합니다. 실제 Windows/Linux 키보드 IME 직접 입력, Wayland·종이 출력·Microsoft Office 상호 운용은 이번 검사 범위에 포함하지 않습니다.

로컬 배포 검증 자료는 `qa/results/release-1.6.1/`에 보관합니다. [앞선 구현·Mac 왕복 검증](STUDIO-CLIPBOARD-1.6.1.md)을 함께 참고하세요.

## 최종 공개 검증 — 2026-10-19

- [Windows 설치·실행·재설치·제거](https://github.com/beaur8-prog/slide-studio/actions/runs/39190178586) 통과. 표 HTML/TSV OS 클립보드 검사 10개와 기존 편집·발표 검사, 실행 중 업데이트 차단 및 사용자 자료 보존을 확인했습니다.
- [Ubuntu 22.04·24.04 설치·실행·재설치·제거](https://github.com/beaur8-prog/slide-studio/actions/runs/39189577260) 통과. 같은 클립보드 검사와 Chromium 샌드박스 유지도 확인했습니다.
- Windows CI의 기본 화면 1024×768은 앱의 최소 창 폭 1080보다 작았습니다. 테스트 모니터를 1920×1080으로 구성한 뒤 기존 전체 화면 크기 판정을 그대로 통과했습니다. 창·콘텐츠·모니터 크기가 모두 1920×1080인 진단 기록을 보관했습니다. 이 과정에서 앱 실행 코드를 바꾸지 않았습니다.

태그 `v1.6.1`은 `b41614bfc470124d84ef922216d5154a560c4139`이며 실행 코드 변경은 `3037492107fe06572c2042c2f534847895afd1a1`에 있습니다. 뒤의 커밋은 검증·CI·문서 변경입니다. 네 패키지는 동일한 `app.asar`를 포함합니다: SHA-256 `876b977516be860dfbfb39d9232e426353784109319824f9cbb9cae340a9b2b2`.

| 파일 | 바이트 | SHA-256 |
| --- | ---: | --- |
| Mac ARM64 ZIP | 129793114 | `f708050ea017c8c52ef0f31858def164808dbb1fc46724c19e015bca28cd1df3` |
| Windows x64 portable ZIP | 156966027 | `5ee02aacd4b04bc9139e47f754bf25ac0bb6e268c702293f3802d17af80b84ed` |
| Windows x64 Setup | 109641498 | `d00bc305733cb857a4c3f60da413e3b0792afa7b4f9aee52f111a6deeb4ff1ee` |
| Linux amd64 DEB | 132462246 | `91f696447b5b4f7057dc75b7353280561e4dd354a90637b09eb2e2be73bfde64` |

[정식 1.6.1 릴리스](https://github.com/beaur8-prog/slide-studio/releases/tag/v1.6.1)를 최신 배포로 전환했습니다. 기존 `/releases/latest/download/` 주소에서 네 파일과 SHA256SUMS.txt를 실제로 다시 받아 크기·SHA-256·1.6.1 리디렉션과 GitHub 자산 해시를 비교했습니다.

[기존 리토스 문서](https://pink-photos-barrel-activation.trycloudflare.com/s/209727b046a226e48d2c00d344cf6facbd4bdb99d62595a6)의 1.6.1 버전·설명·설치 경고와 이미지 13개를 확인했습니다. 문서 URL·토큰·생성/만료·서버 PID/포트·터널 PID와 다운로드 주소를 유지했습니다. 공유 서버나 터널을 다시 시작하지 않았으며 브라우저에서도 갱신 내용을 확인했습니다.
