import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/*
 * 3-pane horizontally resizable layout used for the main app columns
 * (Transcript / Suggestions / Chat). Two drag handles between the panes
 * let the user grow or shrink any column. Widths are stored as fractions
 * (left, middle, right) summing to 1, persisted to localStorage so the
 * layout survives reloads.
 */

interface Props {
  storageKey: string;
  children: [ReactNode, ReactNode, ReactNode];
  minPaneFraction?: number;
}

const DEFAULT_FRACTIONS: [number, number, number] = [0.32, 0.29, 0.39];

function loadFractions(key: string): [number, number, number] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_FRACTIONS;
    const arr = JSON.parse(raw);
    if (
      Array.isArray(arr) &&
      arr.length === 3 &&
      arr.every((n) => typeof n === "number" && n > 0 && n < 1)
    ) {
      const sum = arr[0] + arr[1] + arr[2];
      if (Math.abs(sum - 1) < 0.05) {
        return [arr[0] / sum, arr[1] / sum, arr[2] / sum];
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_FRACTIONS;
}

export default function ResizableColumns({
  storageKey,
  children,
  minPaneFraction = 0.12,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fractions, setFractions] = useState<[number, number, number]>(() =>
    loadFractions(storageKey)
  );
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const dragStateRef = useRef<{
    idx: 0 | 1;
    startX: number;
    startFractions: [number, number, number];
    containerWidth: number;
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(fractions));
    } catch {
      /* ignore */
    }
  }, [fractions, storageKey]);

  const onMouseDown = useCallback(
    (idx: 0 | 1) => (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      dragStateRef.current = {
        idx,
        startX: e.clientX,
        startFractions: [...fractions] as [number, number, number],
        containerWidth: el.getBoundingClientRect().width,
      };
      setDraggingIdx(idx);
      document.body.classList.add("is-resizing");
    },
    [fractions]
  );

  useEffect(() => {
    if (draggingIdx === null) return;

    const onMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      const dx = e.clientX - st.startX;
      const dFrac = dx / Math.max(st.containerWidth, 1);
      const next = [...st.startFractions] as [number, number, number];
      const i = st.idx;
      const j = i + 1;
      let a = next[i] + dFrac;
      let b = next[j] - dFrac;
      if (a < minPaneFraction) {
        b -= minPaneFraction - a;
        a = minPaneFraction;
      }
      if (b < minPaneFraction) {
        a -= minPaneFraction - b;
        b = minPaneFraction;
      }
      if (a < minPaneFraction || b < minPaneFraction) return;
      next[i] = a;
      next[j] = b;
      setFractions(next);
    };

    const onUp = () => {
      dragStateRef.current = null;
      setDraggingIdx(null);
      document.body.classList.remove("is-resizing");
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingIdx, minPaneFraction]);

  const reset = useCallback(() => {
    setFractions(DEFAULT_FRACTIONS);
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 w-full gap-0 items-stretch"
    >
      <div
        className="pane-host"
        style={{ flex: `${fractions[0]} 1 0` }}
      >
        {children[0]}
      </div>
      <div
        className="col-splitter mx-1"
        data-dragging={draggingIdx === 0 ? "true" : "false"}
        onMouseDown={onMouseDown(0)}
        onDoubleClick={reset}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize transcript and suggestions columns"
        title="Drag to resize · double-click to reset"
      />
      <div
        className="pane-host"
        style={{ flex: `${fractions[1]} 1 0` }}
      >
        {children[1]}
      </div>
      <div
        className="col-splitter mx-1"
        data-dragging={draggingIdx === 1 ? "true" : "false"}
        onMouseDown={onMouseDown(1)}
        onDoubleClick={reset}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize suggestions and chat columns"
        title="Drag to resize · double-click to reset"
      />
      <div
        className="pane-host"
        style={{ flex: `${fractions[2]} 1 0` }}
      >
        {children[2]}
      </div>
    </div>
  );
}
