import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Slide, SlideElement } from "./types";
import { isElementHidden } from "./layers";

type Status = { playing: boolean; blocked: boolean; error: boolean };
type Entry = {
  element: SlideElement;
  slideIndex: number;
  wanted: boolean;
  attempt: number;
};
const stopped: Status = { playing: false, blocked: false, error: false };
const AudioSession = createContext<{
  status: Record<string, Status>;
  toggle: (id: string) => void;
} | null>(null);
export const usePresentationAudio = () => useContext(AudioSession);

function AudioTrack({
  entry,
  paused,
  onStatus,
  onEnded,
}: {
  entry: Entry;
  paused: boolean;
  onStatus: (id: string, status: Status) => void;
  onEnded: (id: string) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null),
    state = useRef(stopped);
  const { element: e, wanted, attempt } = entry;
  const publish = (patch: Partial<Status>) => {
    state.current = { ...state.current, ...patch };
    onStatus(e.id, state.current);
  };
  useEffect(() => {
    const audio = ref.current;
    if (audio && audio.getAttribute("src") !== e.src) audio.src = e.src ?? "";
    return () => {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };
  }, [e.src]);
  useEffect(() => {
    if (ref.current) ref.current.volume = e.volume ?? 1;
  }, [e.volume]);
  useEffect(() => {
    const audio = ref.current!;
    let cancelled = false;
    if (wanted && !paused)
      void audio.play().catch((error) => {
        if (!cancelled && error?.name !== "AbortError")
          publish({ playing: false, blocked: true });
      });
    else audio.pause();
    return () => {
      cancelled = true;
      audio.pause();
    };
  }, [wanted, attempt, paused, e.src]);
  return (
    <audio
      ref={ref}
      src={e.src}
      data-audio-id={e.id}
      aria-label={e.alt || "오디오"}
      loop={e.loop === true}
      muted={e.muted === true}
      preload="metadata"
      onPlay={() => publish({ playing: true, blocked: false, error: false })}
      onPause={() => publish({ playing: false })}
      onError={() => publish({ playing: false, blocked: false, error: true })}
      onEnded={() => {
        publish({ playing: false });
        onEnded(e.id);
      }}
    />
  );
}

/** One audience-only media host survives slide changes. Editor thumbnails,
 * presenter notes and print never mount it, preventing duplicate playback. */
export function PresentationAudio({
  slide,
  index,
  paused,
  ended,
  children,
}: {
  slide: Slide;
  index: number;
  paused: boolean;
  ended: boolean;
  children: ReactNode;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [status, setStatus] = useState<Record<string, Status>>({});
  useLayoutEffect(() => {
    setEntries((previous) => {
      if (ended) return [];
      const carry = previous.filter(
        (entry) =>
          entry.element.playAcrossSlides &&
          entry.wanted &&
          index >= entry.slideIndex &&
          index < entry.slideIndex + (entry.element.audioSlideCount ?? 999),
      );
      for (const e of slide.elements.filter(
        (e) => e.type === "audio" && !isElementHidden(e),
      ))
        if (!carry.some((entry) => entry.element.id === e.id))
          carry.push({
            element: e,
            slideIndex: index,
            wanted: e.autoPlay !== false,
            attempt: 0,
          });
      return carry;
    });
  }, [slide.id, index, ended]);
  const report = useCallback(
    (id: string, next: Status) =>
      setStatus((current) => {
        const old = current[id];
        return old &&
          old.playing === next.playing &&
          old.blocked === next.blocked &&
          old.error === next.error
          ? current
          : { ...current, [id]: next };
      }),
    [],
  );
  const finish = useCallback(
    (id: string) =>
      setEntries((current) =>
        current.map((entry) =>
          entry.element.id === id ? { ...entry, wanted: false } : entry,
        ),
      ),
    [],
  );
  const toggle = useCallback(
    (id: string) =>
      setEntries((current) =>
        current.map((entry) =>
          entry.element.id === id
            ? {
                ...entry,
                wanted: !status[id]?.playing,
                attempt: entry.attempt + 1,
              }
            : entry,
        ),
      ),
    [status],
  );
  const session = useMemo(() => ({ status, toggle }), [status, toggle]);
  return (
    <AudioSession.Provider value={session}>
      <div className="presentation-audio-host" aria-hidden="true" hidden>
        {entries.map((entry) => (
          <AudioTrack
            key={entry.element.id}
            entry={entry}
            paused={paused || ended}
            onStatus={report}
            onEnded={finish}
          />
        ))}
      </div>
      {children}
    </AudioSession.Provider>
  );
}
