import React, { useState, useRef } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Users, 
  ArrowRight,
  RefreshCw,
  FileCheck,
  Sparkles
} from 'lucide-react';
import { 
  parseZaereenExcelFile, 
  downloadSampleExcelTemplate, 
  getSampleZaereenRows,
  convertRowsToReservations,
  ParsedZaerRow 
} from '../services/excelService';
import { Reservation } from '../types';
import { deduplicateForAppend } from '../utils/deduplication';

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative text-stone-800 flex flex-col max-h-[90vh]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-500 hover:text-stone-800 p-1.5 rounded-lg hover:bg-stone-200/60 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-[#124E39] text-[#EBD59E] flex items-center justify-center shadow-md">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[#124E39] tracking-tight">
              Upload Zaereen Excel Sheet
            </h3>
            <p className="text-xs text-stone-600">
              Import applicant list directly from Faiz Husaini or ITS portal Excel sheets
            </p>
          </div>
        </div>

        {/* Required Fields Info Banner */}
        <div className="my-3 p-3 rounded-xl bg-white border border-[#E6DFD5] text-xs space-y-1">
          <div className="font-semibold text-[#124E39] flex items-center gap-1.5">
            <FileCheck className="w-4 h-4 text-emerald-700" />
            <span>Supported Columns:</span>
          </div>
          <p className="text-stone-600 text-[11px] leading-relaxed">
            ITS Id • Applicant Name • Age • Category • Idara • Gender • Family • Tour Reference No. • Office Name • Group Lead Name • Arrival Date • Departure Date
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
            className={`border-2 border-dashed rounded-xl p-7 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-emerald-600 bg-emerald-50/60'
                : 'border-stone-300 hover:border-emerald-700 bg-white'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="flex flex-col items-center justify-center gap-2">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center mb-1">
                {isLoading ? (
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-700" />
                ) : (
                  <Upload className="w-6 h-6" />
                )}
              </div>

              <div className="font-semibold text-sm text-stone-800">
                {isLoading ? 'Reading file & detecting columns...' : 'Click to select or drag and drop Excel / CSV file'}
              </div>
              <p className="text-xs text-stone-500">
                Supports Microsoft Excel (.xlsx, .xls), CSV, and TSV spreadsheets
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2.5 mt-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadSampleExcelTemplate();
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-[#124E39] font-medium bg-emerald-50 hover:bg-emerald-100 border border-emerald-300/80 px-3 py-1.5 rounded-lg transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Sample Template
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLoadSampleData();
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-stone-700 font-medium bg-stone-100 hover:bg-stone-200 border border-stone-300 px-3 py-1.5 rounded-lg transition"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  Load Sample Data
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="mt-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block mb-0.5">Excel File Notice:</span>
                <span>{errorMsg}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-rose-200/60">
              <button
                type="button"
                onClick={downloadSampleExcelTemplate}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white hover:bg-stone-50 border border-rose-300 text-rose-900 text-[11px] font-semibold"
              >
                <Download className="w-3 h-3" />
                Download Working Template
              </button>
              <button
                type="button"
                onClick={handleLoadSampleData}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#124E39] hover:bg-[#0E3C2C] text-white text-[11px] font-semibold"
              >
                <Sparkles className="w-3 h-3 text-[#EBD59E]" />
                Use Sample Data Instead
              </button>
            </div>
          </div>
        )}

        {/* Parsed Preview Table */}
        {parsedRows.length > 0 && (
          <div className="flex-1 overflow-hidden flex flex-col mt-2">
            <div className="flex items-center justify-between py-2 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#124E39]">
                  Preview ({parsedRows.length} Zaereen Applicants Found)
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                  {selectedFile?.name || 'Uploaded File'}
                </span>
              </div>
              <button
                onClick={() => {
                  setParsedRows([]);
                  setSelectedFile(null);
                  setErrorMsg(null);
                }}
                className="text-xs text-stone-500 hover:text-stone-800 underline"
              >
                Choose another file
              </button>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-56 mt-2 border border-stone-200 rounded-xl bg-white shadow-inner">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-[#FAF7F2] sticky top-0 border-b border-stone-200 text-stone-700 font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="py-2 px-2.5">ITS ID</th>
                    <th className="py-2 px-2.5">Applicant Name</th>
                    <th className="py-2 px-2.5">Age</th>
                    <th className="py-2 px-2.5">Cat</th>
                    <th className="py-2 px-2.5">Family</th>
                    <th className="py-2 px-2.5">Tour Ref</th>
                    <th className="py-2 px-2.5">Office</th>
                    <th className="py-2 px-2.5">Arrival</th>
                    <th className="py-2 px-2.5">Departure</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {parsedRows.slice(0, 15).map((row, i) => (
                    <tr key={i} className="hover:bg-emerald-50/40">
                      <td className="py-1.5 px-2.5 font-mono text-stone-900 font-medium">{row.itsId}</td>
                      <td className="py-1.5 px-2.5 font-semibold text-stone-900">{row.applicantName}</td>
                      <td className="py-1.5 px-2.5 text-stone-600">{row.age}</td>
                      <td className="py-1.5 px-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            row.category === 'B to A'
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                          }`}
                        >
                          {row.category}
                        </span>
                      </td>
                      <td className="py-1.5 px-2.5 font-mono text-stone-700">{row.family}</td>
                      <td className="py-1.5 px-2.5 text-stone-700">{row.tourRefNo}</td>
                      <td className="py-1.5 px-2.5 text-stone-600">{row.officeName}</td>
                      <td className="py-1.5 px-2.5 text-stone-600">{row.arrivalDate}</td>
                      <td className="py-1.5 px-2.5 text-stone-600">{row.departureDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 15 && (
                <div className="py-2 text-center text-[11px] text-stone-500 bg-stone-50 border-t border-stone-200">
                  ...and {parsedRows.length - 15} more zaereen applicants
                </div>
              )}
            </div>

            {/* Import Mode Radio & Duplicate Prevention Indicator */}
            <div className="mt-4 p-3 bg-white border border-[#E6DFD5] rounded-xl flex flex-col gap-2.5 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="font-bold text-stone-700">Import Method:</span>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="append"
                      checked={importMode === 'append'}
                      onChange={() => setImportMode('append')}
                      className="accent-emerald-700"
                    />
                    <span className="font-semibold text-emerald-950">
                      Append unique only (skips duplicates)
                    </span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="accent-emerald-700"
                    />
                    <span className="text-amber-800 font-medium">Replace all</span>
                  </label>
                </div>
              </div>

              {/* Deduplication Status Banner (User request: "When append dont append duplicates only unique should be added") */}
              {(() => {
                if (importMode !== 'append' || parsedRows.length === 0) return null;
                const sampleRes = convertRowsToReservations(parsedRows);
                const dedup = deduplicateForAppend(existingReservations, sampleRes);
                return (
                  <div className="p-2 rounded-lg bg-emerald-50/80 border border-emerald-300 text-[11px] text-emerald-950 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>
                        <strong>Deduplication Guard:</strong> <strong>{dedup.uniqueToAppend.length}</strong> unique zaereen will be added.
                        {dedup.totalDuplicatesSkipped > 0 && (
                          <span className="text-amber-800 font-semibold ml-1">
                            ({dedup.totalDuplicatesSkipped} duplicate{dedup.totalDuplicatesSkipped > 1 ? 's' : ''} skipped)
                          </span>
                        )}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900 font-bold text-[10px]">
                      Zero Duplicates
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Modal Actions */}
        <div className="mt-5 pt-3 border-t border-stone-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 transition"
          >
            Cancel
          </button>

          {parsedRows.length > 0 && (
            <button
              type="button"
              onClick={handleConfirmImport}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-md transition"
            >
              <CheckCircle2 className="w-4 h-4 text-[#EBD59E]" />
              <span>
                {(() => {
                  if (importMode === 'append') {
                    const sampleRes = convertRowsToReservations(parsedRows);
                    const dedup = deduplicateForAppend(existingReservations, sampleRes);
                    return `Append ${dedup.uniqueToAppend.length} Unique Zaereen`;
                  }
                  return `Replace with ${parsedRows.length} Zaereen Applicants`;
                })()}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
