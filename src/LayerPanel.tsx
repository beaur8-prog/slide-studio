import { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  Image,
  Layers,
  LockKeyhole,
  Type,
  Square,
} from "lucide-react";
import type { SlideElement } from "./types";
import {
  flattenLayers,
  hideAllLayers,
  layerTree,
  moveLayers,
  renameLayer,
  reorderLayers,
  setLayerHidden,
  showAllLayers,
  type LayerNode,
} from "./layers";
import "./layers.css";

interface Props {
  elements: SlideElement[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  onChange: (elements: SlideElement[]) => void;
  onDelete: () => void;
  onError: (message: string) => void;
}

export function LayerPanel({
  elements,
  selected,
  onSelect,
  onChange,
  onDelete,
  onError,
}: Props) {
  const roots = useMemo(() => layerTree(elements), [elements]);
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const rows = useMemo(
    () => flattenLayers(roots, collapsed),
    [roots, collapsed],
  );
  const [rename, setRename] = useState<{ key: string; value: string } | null>(
    null,
  );
  const [drop, setDrop] = useState<{
    key: string;
    edge: "above" | "below";
  } | null>(null);
  const anchor = useRef<string | null>(null),
    focusKey = useRef<string | null>(null);
  const pointerSelecting = useRef(false),
    drag = useRef<string[] | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const chosen = (node: LayerNode) =>
    node.members.every((id) => selected.includes(id));
  const run = (fn: () => SlideElement[]) => {
    try {
      onChange(fn());
    } catch (error) {
      onError((error as Error).message);
    }
  };
  const toggle = (node: LayerNode) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(node.key)) next.delete(node.key);
      else next.add(node.key);
      return next;
    });
  const focus = (node: LayerNode) => {
    focusKey.current = node.key;
    panel.current
      ?.querySelector<HTMLElement>(`[data-layer-key="${CSS.escape(node.key)}"]`)
      ?.focus();
  };
  const select = (node: LayerNode, additive = false, range = false) => {
    let ids = node.members;
    const start = rows.findIndex((row) => row.key === anchor.current),
      end = rows.indexOf(node);
    if (range && start >= 0)
      ids = [
        ...new Set(
          rows
            .slice(Math.min(start, end), Math.max(start, end) + 1)
            .flatMap((row) => row.members),
        ),
      ];
    else anchor.current = node.key;
    onSelect(
      additive
        ? chosen(node) && !range
          ? selected.filter((id) => !ids.includes(id))
          : [...new Set([...selected, ...ids])]
        : ids,
    );
    focusKey.current = node.key;
  };
  const finishRename = () => {
    if (!rename) return;
    run(() => renameLayer(elements, rename.key, rename.value));
    setRename(null);
  };
  const startRename = (node: LayerNode) =>
    setRename({ key: node.key, value: node.name });
  const selectedCount = selected.filter((id) =>
    elements.some((element) => element.id === id),
  ).length;
  const tabKey = rows.some((row) => row.key === focusKey.current)
    ? focusKey.current
    : (rows.find(chosen)?.key ?? rows[0]?.key);
  return (
    <div className="layer-panel" ref={panel} aria-label="선택 창">
      <div className="layer-actions">
        <button
          onClick={() => run(() => showAllLayers(elements))}
          disabled={
            !elements.some((e) => e.hidden || e.groupHidden?.some(Boolean))
          }
        >
          모두 표시
        </button>
        <button
          onClick={() => run(() => hideAllLayers(elements))}
          disabled={!elements.length}
        >
          모두 숨기기
        </button>
        <button
          title="선택 개체 앞으로"
          aria-label="선택 개체 앞으로"
          disabled={!selectedCount}
          onClick={() => run(() => moveLayers(elements, selected, "up"))}
        >
          <ArrowUp size={15} />
        </button>
        <button
          title="선택 개체 뒤로"
          aria-label="선택 개체 뒤로"
          disabled={!selectedCount}
          onClick={() => run(() => moveLayers(elements, selected, "down"))}
        >
          <ArrowDown size={15} />
        </button>
      </div>
      <p className="layer-help">
        위쪽 개체가 앞에 표시됩니다. 두 번 클릭해 이름을 바꾸세요.
      </p>
      <div
        role="tree"
        aria-label="슬라이드 개체"
        aria-multiselectable="true"
        className="layer-tree"
        onKeyDown={(event) => {
          if (event.target instanceof HTMLInputElement) return;
          const command = event.metaKey || event.ctrlKey;
          if (command && event.key.toLowerCase() === "a") {
            event.preventDefault();
            event.stopPropagation();
            onSelect(elements.map((e) => e.id));
          }
        }}
      >
        {!rows.length && (
          <p className="layer-empty">슬라이드에 개체가 없습니다.</p>
        )}
        {rows.map((node) => {
          const Icon = node.groupId
            ? Folder
            : node.type === "text"
              ? Type
              : node.type === "image"
                ? Image
                : node.type === "shape"
                  ? Square
                  : Layers;
          const active = chosen(node);
          return (
            <div
              className={`layer-row ${active ? "chosen" : ""} ${node.hidden ? "is-hidden" : ""} ${drop?.key === node.key ? `drop-${drop.edge}` : ""}`}
              key={node.key}
              style={{ paddingLeft: Math.min(node.depth, 12) * 12 + 4 }}
            >
              <div
                role="treeitem"
                aria-level={node.depth + 1}
                aria-selected={active}
                aria-expanded={
                  node.groupId ? !collapsed.has(node.key) : undefined
                }
                aria-label={node.name}
                title={node.name}
                tabIndex={node.key === tabKey ? 0 : -1}
                data-layer-key={node.key}
                draggable={!rename && !node.locked}
                className="layer-item"
                onPointerDown={() => {
                  pointerSelecting.current = true;
                }}
                onPointerUp={() => {
                  pointerSelecting.current = false;
                }}
                onPointerCancel={() => {
                  pointerSelecting.current = false;
                }}
                onFocus={() => {
                  if (!pointerSelecting.current && !active) select(node);
                }}
                onClick={(event) => {
                  select(node, event.ctrlKey || event.metaKey, event.shiftKey);
                  focus(node);
                }}
                onDoubleClick={() => startRename(node)}
                onKeyDown={(event) => {
                  if (
                    event.target instanceof HTMLInputElement ||
                    event.isPropagationStopped()
                  )
                    return;
                  const index = rows.indexOf(node);
                  if (
                    ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const next =
                      rows[
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? rows.length - 1
                            : Math.min(
                                rows.length - 1,
                                Math.max(
                                  0,
                                  index + (event.key === "ArrowDown" ? 1 : -1),
                                ),
                              )
                      ];
                    if (next) {
                      select(
                        next,
                        event.ctrlKey || event.metaKey,
                        event.shiftKey,
                      );
                      focus(next);
                    }
                  } else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (
                      node.groupId &&
                      (event.key === "ArrowLeft"
                        ? !collapsed.has(node.key)
                        : collapsed.has(node.key))
                    )
                      toggle(node);
                    else {
                      const next =
                        event.key === "ArrowLeft"
                          ? rows.find((row) => row.key === node.parentKey)
                          : rows[index + 1];
                      if (next) {
                        select(next);
                        focus(next);
                      }
                    }
                  } else if (event.key === "F2") {
                    event.preventDefault();
                    event.stopPropagation();
                    startRename(node);
                  } else if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    select(
                      node,
                      event.ctrlKey || event.metaKey,
                      event.shiftKey,
                    );
                  } else if (
                    event.key === "Delete" ||
                    event.key === "Backspace"
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete();
                  }
                }}
                onDragStart={(event) => {
                  if (rename || node.locked) {
                    event.preventDefault();
                    return;
                  }
                  drag.current = active ? [...selected] : [...node.members];
                  if (!active) select(node);
                  event.dataTransfer.setData(
                    "application/x-slide-studio-layers",
                    "1",
                  );
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (!drag.current) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setDrop({
                    key: node.key,
                    edge:
                      event.clientY < rect.y + rect.height / 2
                        ? "above"
                        : "below",
                  });
                }}
                onDrop={(event) => {
                  if (!drag.current) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect(),
                    edge =
                      event.clientY < rect.y + rect.height / 2
                        ? "above"
                        : "below";
                  run(() =>
                    reorderLayers(elements, drag.current!, node.key, edge),
                  );
                  drag.current = null;
                  setDrop(null);
                }}
                onDragEnd={() => {
                  drag.current = null;
                  setDrop(null);
                }}
              >
                {node.groupId ? (
                  <button
                    tabIndex={-1}
                    className="layer-expand"
                    aria-label={`${node.name} ${collapsed.has(node.key) ? "펼치기" : "접기"}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(node);
                    }}
                  >
                    {collapsed.has(node.key) ? (
                      <ChevronRight size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                  </button>
                ) : (
                  <span className="layer-indent" />
                )}
                <Icon size={13} />
                {rename?.key === node.key ? (
                  <input
                    aria-label="개체 이름"
                    autoFocus
                    maxLength={160}
                    value={rename.value}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      setRename({ key: node.key, value: event.target.value })
                    }
                    onBlur={finishRename}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") {
                        event.preventDefault();
                        finishRename();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRename(null);
                      }
                    }}
                  />
                ) : (
                  <span className="layer-name">{node.name}</span>
                )}
                {node.locked && <LockKeyhole size={11} aria-label="잠김" />}
              </div>
              <button
                className="layer-visibility"
                disabled={node.inheritedHidden}
                aria-label={`${node.name} ${node.ownHidden ? "표시" : "숨기기"}`}
                aria-pressed={!node.hidden}
                title={
                  node.inheritedHidden
                    ? "상위 그룹을 먼저 표시하세요"
                    : node.ownHidden
                      ? "표시"
                      : "숨기기"
                }
                onClick={() =>
                  run(() => setLayerHidden(elements, node.key, !node.ownHidden))
                }
              >
                {node.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          );
        })}
      </div>
      <p className="layer-status">
        {elements.length}개 개체 · {selectedCount}개 선택{" "}
        <span>Ctrl/⌘ · Shift 다중 선택</span>
      </p>
    </div>
  );
}
