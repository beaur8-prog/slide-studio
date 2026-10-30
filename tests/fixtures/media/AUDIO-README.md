# 합성 오디오 검수 자료

`native-audio.pptx`는 오디오를 포함한 한글 슬라이드 5장입니다. 실제 사용자 자료, 제3자의 음악·음성, MDN에서 내려받은 음원을 포함하지 않습니다.

- MP3: MPEG-1 Layer III 128kbps/44.1kHz 스테레오 무음 프레임 240개입니다. 각 프레임은 헤더 `FF FB 90 00`과 413개의 0 바이트로 구성했습니다. Chrome에서 실제 디코딩·재생을 검증했습니다.
- AAC M4A: `scripts/qa-audio-codecs.cjs`가 Web Audio 정현파와 MediaRecorder로 생성했습니다.
- PCM WAV: 같은 스크립트가 8kHz/16bit 모노 무음으로 생성했습니다.

같은 스크립트가 앱의 PPTX 저장 경로로 문서를 만들고 두 차례 왕복 후 원본 오디오 바이트를 검사합니다. Windows·Linux CI와 Mac 패키지에서 `scripts/qa-audio-native.cjs`로 재생·한글 편집·실행 취소/다시 실행·저장·재열기·PDF 출력을 검사합니다. 이 PPTX는 배포 파일이 아닌 자동 검사용 입력 자료입니다.
