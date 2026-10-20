import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { Deck, ElementLink, Slide, SlideElement } from "./types";
import { element, newSlide, slideTitle } from "./model";
import { stillImageSource } from "./gif-preview";
import { bytesDataUrl, EMPTY_POSTER } from "./video";
import {
  todayText,
  validateElementLink,
  type FooterOptions,
} from "./insert-fields";
import "./insert-extras.css";

function Dialog({
  title,
  children,
  onCancel,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLElement>("input, select, textarea, button")
      ?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={ref}
        className={`dialog insert-extras-dialog ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) {
            if (e.key === "Escape") e.stopPropagation();
            return;
          }
          if (e.key !== "Tab") return;
          const controls = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
            ),
          );
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
          if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <button
          className="dialog-close icon-button"
          aria-label="대화상자 닫기"
          onClick={onCancel}
        >
          <X size={19} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function LinkDialog({
  deck,
  selected,
  onApply,
  onCancel,
}: {
  deck: Deck;
  selected?: SlideElement;
  onApply: (link: ElementLink | undefined, label: string) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState(
    selected?.hyperlink?.slideId ? "slide" : "web",
  );
  const [url, setUrl] = useState(selected?.hyperlink?.url || "https://");
  const [slideId, setSlideId] = useState(
    selected?.hyperlink?.slideId || deck.slides[0].id,
  );
  const [label, setLabel] = useState(selected?.text || "링크 열기");
  const [error, setError] = useState("");
  return (
    <Dialog title="링크 삽입" onCancel={onCancel}>
      <p>
        {selected
          ? "선택한 개체에 링크를 연결합니다. 발표 중 클릭해 이동할 수 있습니다."
          : "링크가 연결된 텍스트 상자를 추가합니다."}
      </p>
      {!selected && (
        <label>
          표시할 텍스트
          <input
            aria-label="링크 표시 텍스트"
            maxLength={500}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      )}
      <label>
        연결 대상
        <select
          aria-label="링크 종류"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="web">웹 페이지</option>
          <option value="slide">이 프레젠테이션의 슬라이드</option>
        </select>
      </label>
      {kind === "web" ? (
        <label>
          웹 주소
          <input
            aria-label="웹 주소"
            type="url"
            maxLength={2048}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </label>
      ) : (
        <label>
          슬라이드
          <select
            aria-label="연결할 슬라이드"
            value={slideId}
            onChange={(e) => setSlideId(e.target.value)}
          >
            {deck.slides.map((s, i) => (
              <option key={s.id} value={s.id}>
                {i + 1}. {slideTitle(s)}
                {s.hidden ? " (숨김)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="insert-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {selected?.hyperlink && (
          <button
            className="text-button"
            onClick={() => onApply(undefined, label)}
          >
            링크 제거
          </button>
        )}
        <button className="button" onClick={onCancel}>
          취소
        </button>
        <button
          className="button primary"
          onClick={() => {
            try {
              if (!selected && !label.trim())
                throw new Error("표시할 텍스트를 입력해 주세요.");
              onApply(
                validateElementLink(kind === "web" ? { url } : { slideId }),
                label,
              );
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          적용
        </button>
      </div>
    </Dialog>
  );
}

export function FooterDialog({
  slide,
  initial,
  onApply,
  onCancel,
}: {
  slide: Slide;
  initial: "footer" | "date" | "number";
  onApply: (options: FooterOptions, all: boolean) => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<FooterOptions>(() => {
    const date = slide.elements.find(
      (el) => el.field === "date" || el.field === "fixedDate",
    );
    const footer = slide.elements.find((el) => el.field === "footer");
    return {
      date: !!date || initial === "date",
      automaticDate: date?.field !== "fixedDate",
      dateText: date?.text || todayText(),
      number:
        slide.elements.some((el) => el.field === "slideNumber") ||
        initial === "number",
      footer: !!footer || initial === "footer",
      footerText: footer?.text || "",
      skipTitle: false,
    };
  });
  const update = (patch: Partial<FooterOptions>) =>
    setOptions((o) => ({ ...o, ...patch }));
  return (
    <Dialog title="날짜 · 슬라이드 번호 · 바닥글" onCancel={onCancel}>
      <p>
        슬라이드 아래에 표시할 항목을 선택하세요. 번호는 슬라이드 순서에 따라
        갱신됩니다.
      </p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={options.date}
          onChange={(e) => update({ date: e.target.checked })}
        />
        날짜 표시
      </label>
      {options.date && (
        <div className="insert-indent">
          <label className="check-row">
            <input
              type="checkbox"
              checked={options.automaticDate}
              onChange={(e) => update({ automaticDate: e.target.checked })}
            />
            오늘 날짜로 자동 업데이트
          </label>
          <input
            aria-label="고정 날짜"
            disabled={options.automaticDate}
            value={options.automaticDate ? todayText() : options.dateText}
            maxLength={100}
            onChange={(e) => update({ dateText: e.target.value })}
          />
        </div>
      )}
      <label className="check-row">
        <input
          type="checkbox"
          checked={options.number}
          onChange={(e) => update({ number: e.target.checked })}
        />
        슬라이드 번호 표시
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={options.footer}
          onChange={(e) => update({ footer: e.target.checked })}
        />
        바닥글 표시
      </label>
      <input
        aria-label="바닥글 내용"
        disabled={!options.footer}
        value={options.footerText}
        maxLength={300}
        onChange={(e) => update({ footerText: e.target.value })}
        placeholder="회사명 · 발표 제목"
      />
      <label className="check-row">
        <input
          type="checkbox"
          checked={options.skipTitle}
          onChange={(e) => update({ skipTitle: e.target.checked })}
        />
        첫 슬라이드에는 표시하지 않음
      </label>
      <div className="footer-preview" aria-label="바닥글 미리보기">
        <span>
          {options.date
            ? options.automaticDate
              ? todayText()
              : options.dateText
            : ""}
        </span>
        <span>{options.footer ? options.footerText : ""}</span>
        <span>{options.number ? "1" : ""}</span>
      </div>
      <div className="dialog-actions">
        <button className="button" onClick={onCancel}>
          취소
        </button>
        <button className="button" onClick={() => onApply(options, false)}>
          이 슬라이드에 적용
        </button>
        <button
          className="button primary"
          onClick={() => onApply(options, true)}
        >
          모두 적용
        </button>
      </div>
    </Dialog>
  );
}

export async function readRasterImage(
  file: File,
): Promise<{ src: string; width: number; height: number }> {
  if (
    !/^image\/(png|jpeg|gif|webp)$/i.test(file.type) ||
    file.size > 12 * 1024 * 1024
  )
    throw new Error(
      "사진은 한 장당 12 MiB 이하의 PNG, JPG, GIF, WebP 파일을 선택해 주세요.",
    );
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  try {
    image.src = src;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 32_000_000
    )
      throw new Error("사진 크기는 3,200만 화소 이하여야 합니다.");
    return { src, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    image.src = "";
  }
}

export async function imageElementFromData(
  src: string,
  deck: Pick<Deck, "width" | "height">,
  alt = "스크린샷",
): Promise<SlideElement> {
  const image = new Image();
  try {
    image.src = src;
    await image.decode();
    const ratio = Math.min(
      1,
      (deck.width * 0.8) / image.naturalWidth,
      (deck.height * 0.8) / image.naturalHeight,
    );
    const width = image.naturalWidth * ratio,
      height = image.naturalHeight * ratio;
    return element("image", {
      src,
      alt,
      width,
      height,
      x: (deck.width - width) / 2,
      y: (deck.height - height) / 2,
    });
  } finally {
    image.src = "";
  }
}

export function PhotoAlbumDialog({
  deck,
  onInsert,
  onCancel,
}: {
  deck: Deck;
  onInsert: (slides: Slide[]) => void;
  onCancel: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [perSlide, setPerSlide] = useState(1);
  const [captions, setCaptions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const gifPreviews = useRef(new WeakMap<File, Promise<string>>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    const isGif = (file: File) => /^image\/gif$/i.test(file.type);
    const next = files.map((f) =>
      isGif(f) ? EMPTY_POSTER : URL.createObjectURL(f),
    );
    setUrls(next);
    files.forEach((file, index) => {
      if (!isGif(file)) return;
      let preview = gifPreviews.current.get(file);
      if (!preview) {
        preview = file
          .arrayBuffer()
          .then(
            (bytes) =>
              stillImageSource(
                bytesDataUrl(new Uint8Array(bytes), "image/gif"),
              )!,
          );
        gifPreviews.current.set(file, preview);
      }
      void preview
        .then((src) => {
          if (live)
            setUrls((urls) => urls.map((url, i) => (i === index ? src : url)));
        })
        .catch(() => {
          if (live) setError("GIF 미리보기를 읽지 못했습니다.");
        });
    });
    return () => {
      live = false;
      next.forEach((u) => {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      });
    };
  }, [files]);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      if (deck.slides.length + Math.ceil(files.length / perSlide) > 500)
        throw new Error("프레젠테이션은 최대 500장까지 만들 수 있습니다.");
      const slides: Slide[] = [];
      for (let i = 0; i < files.length; i++) {
        if (!alive.current) return;
        const picture = await readRasterImage(files[i]);
        if (i % perSlide === 0)
          slides.push(newSlide("blank", deck.theme, deck.width, deck.height));
        const columns = perSlide === 1 ? 1 : 2,
          rows = perSlide === 4 ? 2 : 1;
        const gap = deck.width * 0.025,
          margin = deck.width * 0.05;
        const boxW = (deck.width - margin * 2 - gap * (columns - 1)) / columns;
        const boxH = (deck.height - margin * 2 - gap * (rows - 1)) / rows;
        const slot = i % perSlide,
          x = margin + (slot % columns) * (boxW + gap),
          y = margin + Math.floor(slot / columns) * (boxH + gap);
        const captionH = captions ? deck.height * 0.045 : 0;
        const ratio = Math.min(
          boxW / picture.width,
          (boxH - captionH) / picture.height,
        );
        const width = picture.width * ratio,
          height = picture.height * ratio;
        slides.at(-1)!.elements.push(
          element("image", {
            src: picture.src,
            alt: files[i].name,
            x: x + (boxW - width) / 2,
            y: y + (boxH - captionH - height) / 2,
            width,
            height,
          }),
        );
        if (captions)
          slides.at(-1)!.elements.push(
            element("text", {
              text: files[i].name.replace(/\.[^.]+$/, ""),
              x,
              y: y + boxH - captionH,
              width: boxW,
              height: captionH,
              fontSize: deck.height * 0.025,
              align: "center",
            }),
          );
      }
      if (alive.current) onInsert(slides);
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Dialog title="사진 앨범" onCancel={onCancel} wide>
      <p>사진을 선택하면 현재 슬라이드 뒤에 앨범 슬라이드를 추가합니다.</p>
      <label>
        사진 선택
        <input
          aria-label="사진 앨범 파일"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp"
          disabled={busy}
          onChange={(e) => {
            const next = [...files, ...Array.from(e.target.files || [])];
            e.target.value = "";
            if (
              next.length > 20 ||
              next.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024
            ) {
              setError("사진은 20장, 합계 50 MiB까지 추가할 수 있습니다.");
              return;
            }
            if (
              next.some(
                (file) =>
                  !/^image\/(png|jpeg|gif|webp)$/i.test(file.type) ||
                  file.size > 12 * 1024 * 1024,
              )
            ) {
              setError(
                "12 MiB 이하의 PNG, JPG, GIF, WebP 사진을 선택해 주세요.",
              );
              return;
            }
            setFiles(next);
            setError("");
          }}
        />
      </label>
      <div className="album-options">
        <label>
          한 슬라이드에
          <select
            aria-label="슬라이드당 사진 수"
            value={perSlide}
            disabled={busy}
            onChange={(e) => setPerSlide(Number(e.target.value))}
          >
            <option value={1}>사진 1장</option>
            <option value={2}>사진 2장</option>
            <option value={4}>사진 4장</option>
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={captions}
            disabled={busy}
            onChange={(e) => setCaptions(e.target.checked)}
          />
          파일명을 설명으로 표시
        </label>
      </div>
      <div className="album-list">
        {files.map((f, i) => (
          <div key={`${f.name}-${i}`} className="album-item">
            <img src={urls[i]} alt="" />
            <span>
              {i + 1}. {f.name}
            </span>
            <button
              aria-label={`사진 ${i + 1} 위로`}
              disabled={!i || busy}
              onClick={() =>
                setFiles((list) => {
                  const next = [...list];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  return next;
                })
              }
            >
              <ArrowUp size={16} />
            </button>
            <button
              aria-label={`사진 ${i + 1} 아래로`}
              disabled={i === files.length - 1 || busy}
              onClick={() =>
                setFiles((list) => {
                  const next = [...list];
                  [next[i], next[i + 1]] = [next[i + 1], next[i]];
                  return next;
                })
              }
            >
              <ArrowDown size={16} />
            </button>
            <button
              aria-label={`사진 ${i + 1} 제거`}
              disabled={busy}
              onClick={() => setFiles(files.filter((_, index) => index !== i))}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="insert-error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <span>
          {files.length}장 → {Math.ceil(files.length / perSlide)}개 슬라이드
        </span>
        <button className="button" onClick={onCancel}>
          취소
        </button>
        <button
          className="button primary"
          disabled={!files.length || busy}
          onClick={() => void create()}
        >
          {busy ? "사진을 배치하는 중…" : "앨범 만들기"}
        </button>
      </div>
    </Dialog>
  );
}
