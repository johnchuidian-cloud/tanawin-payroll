// Builds the download zip in either format, entirely client-side.
// PDF renders via @react-pdf; PNG captures the on-screen preview cards
// (which are the pixel-faithful replica of the legacy payslip).
import JSZip from 'jszip';
import { payslipFilename, zipFilename } from './format';
import type { Payslip, SheetDate } from './types';

export type ExportFormat = 'pdf' | 'png';

export interface ZipResult {
  blob: Blob;
  filename: string;
}

export async function buildPayslipZip(opts: {
  format: ExportFormat;
  payslips: Payslip[];
  periodStart: SheetDate | null;
  periodEnd: SheetDate | null;
  disbursement: SheetDate | null;
  // PNG mode captures these rendered preview nodes.
  getNode?: (slip: Payslip) => HTMLElement | null;
  onProgress?: (done: number, total: number) => void;
}): Promise<ZipResult> {
  const { format, payslips, periodStart, periodEnd, disbursement, getNode, onProgress } = opts;
  const zip = new JSZip();
  const entries: { filename: string; email: string }[] = [];

  for (let i = 0; i < payslips.length; i++) {
    const slip = payslips[i];
    const base = payslipFilename(slip.family, slip.given, disbursement).replace(/\.pdf$/, '');
    let filename: string;
    if (format === 'pdf') {
      const { payslipPdfBlob } = await import('./pdf');
      filename = `${base}.pdf`;
      zip.file(filename, await payslipPdfBlob(slip, periodStart, periodEnd));
    } else {
      const node = getNode?.(slip);
      if (!node) throw new Error(`Preview for ${slip.family} is not on screen — cannot capture PNG.`);
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: '#ffffff' });
      if (!blob) throw new Error(`PNG capture failed for ${slip.family}.`);
      filename = `${base}.png`;
      zip.file(filename, blob);
    }
    entries.push({ filename, email: slip.email });
    onProgress?.(i + 1, payslips.length);
  }

  // Pairing list so Lexi can copy-paste addresses without opening the workbook.
  const pad = Math.max(...entries.map((e) => e.filename.length)) + 3;
  const emailList = entries
    .map((e) => `${e.filename.padEnd(pad)}→  ${e.email}`)
    .join('\n');
  zip.file('_email-list.txt', emailList + '\n');

  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, filename: zipFilename(disbursement) };
}
