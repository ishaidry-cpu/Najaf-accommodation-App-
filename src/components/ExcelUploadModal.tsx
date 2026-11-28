import React, { useState, useRef } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload, X } from 'lucide-react';
import { 
  parseZaereenExcelFile, 
  downloadSampleExcelTemplate, 
  getSampleZaereenRows,
  convertRowsToReservations,
  ParsedZaerRow 
} from '../services/excelService';
import { Reservation } from '../types';
import { deduplicateForAppend } from '../utils/deduplication';
import {
  btn, btnDanger, btnSm, chip, fieldLabel, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle, panel,
} from './ui';

/** Compact buttons grow to the 40px touch size on phones. */
const tap = (cls: string) => `${cls} max-sm:h-10 max-sm:px-3.5`;

/** A parsed yyyy-mm-dd date as "28 Nov 2026" for the preview (shown only; the imported value is untouched). */
function previewDate(value: string | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface ExcelUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (importedReservations: Reservation[], mode: 'replace' | 'append') => void;
  existingCount: number;
  existingReservations?: Reservation[];
}

export const ExcelUploadModal: React.FC<ExcelUploadModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
  existingCount,
  existingReservations = [],
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedZaerRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleProcessFile = async (file: File) => {
    setSelectedFile(file);
    setErrorMsg(null);
    setIsLoading(true);
    try {
      const rows = await parseZaereenExcelFile(file);
      if (rows.length === 0) {
        setErrorMsg('No valid zaereen applicant rows were found in the uploaded sheet. You can download the sample template to compare column formats.');
      } else {
        setParsedRows(rows);
      }
    } catch (err: any) {
      console.error('Excel parse error', err);
      setErrorMsg(
        err.message ||
          'Failed to read the Excel file. Please ensure it contains zaereen data, or download our pre-formatted template.'
      );
      setParsedRows([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      handleProcessFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleProcessFile(e.target.files[0]);
    }
  };

  const handleLoadSampleData = () => {
    const samples = getSampleZaereenRows();
    setParsedRows(samples);
    setSelectedFile(new File([], 'Faiz_Husaini_Sample_Zaereen.xlsx'));
    setErrorMsg(null);
  };

  const handleConfirmImport = () => {
    if (parsedRows.length === 0) return;
    const newReservations = convertRowsToReservations(parsedRows);
    onImportSuccess(newReservations, importMode);
    onClose();
  };

  // What an append would add, once per render (the preview note and the import button both show it).
  const dedup = importMode === 'append' && parsedRows.length > 0
    ? deduplicateForAppend(existingReservations, convertRowsToReservations(parsedRows))
    : null;

  return (
    <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="excel-upload-title">
      <div className={`${modalCard} max-w-3xl`}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h3 id="excel-upload-title" className={modalTitle}>Upload zaereen Excel sheet</h3>
            <p className="mt-1 text-sm text-stone-600">
              Import the applicant list from a Faiz Husaini or ITS portal Excel sheet.
            </p>
          </div>
          <button type="button" onClick={onClose} className={modalClose} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
          {/* Columns the sheet can carry */}
          <div className={`${panel} px-3.5 py-3`}>
            <div className="text-[13px] font-medium text-stone-700">Supported columns</div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-stone-600">
              ITS Id · Applicant Name · Age · Category · Gender · Family · Tour Reference No. · Office Name · Group Lead Name · Arrival Date · Departure Date
            </p>
          </div>

          {/* Dropzone */}
          {!parsedRows.length && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed px-5 py-8 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-brand-600 bg-brand-50' : 'border-stone-300 bg-white hover:border-brand-600 hover:bg-stone-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />

              <div className="mx-auto w-11 h-11 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center">
                {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
              </div>
              <div className="mt-3 text-[15px] font-semibold text-stone-950">
                {isLoading ? 'Reading the file and detecting columns…' : 'Click to select, or drag and drop an Excel or CSV file'}
              </div>
              <p className="mt-1 text-[13px] text-stone-600">
                Supports Microsoft Excel (.xlsx, .xls), CSV and TSV spreadsheets
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadSampleExcelTemplate();
                  }}
                  className={tap(btnSm.secondary)}
                >
                  <Download className="w-3.5 h-3.5 text-stone-500" />
                  Download sample template
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLoadSampleData();
                  }}
                  className={tap(btnSm.ghost)}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Load sample data
                </button>
              </div>
            </div>
          )}

          {/* What went wrong with the file, and the two ways on */}
          {errorMsg && (
            <div role="alert" className="flex gap-2.5 rounded-xl bg-rose-50 px-3.5 py-3 text-rose-800 ring-1 ring-inset ring-rose-200">
              <AlertOctagon className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Excel file notice</div>
                <p className="mt-0.5 text-[13px] leading-relaxed break-words">{errorMsg}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={downloadSampleExcelTemplate} className={tap(btnSm.secondary)}>
                    <Download className="w-3.5 h-3.5 text-stone-500" />
                    Download working template
                  </button>
                  <button type="button" onClick={handleLoadSampleData} className={tap(btnSm.secondary)}>
                    <FileSpreadsheet className="w-3.5 h-3.5 text-stone-500" />
                    Use sample data instead
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Parsed preview */}
          {parsedRows.length > 0 && (
            <>
              <div>
                <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 mb-2">
                  <div className="min-w-0">
                    <h4 className="text-[15px] font-semibold text-stone-950">
                      Preview: <span className="tabular-nums">{parsedRows.length}</span> zaereen applicants found
                    </h4>
                    <p className="text-[13px] text-stone-600 truncate">{selectedFile?.name || 'Uploaded file'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setParsedRows([]);
                      setSelectedFile(null);
                      setErrorMsg(null);
                    }}
                    className={tap(btnSm.secondary)}
                  >
                    Choose another file
                  </button>
                </div>

                <div className="overflow-auto max-h-64 rounded-xl ring-1 ring-inset ring-stone-200">
                  <table className="w-full text-left text-[13px]">
                    <thead className="sticky top-0 bg-stone-50 text-xs text-stone-600">
                      <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-semibold [&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-stone-200">
                        <th scope="col">ITS</th>
                        <th scope="col">Applicant name</th>
                        <th scope="col">Age</th>
                        <th scope="col">Category</th>
                        <th scope="col">Family</th>
                        <th scope="col">Tour ref</th>
                        <th scope="col">Office</th>
                        <th scope="col">Arrival</th>
                        <th scope="col">Departure</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {parsedRows.slice(0, 15).map((row, i) => (
                        <tr key={i} className="hover:bg-stone-50 [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-top">
                          <td className="font-bold text-stone-950 tabular-nums whitespace-nowrap">{row.itsId}</td>
                          <td className="font-semibold text-stone-950 min-w-[10rem]">{row.applicantName}</td>
                          <td className="text-stone-700 tabular-nums">{row.age}</td>
                          <td className="whitespace-nowrap">
                            {row.category === 'B to A'
                              ? <span className={chip('wait')}>{row.category}</span>
                              : <span className="text-stone-700">{row.category}</span>}
                          </td>
                          <td className="text-stone-700 tabular-nums whitespace-nowrap">{row.family}</td>
                          <td className="text-stone-700 tabular-nums whitespace-nowrap">{row.tourRefNo}</td>
                          <td className="text-stone-700 min-w-[11rem]">{row.officeName}</td>
                          <td className="whitespace-nowrap tabular-nums">
                            <div className="text-stone-900">{previewDate(row.arrivalDate)}</div>
                            {row.arrivalTime && <div className="text-xs text-stone-500">{row.arrivalTime}</div>}
                          </td>
                          <td className="whitespace-nowrap tabular-nums">
                            <div className="text-stone-900">{previewDate(row.departureDate)}</div>
                            {row.departureTime && <div className="text-xs text-stone-500">{row.departureTime}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsedRows.length > 15 && (
                    <div className="px-3 py-2.5 text-center text-[13px] text-stone-600 bg-stone-50 border-t border-stone-200">
                      …and {parsedRows.length - 15} more zaereen applicants
                    </div>
                  )}
                </div>
              </div>

              {/* How to bring the rows in */}
              <fieldset>
                <legend className={fieldLabel}>Import method</legend>
                <div className="flex flex-col sm:flex-row gap-x-6">
                  <label className="inline-flex items-center gap-2.5 min-h-10 text-sm text-stone-900 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="append"
                      checked={importMode === 'append'}
                      onChange={() => setImportMode('append')}
                      className="w-4 h-4 accent-brand-700"
                    />
                    Append unique only (skips duplicates)
                  </label>
                  <label className="inline-flex items-center gap-2.5 min-h-10 text-sm text-stone-900 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="w-4 h-4 accent-brand-700"
                    />
                    Replace all
                  </label>
                </div>

                {/* When appending, only unique zaereen are added */}
                {dedup && (
                  <p className="mt-1.5 flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-[13px] leading-relaxed text-emerald-900 ring-1 ring-inset ring-emerald-200">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                    <span>
                      <strong className="font-semibold">{dedup.uniqueToAppend.length}</strong> unique zaereen will be added.
                      {dedup.totalDuplicatesSkipped > 0 && (
                        <span className="ml-1">
                          ({dedup.totalDuplicatesSkipped} duplicate{dedup.totalDuplicatesSkipped > 1 ? 's' : ''} skipped)
                        </span>
                      )}
                    </span>
                  </p>
                )}
                {importMode === 'replace' && (
                  <p className="mt-1.5 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                    <span>Replace all keeps everyone who already has a room, and replaces the rest of the current list (<span className="tabular-nums">{existingCount}</span> zaereen) with the <span className="tabular-nums">{parsedRows.length}</span> in this file.</span>
                  </p>
                )}
              </fieldset>
            </>
          )}
        </div>

        <div className={modalFooter}>
          <button type="button" onClick={onClose} className={btn.secondary}>Cancel</button>

          {parsedRows.length > 0 && (
            <button type="button" onClick={handleConfirmImport} className={importMode === 'replace' ? btnDanger : btn.primary}>
              <CheckCircle2 className="w-4 h-4" />
              {dedup
                ? `Append ${dedup.uniqueToAppend.length} unique zaereen`
                : `Replace with ${parsedRows.length} zaereen applicants`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
