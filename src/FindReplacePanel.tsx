import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { SearchOptions, SearchResults } from "./document-search";
import { MAX_SEARCH_RESULTS } from "./document-search";
import "./find-replace.css";

const PAGE_SIZE = 40;
export default function FindReplacePanel({
  query,
  replacement,
  options,
  results,
  index,
  replaceMode,
  focusVersion,
  onQuery,
  onReplacement,
  onOptions,
  onIndex,
  onMode,
  onReplace,
  onClose,
}: {
  query: string;
  replacement: string;
  options: SearchOptions;
  results: SearchResults;
  index: number;
  replaceMode: boolean;
  focusVersion: number;
  onQuery: (value: string) => void;
  onReplacement: (value: string) => void;
  onOptions: (value: SearchOptions) => void;
  onIndex: (value: number) => void;
  onMode: (value: boolean) => void;
  onReplace: (all: boolean) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { matches, truncated } = results;
  const active = matches[index];
  const page = Math.floor(index / PAGE_SIZE),
    first = page * PAGE_SIZE;
  const move = (direction: number) => {
    if (matches.length)
      onIndex((index + direction + matches.length) % matches.length);
  };
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusVersion]);
  useEffect(() => {
    document
      .getElementById(`find-result-${index}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index, query]);
  return (
    <aside
      className="find-replace-panel"
      aria-label="찾기 및 바꾸기"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) {
          event.stopPropagation();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "Enter" && event.target === input.current) {
          event.preventDefault();
          move(event.shiftKey ? -1 : 1);
        }
        if (
          !(
            (event.ctrlKey || event.metaKey) &&
            ["s", "o"].includes(event.key.toLowerCase())
          ) &&
          event.key !== "F5"
        )
          event.stopPropagation();
      }}
    >
      <div className="find-heading">
        <h3>찾기 및 바꾸기</h3>
        <button aria-label="찾기 닫기" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div className="find-fields">
        <label>
          찾을 내용
          <input
            ref={input}
            aria-label="찾을 내용"
            value={query}
            maxLength={2000}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="슬라이드 전체에서 찾기"
          />
        </label>
        <label className="find-check">
          <input
            type="checkbox"
            checked={replaceMode}
            onChange={(event) => onMode(event.target.checked)}
          />
          바꾸기
        </label>
        {replaceMode && (
          <>
            <label>
              바꿀 내용
              <input
                aria-label="바꿀 내용"
                value={replacement}
                maxLength={100000}
                onChange={(event) => onReplacement(event.target.value)}
              />
            </label>
            <div className="find-actions">
              <button
                disabled={!active?.editable || truncated}
                onClick={() => onReplace(false)}
              >
                바꾸기
              </button>
              <button
                disabled={truncated || !matches.some((match) => match.editable)}
                onClick={() => onReplace(true)}
              >
                모두 바꾸기
              </button>
            </div>
          </>
        )}
        <div className="find-options">
          {(
            [
              ["caseSensitive", "대소문자 구분"],
              ["wholeWord", "단어 단위"],
              ["includeNotes", "발표자 노트 포함"],
            ] as const
          ).map(([key, label]) => (
            <label className="find-check" key={key}>
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(event) =>
                  onOptions({ ...options, [key]: event.target.checked })
                }
              />
              {label}
            </label>
          ))}
        </div>
        <div className="find-navigation">
          <span role="status">
            {query
              ? `${matches.length ? index + 1 : 0} / ${matches.length.toLocaleString()}개${truncated ? " 이상" : ""}`
              : "찾을 내용을 입력하세요"}
          </span>
          <button
            aria-label="이전 검색 결과"
            disabled={!matches.length}
            onClick={() => move(-1)}
          >
            <ChevronUp size={17} />
          </button>
          <button
            aria-label="다음 검색 결과"
            disabled={!matches.length}
            onClick={() => move(1)}
          >
            <ChevronDown size={17} />
          </button>
        </div>
        {truncated && (
          <p className="find-notice" role="alert">
            검색 결과가 {MAX_SEARCH_RESULTS.toLocaleString()}개를 넘습니다.
            검색어를 더 구체적으로 입력해 주세요.
          </p>
        )}
        {active && !active.editable && (
          <p className="find-notice">
            잠긴 개체나 자동 필드는 바꿀 수 없습니다.
          </p>
        )}
      </div>
      <div
        className="find-results"
        role="listbox"
        aria-label="문서 검색 결과"
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            move(event.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        {matches.slice(first, first + PAGE_SIZE).map((match, i) => (
          <button
            key={match.id}
            id={`find-result-${first + i}`}
            role="option"
            aria-selected={index === first + i}
            onClick={() => onIndex(first + i)}
          >
            <small>
              슬라이드 {match.slideIndex + 1}
              {match.row !== undefined
                ? ` · 표 ${match.row + 1}행 ${match.column! + 1}열`
                : !match.elementId
                  ? " · 발표자 노트"
                  : ""}
            </small>
            <span>
              {match.before}
              <mark>{match.value}</mark>
              {match.after}
            </span>
          </button>
        ))}
        {query && !matches.length && (
          <p>
            <Search size={20} />
            일치하는 내용이 없습니다.
          </p>
        )}
      </div>
      {matches.length > PAGE_SIZE && (
        <div className="find-pagination">
          <button disabled={!page} onClick={() => onIndex(first - PAGE_SIZE)}>
            이전 목록
          </button>
          <span>
            {page + 1} / {Math.ceil(matches.length / PAGE_SIZE)}
          </span>
          <button
            disabled={first + PAGE_SIZE >= matches.length}
            onClick={() => onIndex(first + PAGE_SIZE)}
          >
            다음 목록
          </button>
        </div>
      )}
    </aside>
  );
}
