import { useEffect, useRef, useState } from "react";
import { FileDown, X } from "lucide-react";
import { listRecoveryBackups, recoveryDownload, type RecoveryBackup } from "./storage";
import "./recovery-backups.css";

export function RecoveryNotice({ blocked, onOpen }: { blocked: boolean; onOpen: () => void }) {
  return <aside className="recovery-notice" role={blocked ? "alert" : "status"}>
    <span>{blocked
      ? "기존 복구 데이터를 보관하지 못해 자동 저장을 중지했습니다. 현재 작업은 PPTX로 저장해 주세요."
      : "읽지 못한 복구 데이터를 별도로 보관했습니다. 새 작업과 별개로 원문을 내려받을 수 있습니다."}</span>
    <button type="button" onClick={onOpen}>복구 데이터 확인</button>
  </aside>;
}
export default function RecoveryBackups({ blocked, onRetry, onClose }: {
  blocked: boolean; onRetry: () => Promise<void>; onClose: () => void;
}) {
  const [records, setRecords] = useState<RecoveryBackup[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    close.current?.focus();
    void listRecoveryBackups().then(rows => { if (live) setRecords(rows); })
      .catch(() => { if (live) setMessage("보관된 복구 기록을 읽지 못했습니다."); });
    return () => { live = false; };
  }, [blocked]);
  const download = async (id?: string) => {
    setBusy(true); setMessage("");
    try {
      const { blob, name, description } = await recoveryDownload(id);
      if (window.desktop) {
        if (!window.desktop.saveRecoveryData) throw new Error("복구 데이터 저장을 지원하는 최신 앱이 필요합니다.");
        if (blob.size > 256 * 1024 * 1024) throw new Error("복구 데이터가 256 MiB보다 커서 이 창에서 내려받을 수 없습니다. 원본은 앱에 보관되어 있습니다.");
        const result = await window.desktop.saveRecoveryData({ name, data: new Uint8Array(await blob.arrayBuffer()),
          extension: name.endsWith(".json") ? "json" : name.endsWith(".zip") ? "zip" : "bin" });
        setMessage(result ? `복구 데이터를 저장했습니다. ${description}` : "저장을 취소했습니다. 보관된 원문은 유지됩니다.");
      } else {
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setMessage(description);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "복구 데이터를 내려받지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onPointerDown={e => { if (!busy && e.target === e.currentTarget) onClose(); }}>
    <section className="dialog recovery-backups" role="dialog" aria-modal="true" aria-labelledby="recovery-title"
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === "Escape" && !busy) onClose();
        if (e.key === "Tab") {
          const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
          if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons.at(-1)?.focus(); }
          else if (!e.shiftKey && document.activeElement === buttons.at(-1)) { e.preventDefault(); buttons[0]?.focus(); }
        }
      }}>
      <button ref={close} className="dialog-close icon-button" aria-label="대화상자 닫기" disabled={busy} onClick={onClose}><X size={18}/></button>
      <h2 id="recovery-title">보관된 복구 데이터</h2>
      <p>읽을 수 없었던 자동 저장 원문을 보관합니다. 내려받아도 현재 작업이나 보관된 원문은 바뀌지 않습니다. 이 파일은 복구·진단용 자료이며 PPTX로 바로 열리지 않을 수 있습니다.</p>
      {blocked && <div className="recovery-record" role="alert"><strong>아직 별도로 보관하지 못한 원문</strong>
        <p>기존 자료를 덮지 않도록 자동 저장을 중지했습니다. 현재 작업은 PPTX로 저장할 수 있습니다. 저장 공간을 확보한 후 다시 보관을 시도해 주세요.</p>
        <button disabled={busy} onClick={() => void download()}><FileDown size={15}/>기존 원문 내려받기</button>
        <button disabled={busy} onClick={() => { setBusy(true); setMessage(""); void onRetry().finally(() => setBusy(false)); }}>다시 보관 시도</button>
      </div>}
      {records.map(record => <div className="recovery-record" key={record.id}>
        <strong>{new Date(record.createdAt).toLocaleString()}</strong><p>{record.reason}</p>
        <button disabled={busy} onClick={() => void download(record.id)}><FileDown size={15}/>원문 내려받기</button>
      </div>)}
      {!records.length && !blocked && <p>보관된 복구 기록이 없습니다.</p>}
      {message && <p className="recovery-message" role="status">{message}</p>}
      <div className="dialog-actions"><span>원문은 내려받은 뒤에도 앱에 유지됩니다.</span><button className="button" disabled={busy} onClick={onClose}>닫기</button></div>
    </section>
  </div>;
}
