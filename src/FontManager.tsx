import { useEffect, useMemo, useRef, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import {
  addLocalFonts,
  listLocalFonts,
  MAX_LOCAL_FONT_BYTES,
  removeLocalFont,
} from "./local-fonts";
import {
  documentFontUsage,
  diagnoseDocumentFonts,
  refreshDocumentFonts,
  type DocumentFontStatus,
} from "./document-fonts";
import type { Deck } from "./types";
import "./font-manager.css";

export default function FontManager({
  deck,
  onClose,
}: {
  deck: Deck;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [fonts, setFonts] = useState(listLocalFonts);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const usage = useMemo(() => documentFontUsage(deck), [deck]);
  const [statuses, setStatuses] = useState<DocumentFontStatus[]>([]);
  const [checking, setChecking] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setChecking(true);
    void diagnoseDocumentFonts(usage, controller.signal).then((result) => {
      if (current) {
        setStatuses(result);
        setChecking(false);
      }
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [usage, fonts, revision]);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="dialog font-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="font-manager-title"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Tab") {
            const controls = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled), input:not([hidden]):not(:disabled)",
              ),
            );
            const first = controls[0],
              last = controls.at(-1);
            if (
              (e.shiftKey && document.activeElement === first) ||
              (!e.shiftKey && document.activeElement === last)
            ) {
              e.preventDefault();
              (e.shiftKey ? last : first)?.focus();
            }
          }
          if (e.key === "Escape" && !busy) onClose();
        }}
      >
        <button
          autoFocus
          className="dialog-close"
          aria-label="글꼴 관리 닫기"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <h2 id="font-manager-title">원본 글꼴 추가</h2>
        <p>
          원본 문서에 사용된 TTF·OTF·TTC·OTC 글꼴을 추가하면 대체 글꼴 대신
          사용하여 줄바꿈 차이를 줄입니다. 일반·굵게·기울임 파일을 각각
          추가하세요.
        </p>
        <p>
          추가한 글꼴은 이 기기에 저장되어 다음 실행에도 적용됩니다. 다른
          PC에서도 사용하려면 해당 기기에 같은 글꼴을 추가해야 합니다.
        </p>
        <section
          className="document-fonts"
          aria-labelledby="document-fonts-title"
        >
          <div className="document-fonts-heading">
            <h3 id="document-fonts-title">이 문서의 사용 글꼴</h3>
            <button
              disabled={checking || busy}
              onClick={() => {
                refreshDocumentFonts();
                setRevision((value) => value + 1);
              }}
            >
              다시 확인
            </button>
          </div>
          <p>
            텍스트와 표에 사용된 글꼴 {usage.length}개입니다. 원본 글꼴이 없으면
            글자 폭·두께와 줄바꿈이 달라질 수 있습니다.
          </p>
          {checking ? (
            <p aria-live="polite">이 기기의 글꼴 확인 중…</p>
          ) : (
            <ul aria-label="문서에 사용된 글꼴" tabIndex={0}>
              {statuses.map((font) => (
                <li key={font.family.toLowerCase()}>
                  <span>
                    <strong>{font.family}</strong> · {font.slides}장
                    <small data-font-status={font.kind}>{font.label}</small>
                    {font.detail && <small>{font.detail}</small>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!usage.length && <p>아직 텍스트나 표에 사용된 글꼴이 없습니다.</p>}
          <small>
            글꼴 이름 기준의 확인입니다. 글꼴의 굵기·기울임 파일이나 일부 문자의
            대체 여부는 별도 확인이 필요합니다. 이 과정에서 글꼴을 다운로드하지
            않습니다.
          </small>
        </section>
        <input
          ref={input}
          type="file"
          accept=".ttf,.otf,.ttc,.otc"
          multiple
          hidden
          aria-label="원본 글꼴 파일"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length > 24) {
              setMessage("한 번에 24개까지 선택하세요.");
              return;
            }
            setBusy(true);
            const messages: string[] = [];
            try {
              for (const file of files) {
                try {
                  if (file.size > MAX_LOCAL_FONT_BYTES)
                    throw new Error("글꼴 파일은 64MB 이하여야 합니다.");
                  const fonts = await addLocalFonts(
                    new Uint8Array(await file.arrayBuffer()),
                  );
                  for (const font of fonts)
                    messages.push(
                      `${font.family} (${font.weight}, ${font.style}) 적용됨`,
                    );
                } catch (error) {
                  messages.push(
                    `${file.name}: ${error instanceof Error ? error.message : "글꼴 추가 실패"}`,
                  );
                }
              }
              setFonts(listLocalFonts());
              setMessage(messages.join("\n"));
            } finally {
              setBusy(false);
            }
          }}
        />
        <button
          className="primary"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Plus size={16} />
          {busy ? "글꼴 적용 중…" : "글꼴 파일 선택"}
        </button>
        <ul aria-label="추가한 글꼴">
          {fonts.map((font) => (
            <li key={font.id}>
              <span>
                {font.family} · {font.weight} ·{" "}
                {font.style === "italic" ? "기울임" : "일반"}
              </span>
              <button
                aria-label={`${font.family} ${font.weight} ${font.style} 제거`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await removeLocalFont(font.id);
                    setFonts(listLocalFonts());
                    setMessage(
                      "글꼴을 제거했습니다. 설치된 글꼴 또는 대체 글꼴로 표시합니다.",
                    );
                  } catch {
                    setMessage("글꼴을 제거하지 못했습니다. 다시 시도하세요.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
        {!fonts.length && (
          <p>
            직접 추가한 글꼴이 없습니다. 설치된 원본 글꼴은 자동으로 사용합니다.
          </p>
        )}
        <p role="status" className="font-manager-message">
          {message}
        </p>
        <small>
          글꼴 파일은 프로젝트·PPTX에 포함되거나 외부로 전송되지 않습니다. 원본
          글꼴을 사용해도 PowerPoint의 조판 방식에 따른 차이는 남을 수 있습니다.
        </small>
      </section>
    </div>
  );
}
