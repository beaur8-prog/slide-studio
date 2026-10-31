import { useEffect, useRef } from "react";
import { Download, ExternalLink, RefreshCw, X } from "lucide-react";
import { version } from "../package.json";
import { updateLabels, type useAppUpdates } from "./updates";
import "./updates.css";

const size = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;

export default function UpdateDialog({ updates, onClose }: { updates: ReturnType<typeof useAppUpdates>; onClose: () => void }) {
  const { state, error, setting, run, setAutomatic } = updates;
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus();
      else document.querySelector<HTMLButtonElement>(".file-tab")?.focus();
    };
  }, []);
  const phase = state?.phase || "idle";
  const active = ["checking", "downloading", "verifying", "installing"].includes(phase);
  const percent = Math.min(100, Math.max(0, state?.percent || 0));
  const message = error || state?.error;
  return <div className="modal-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title"
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "Tab") {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')];
          if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
        }
      }}>
      <button ref={close} className="dialog-close icon-button" aria-label="업데이트 창 닫기" onClick={onClose}><X size={18}/></button>
      <h2 id="update-title">Slide Studio 업데이트</h2>
      <p>현재 버전 <strong>{state?.currentVersion || version}</strong>{state?.version && <> · 새 버전 <strong>{state.version}</strong></>}</p>
      <div className="update-stage" role="status" aria-live="polite" aria-atomic="true">
        <strong>{updateLabels[phase]}{phase === "downloading" ? ` ${percent}%` : ""}</strong>
        {phase === "idle" && <p>새 버전이 있는지 확인하거나 직접 설치할 수 있습니다.</p>}
        {phase === "available" && <p>{state?.version} 버전을 사용할 수 있습니다. 다운로드 후 직접 설치를 시작하세요.</p>}
        {phase === "up-to-date" && <p>현재 버전보다 새로운 공개 업데이트가 없습니다.</p>}
        {phase === "downloading" && <p>{size(state?.receivedBytes || 0)} / {size(state?.totalBytes || 0)}</p>}
        {phase === "verifying" && <p>다운로드한 파일의 크기와 SHA-256을 확인하고 있습니다.</p>}
        {phase === "ready" && <p>{state?.filename} · 파일 검증을 마쳤습니다. 설치를 시작할 수 있습니다.</p>}
        {phase === "installing" && <p>설치 도우미 시작과 문서 저장·종료 확인을 기다리고 있습니다. 종료가 취소되면 설치도 취소됩니다.</p>}
        {phase === "cancelled" && <p>업데이트 확인 또는 다운로드를 취소했습니다. 편집은 계속할 수 있습니다.</p>}
        {phase === "manual" && <p>이 실행 환경에서는 공식 다운로드 페이지에서 설치 파일을 받아 직접 설치해 주세요.</p>}
        {phase === "installed" && <p>{state?.lastInstall?.version} 버전 설치를 마치고 앱을 다시 실행했습니다.</p>}
        {message && <p className="update-error" role="alert">{message}</p>}
        {["checking", "downloading", "verifying", "installing"].includes(phase) && <progress aria-label="업데이트 진행률" max={100} {...(phase === "downloading" ? { value: percent } : {})}/>}
      </div>
      <div className="update-buttons">
        <button className="button secondary" disabled={active || !window.desktop?.checkUpdates} onClick={() => void run("check")}><RefreshCw size={15}/>지금 확인</button>
        <button className="button primary" disabled={active || !state?.version || state.manualOnly || phase === "ready"} onClick={() => void run("download")}><Download size={15}/>다운로드</button>
        <button className="button primary" disabled={active || !state?.downloaded} onClick={() => void run("install")}>{state?.platform === "darwin" ? "교체 방법 보기" : "지금 설치"}</button>
        {state?.downloaded && <button className="button secondary" disabled={active} onClick={() => void run("reveal")}>다운로드 파일 보기</button>}
        {["checking", "downloading", "verifying"].includes(phase) && <button className="button secondary" onClick={() => void run("cancel")}>취소</button>}
      </div>
      <label className="update-automatic"><input type="checkbox" checked={state?.automatic ?? true} disabled={!state || state.manualOnly || setting || phase === "installing"}
        onChange={event => void setAutomatic(event.target.checked)}/>자동으로 업데이트 확인·다운로드</label>
      <p className="update-note">끄면 위 버튼으로 확인·다운로드·설치를 직접 진행합니다. 설치는 자동으로 시작하지 않습니다.</p>
      <div className="update-manual">
        <h3>수동 업데이트</h3>
        <p>{state?.platform === "darwin" ? "Mac은 ZIP을 풀어 기존 앱을 직접 교체합니다. 먼저 문서를 저장하고 앱을 종료해 주세요."
          : state?.platform === "linux" ? "Linux는 공식 페이지에서 .deb 파일을 받아 설치합니다."
            : "설치 파일을 직접 받으려면 공식 다운로드 페이지를 이용하세요. 실행 중인 문서를 먼저 저장해 주세요."}</p>
        <button className="button secondary" disabled={phase === "installing"} onClick={() => void run("manual")}><ExternalLink size={15}/>공식 다운로드 페이지 열기</button>
      </div>
      {state?.checkedAt && <p className="update-note">마지막 확인: {new Date(state.checkedAt).toLocaleString()}</p>}
      {state?.lastInstall?.status === "failed" && <p className="update-error">이전 설치 결과: {state.lastInstall.message}</p>}
      <div className="dialog-actions"><span>창을 닫아도 다운로드는 계속됩니다.</span><button className="button" onClick={onClose}>닫기</button></div>
    </section>
  </div>;
}
