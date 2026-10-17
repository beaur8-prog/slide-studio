import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, LoaderCircle, RefreshCw, X } from "lucide-react";
import "./ScreenshotDialog.css";

type CaptureSource = { id: string; name: string; thumbnail: string };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export default function ScreenshotDialog({
  onInsert,
  onCancel,
}: {
  onInsert: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const native = !!(
    window.desktop?.listCaptureSources && window.desktop.captureSource
  );
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(native);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const request = useRef<Promise<CaptureSource[]> | null>(null);
  const reader = useRef<FileReader | null>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRef.current();
      } else if (event.key === "Tab") {
        const focusable = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not([type="hidden"]):not(:disabled), [tabindex="0"]',
          ) ?? []),
        ].filter((node) => node.getClientRects().length > 0);
        const first = focusable[0],
          last = focusable.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      mounted.current = false;
      reader.current?.abort();
      window.removeEventListener("keydown", key, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (!native) return;
    let live = true;
    // Reuse the in-flight request during React StrictMode's effect replay.
    request.current ??= window.desktop!.listCaptureSources!();
    request.current.then(
      (items) => {
        if (live) {
          setSources(items);
          setLoading(false);
        }
      },
      () => {
        if (live) {
          setError(
            "캡처할 창을 불러오지 못했습니다. 새로 고침하거나 이미지 파일을 선택하세요.",
          );
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [native]);

  const refresh = async () => {
    if (busyRef.current || loading) return;
    setLoading(true);
    setSelected("");
    setSources([]);
    setError("");
    try {
      request.current = window.desktop!.listCaptureSources!();
      const items = await request.current;
      if (mounted.current) setSources(items);
    } catch {
      if (mounted.current)
        setError(
          "캡처할 창을 불러오지 못했습니다. 이미지 파일을 선택할 수도 있습니다.",
        );
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  const capture = async () => {
    if (!selected || busyRef.current || loading) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await window.desktop!.captureSource!(selected);
      if (mounted.current) onInsert(data);
    } catch {
      if (mounted.current) {
        setSelected("");
        setSources([]);
        setError(
          "선택한 창을 캡처하지 못했습니다. 새로 고침 후 다시 선택하세요.",
        );
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const chooseFile = async (file?: File) => {
    if (!file || busyRef.current) return;
    setError("");
    if (
      !/^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
      file.size > MAX_IMAGE_BYTES
    ) {
      setError("15MB 이하의 PNG, JPG, GIF, WebP 이미지를 선택하세요.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const image = new Image();
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const fileReader = new FileReader();
        reader.current = fileReader;
        fileReader.onload = () => resolve(String(fileReader.result));
        fileReader.onerror = () => reject(fileReader.error);
        fileReader.onabort = () => reject(new Error("취소되었습니다."));
        fileReader.readAsDataURL(file);
      });
      image.src = data;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 16000000)
        throw new Error("이미지가 너무 큽니다.");
      if (mounted.current) onInsert(data);
    } catch {
      if (mounted.current)
        setError(
          "이 이미지를 읽을 수 없습니다. 1,600만 화소 이하의 다른 이미지를 선택하세요.",
        );
    } finally {
      image.src = "";
      reader.current = null;
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop screenshot-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialog}
        className="dialog screenshot-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="screenshot-title"
      >
        <button
          className="dialog-close icon-button"
          aria-label="스크린샷 닫기"
          onClick={onCancel}
        >
          <X size={19} />
        </button>
        <div className="dialog-eyebrow">SCREENSHOT</div>
        <h2 id="screenshot-title">스크린샷 삽입</h2>
        <p>
          {native
            ? "캡처할 창이나 화면을 선택하세요. 삽입할 때 앱이 잠시 숨겨집니다."
            : "브라우저에서는 캡처해 둔 이미지 파일을 선택해 삽입할 수 있습니다."}
        </p>
        {loading && (
          <p className="screenshot-status" role="status">
            <LoaderCircle size={18} className="spin" /> 캡처할 창을 불러오고
            있습니다.
          </p>
        )}
        {!loading && native && sources.length === 0 && !error && (
          <p role="status">
            캡처 가능한 창이 없습니다. 창을 연 뒤 새로 고침하세요.
          </p>
        )}
        {native && sources.length > 0 && (
          <div className="screenshot-sources" aria-label="캡처할 창 선택">
            {sources.map((source) => (
              <button
                key={source.id}
                className={selected === source.id ? "selected" : ""}
                aria-pressed={selected === source.id}
                disabled={busy || loading}
                onClick={() => setSelected(source.id)}
              >
                <img src={source.thumbnail} alt="" draggable={false} />
                <span>{source.name}</span>
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="screenshot-error" role="alert">
            {error}
          </p>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          aria-label="스크린샷 이미지 파일"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void chooseFile(file);
          }}
        />
        <div className="screenshot-actions">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <ImagePlus size={16} /> 이미지 파일 선택
          </button>
          {native && (
            <button
              className="text-button"
              disabled={busy || loading}
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} /> 새로 고침
            </button>
          )}
          <div className="screenshot-action-spacer" />
          <button className="button" onClick={onCancel}>
            취소
          </button>
          {native && (
            <button
              className="button primary"
              disabled={!selected || busy || loading}
              onClick={() => void capture()}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Camera size={16} />
              )}{" "}
              {busy ? "캡처 중" : "삽입"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
