"use client";

import { useId, useMemo, useState } from "react";

type Item = { label: string; count: number };

const positions = [
  [50, 48], [25, 28], [74, 27], [22, 70], [76, 69], [49, 17], [48, 82], [12, 49], [88, 49],
] as const;

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function cloudSvg(items: Item[]) {
  const max = Math.max(1, ...items.map((item) => item.count));
  const words = items.slice(0, positions.length).map((item, index) => {
    const [x, y] = positions[index];
    const size = 14 + Math.round((item.count / max) * 18);
    return `<text x="${x}%" y="${y}%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${size}" font-weight="${index < 3 ? 700 : 500}" fill="${index % 2 ? "#0e7490" : "#0c4a6e"}">${escapeXml(item.label)} (${item.count})</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-labelledby="title desc"><title id="title">Nube de temas</title><desc id="desc">Vista visual de temas confirmados. El tamaño acompaña el número de menciones, que también aparece escrito.</desc><rect width="1200" height="675" rx="32" fill="#faf8f3"/>${words}</svg>`;
}

export function QualitativeCloud({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const id = useId().replace(/:/g, "");
  const panelId = `${id}-cloud`;
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const svg = useMemo(() => cloudSvg(items), [items]);
  const max = Math.max(1, ...items.map((item) => item.count));
  if (items.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-page p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h6 className="text-sm font-semibold text-strong">Nube de temas</h6><p className="text-xs text-muted">Una vista alterna; la lista con cantidades sigue siendo la referencia.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)} className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong">{open ? "Ocultar nube" : "Ver nube"}</button>
          {open ? <button type="button" onClick={() => { const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "nube-de-temas.svg"; link.click(); URL.revokeObjectURL(url); }} className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong">Descargar imagen</button> : null}
        </div>
      </div>
      {open ? <div id={panelId} className="mt-4 overflow-hidden rounded-lg border border-line bg-white"><svg viewBox="0 0 1200 675" role="img" aria-labelledby={`${titleId} ${descriptionId}`} className="h-auto w-full"><title id={titleId}>Nube de temas</title><desc id={descriptionId}>Vista visual de temas confirmados. El tamaño acompaña el número de menciones, que también aparece escrito.</desc><rect width="1200" height="675" rx="32" fill="#faf8f3"/>{items.slice(0, positions.length).map((item, index) => { const [x, y] = positions[index]; const size = 14 + Math.round((item.count / max) * 18); return <text key={item.label} x={`${x}%`} y={`${y}%`} textAnchor="middle" dominantBaseline="middle" fontFamily="Arial, sans-serif" fontSize={size} fontWeight={index < 3 ? 700 : 500} fill={index % 2 ? "#0e7490" : "#0c4a6e"}>{item.label} ({item.count})</text>; })}</svg></div> : null}
      {open ? <ul className="sr-only">{items.map((item) => <li key={item.label}>{item.label}: {item.count} menciones</li>)}</ul> : null}
    </div>
  );
}
