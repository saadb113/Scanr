import { useEffect, useRef } from 'react';
import { drawCell, drawPlaceholder } from './cellCanvas';

// Grid-mode coin tile — canvas mini chart + watchlist star + drag handle.
// Ported from makeCell()/drawCell() in public/js/app.js.
export default function CoinCell({
  sym, data, cellSize, colors, visibility, priceType, tfLabel, starred, resizeTick,
  onOpen, onToggleWatchlist, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  dragState,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (data) drawCell(c, data, sym, { cellSize, colors, visibility, priceType, tfLabel });
    else drawPlaceholder(c, sym, cellSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, cellSize, colors, visibility, priceType, tfLabel, resizeTick]);

  const isDragSrc = dragState?.src === sym;
  const isDragOver = dragState?.over === sym;

  return (
    <div
      className={`cell${isDragSrc ? ' is-dragging' : ''}${isDragOver ? ' drag-over' : ''}${starred ? ' in-watchlist' : ''}`}
      data-symbol={sym}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sym); onDragStart(sym); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(sym); }}
      onDragLeave={() => onDragLeave(sym)}
      onDrop={(e) => { e.preventDefault(); onDrop(sym); }}
      onDragEnd={onDragEnd}
      onClick={(e) => { if (!e.target.closest('.drag-handle') && !e.target.closest('.wl-star')) onOpen(sym); }}
    >
      <div className="drag-handle">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
          <circle cx="3.5" cy="2" r="1.1" /><circle cx="8.5" cy="2" r="1.1" />
          <circle cx="3.5" cy="6" r="1.1" /><circle cx="8.5" cy="6" r="1.1" />
          <circle cx="3.5" cy="10" r="1.1" /><circle cx="8.5" cy="10" r="1.1" />
        </svg>
      </div>
      <canvas ref={canvasRef} data-symbol={sym} />
      <button
        type="button"
        className={`wl-star${starred ? ' starred' : ''}`}
        title={starred ? 'Remove from Watchlist' : 'Add to Watchlist'}
        onClick={(e) => { e.stopPropagation(); onToggleWatchlist(sym); }}
      >★</button>
    </div>
  );
}
