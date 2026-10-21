# PPTX 표 행 높이 보존

2026-10-21. `src/io.ts`의 `parseTable()` 수정.

외곽 프레임은 72pt(`cy="914400"`)이고 네 행은 각각 32pt(`h="406400"`)인 DrawingML 표를 생성해 재현했다. 기존 가져오기는 행들을 외곽 높이에 맞춰 18pt씩으로 축소했으며, 전체 높이도 72pt로 유지해 한글이 잘렸다.

행 높이의 합계를 부모 그룹의 세로 배율과 함께 계산하고, 외곽 높이를 `max(기존 외곽 높이, 행 높이 합계)`로 확장한다. 행을 외곽 높이에 맞춰 축소하던 코드는 제거했다. 자체 메타데이터를 사용하는 빠른 경로에도 같은 높이를 적용한다. 외곽 높이가 더 큰 표의 여유 높이 배분은 유지한다.

## 검증

- 수정 전 재현 검사 실패: 기대 128pt(170.6667px), 실제 72pt(96px).
- 표·가져오기·그룹·셀 선택·크기 조절 관련 45개 검사 통과, 프로덕션 빌드 통과.
- 신규 7개 사례: 일반 표, 자체 메타데이터, 병합 셀, 불균등 행, 그룹 세로 배율, 같은 크기의 외곽, 더 큰 외곽. 실제 높이·행 높이·한글 표시와 프로젝트/PPTX 저장 왕복을 확인한다.
- Mac Electron 프로덕션 빌드를 별도 임시 프로필로 실행해 재현 PPTX를 열었다. 전체 128pt·각 행 32pt와 한글이 잘리지 않는 것을 확인했으며 자동 저장 후 다시 열기에서도 유지됐다. 사용 중인 앱과 사용자 프로필은 변경하지 않았다.

실행 명령:

```sh
npx playwright test tests/table-import-height.spec.ts tests/table-line-spacing.spec.ts tests/native-table-editing.spec.ts tests/table-insert.spec.ts tests/table-resize.spec.ts tests/table-selection.spec.ts tests/io.spec.ts tests/import-inheritance-groups.spec.ts
npm run build
```

재현 데이터는 `tests/table-import-height.spec.ts`가 생성하며 각 검사의 출력 폴더에 `input.pptx`를 남긴다. 로컬 증거는 `qa/results/table-import-height/`에 있다: `frame-72pt-rows-32pt-x4.pptx`, `fixture.json`, 수정 전후 로그/화면, `native.json`, `native-table-height.png`.

이 수정은 [1.6.5 배포](RELEASE-1.6.5.md)에 반영했다. Mac·Windows·Ubuntu 22.04/24.04 설치 앱에서도 재현 표의 높이와 한글·자동 저장 복원을 확인했다. 리토스 다운로드 문서는 기존 URL을 유지해 갱신했다. 사용 중인 Mac 앱 교체는 화면 잠금으로 보류했다.
