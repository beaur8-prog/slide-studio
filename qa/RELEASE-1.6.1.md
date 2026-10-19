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
