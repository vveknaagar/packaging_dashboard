'use client';

/** Opens the browser's print dialog, where the delivery challan can be printed or saved as a PDF. */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
