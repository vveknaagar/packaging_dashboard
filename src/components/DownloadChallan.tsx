'use client';

import { useEffect, useRef, useState } from 'react';

/** Tells the transfer page that a challan opened in its hidden frame is done. */
export const CHALLAN_DONE = 'challan-download-done';

/** A4 in millimetres, and the white margin round the challan. */
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 12;

/** Parts of the challan that should not be cut in two by a page break. */
const KEEP_WHOLE = '.slip-head, .slip-party, .slip-table thead tr, .slip-table tbody tr, .slip-table tfoot tr, .slip-value, .slip-declaration, .slip-remark, .slip-signs';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Renders the challan on this page to an A4 PDF and saves it. */
async function saveChallanPdf(fileName: string) {
  const slip = document.querySelector<HTMLElement>('.slip');
  if (!slip) throw new Error('No challan on this page');
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
  await document.fonts.ready;

  const scale = 2;
  const canvas = await html2canvas(slip, {
    scale,
    backgroundColor: '#ffffff',
    windowWidth: 1000,
    // The buttons stay off the paper; the watermark is laid on each page below.
    ignoreElements: (el) => el.classList.contains('no-print') || el.classList.contains('slip-watermark'),
  });

  // Page breaks: as many canvas pixels as fit on a page, moved up to the top of any row they would cut.
  const pxPerMm = canvas.width / (PAGE_W - 2 * MARGIN);
  const pageHeightPx = Math.floor((PAGE_H - 2 * MARGIN) * pxPerMm);
  const top = slip.getBoundingClientRect().top;
  const blocks = [...slip.querySelectorAll<HTMLElement>(KEEP_WHOLE)].map((el) => {
    const r = el.getBoundingClientRect();
    return { start: Math.round((r.top - top) * scale), end: Math.round((r.bottom - top) * scale) };
  });
  const breaks = [0];
  while (canvas.height - breaks.at(-1)! > pageHeightPx) {
    const from = breaks.at(-1)!;
    let cut = from + pageHeightPx;
    const split = blocks.find((b) => b.start > from && b.start < cut && b.end > cut);
    if (split) cut = split.start;
    breaks.push(cut);
  }
  breaks.push(canvas.height);

  const watermark = await loadImage('/slip-watermark.png').catch(() => null);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  for (let i = 0; i < breaks.length - 1; i++) {
    const h = breaks[i + 1] - breaks[i];
    const page = document.createElement('canvas');
    page.width = canvas.width;
    page.height = h;
    page.getContext('2d')!.drawImage(canvas, 0, breaks[i], canvas.width, h, 0, 0, canvas.width, h);
    if (i > 0) pdf.addPage();
    pdf.addImage(page.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, MARGIN, PAGE_W - 2 * MARGIN, h / pxPerMm);
    if (watermark) {
      const w = 140;
      const wh = (watermark.height / watermark.width) * w;
      pdf.saveGraphicsState();
      pdf.setGState(pdf.GState({ opacity: 0.07 }));
      pdf.addImage(watermark, 'PNG', (PAGE_W - w) / 2, (PAGE_H - wh) / 2, w, wh);
      pdf.restoreGraphicsState();
    }
  }
  pdf.save(fileName);
}

/**
 * "Download PDF" on the challan. When the page is opened with ?download=1 it also downloads
 * straight away and tells the page that opened it (the transfer page) when it is done.
 */
export function DownloadChallan({ fileName }: { fileName: string }) {
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const download = async () => {
    setBusy(true);
    try {
      await saveChallanPdf(fileName);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (started.current || new URLSearchParams(window.location.search).get('download') !== '1') return;
    started.current = true;
    download().then((ok) => {
      if (window.parent !== window) window.parent.postMessage({ type: CHALLAN_DONE, ok }, window.location.origin);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button type="button" className="btn btn-primary" onClick={() => void download()} disabled={busy}>
      {busy ? 'Preparing PDF…' : 'Download PDF'}
    </button>
  );
}
