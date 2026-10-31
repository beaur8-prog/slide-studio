import { useCallback, useEffect, useRef, useState } from "react";

export type AppUpdateState = {
  phase: "idle" | "checking" | "available" | "downloading" | "verifying" | "ready" | "installing" | "up-to-date" | "manual" | "cancelled" | "installed" | "error";
  revision: number;
  currentVersion: string;
  version: string | null;
  percent: number;
  receivedBytes: number;
  totalBytes: number;
  automatic: boolean;
  platform: string;
  manualOnly: boolean;
  downloaded: boolean;
  filename: string | null;
  checkedAt: number | null;
  error: string | null;
  lastInstall: { status: "installed" | "failed"; version: string; message: string; completedAt: string } | null;
};

export const updateLabels: Record<AppUpdateState["phase"], string> = {
  idle: "업데이트", checking: "업데이트 확인 중", available: "새 버전 있음",
  downloading: "다운로드 중", verifying: "파일 검증 중", ready: "설치 준비 완료",
  installing: "앱 종료·설치 대기 중", "up-to-date": "새 업데이트 없음",
  manual: "수동 업데이트", cancelled: "업데이트 취소됨", installed: "업데이트 완료", error: "업데이트 오류",
};

export type UpdateAction = "check" | "download" | "install" | "cancel" | "reveal" | "manual";

export function useAppUpdates() {
  const [state, setState] = useState<AppUpdateState | null>(null);
  const [error, setError] = useState("");
  const [setting, setSetting] = useState(false);
  const live = useRef(false);
  const accept = useCallback((next: AppUpdateState) => {
    if (live.current) setState(previous => !previous || next.revision >= previous.revision ? next : previous);
  }, []);
  useEffect(() => {
    const bridge = window.desktop;
    live.current = true;
    const unsubscribe = bridge?.onUpdateState?.(accept);
    void bridge?.getUpdateState?.().then(accept).catch(() => {
      if (live.current) setError("업데이트 상태를 읽지 못했습니다. 다시 확인해 주세요.");
    });
    return () => { live.current = false; unsubscribe?.(); };
  }, [accept]);
  const run = useCallback(async (action: UpdateAction) => {
    setError("");
    const bridge = window.desktop;
    const method = ({ check: bridge?.checkUpdates, download: bridge?.downloadUpdate, install: bridge?.installUpdate,
      cancel: bridge?.cancelUpdate, reveal: bridge?.revealUpdate, manual: bridge?.openUpdatePage })[action];
    if (!method) { setError("업데이트를 지원하는 데스크톱 앱에서 실행해 주세요."); return; }
    try { const next = await method(); accept(next); }
    catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : "업데이트 작업을 완료하지 못했습니다."); }
  }, [accept]);
  const setAutomatic = useCallback(async (enabled: boolean) => {
    if (!window.desktop?.setAutomaticUpdates) return;
    setSetting(true); setError("");
    try { accept(await window.desktop.setAutomaticUpdates(enabled)); }
    catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : "업데이트 설정을 저장하지 못했습니다."); }
    finally { if (live.current) setSetting(false); }
  }, [accept]);
  return { state, error, setting, run, setAutomatic };
}
