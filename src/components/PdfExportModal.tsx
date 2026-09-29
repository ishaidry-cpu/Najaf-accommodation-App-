import React, { useState } from 'react';
import { 
  FileText, 
  Download, 
  CheckSquare, 
  Filter, 
  Building2, 
  Calendar, 
  ArrowUpRight, 
  ShieldCheck,
  X
} from 'lucide-react';
import { Reservation, Room } from '../types';
import { generateAdministrativePdf, PdfExportOptions } from '../services/pdfExport';

interface PdfExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservations: Reservation[];
  rooms: Room[];
}

export const PdfExportModal: React.FC<PdfExportModalProps> = ({
  isOpen,
  onClose,
  reservations,
  rooms,
}) => {
  if (!isOpen) return null;

  const [reportType, setReportType] = useState<PdfExportOptions['reportType']>('all_reservations');
  const [tourIdFilter, setTourIdFilter] = useState('ALL');
  const [buildingFilter, setBuildingFilter] = useState('ALL');
  const [includeSignatures, setIncludeSignatures] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  const uniqueTourIds = Array.from(new Set(reservations.map((r) => r.tourId)));
  const uniqueBuildings = Array.from(new Set(rooms.map((r) => r.building)));

  const handleExport = () => {
    setIsGenerating(true);
    try {
      generateAdministrativePdf(reservations, rooms, {
        reportType,
        tourIdFilter,
        buildingFilter,
        includeSignatures,
      });
      setTimeout(() => {
        setIsGenerating(false);
        onClose();
      }, 600);
    } catch (e) {
      console.error('PDF export error', e);
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative text-xs">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-1 text-rose-400">
          <FileText className="w-5 h-5" />
          <h3 className="text-base font-bold text-white">
            Export Administrative PDF Documentation
          </h3>
        </div>
        <p className="text-slate-400 mb-5">
          Generate formal PDF reports for front-desk records, supervisory boards, financial audits, and security desk manifests.
        </p>

        <div className="space-y-4">
          {/* Option: Report Template Type */}
          <div>
            <label className="block text-slate-300 font-bold mb-2">
              Select Report Type
            </label>
            <div className="grid grid-cols-1 gap-2.5">
              {/* Option 1 */}
              <label
                onClick={() => setReportType('all_reservations')}
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                  reportType === 'all_reservations'
                    ? 'bg-amber-950/30 border-amber-500 text-amber-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="reportType"
                  checked={reportType === 'all_reservations'}
                  onChange={() => setReportType('all_reservations')}
                  className="mt-0.5 text-amber-500"
                />
                <div>
                  <div className="font-bold text-white text-xs">
                    Comprehensive Accommodation & Rooming Manifest
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Full roster with Tour IDs, arrival/departure date & times, assigned rooms & buildings, Zaereen counts, and payment balances.
                  </div>
                </div>
              </label>

              {/* Option 2 */}
              <label
                onClick={() => setReportType('category_upgrades')}
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                  reportType === 'category_upgrades'
                    ? 'bg-amber-950/30 border-amber-500 text-amber-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="reportType"
                  checked={reportType === 'category_upgrades'}
                  onChange={() => setReportType('category_upgrades')}
                  className="mt-0.5 text-amber-500"
                />
                <div>
                  <div className="font-bold text-amber-400 text-xs flex items-center gap-1">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    <span>Category B ➔ A (Nizaam) Financial Settlement Audit</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Dedicated ledger of guests upgrading from standard to Nizaam, surcharge fees, payments received, and outstanding balance breakdown.
                  </div>
                </div>
              </label>

              {/* Option 3 */}
              <label
                onClick={() => setReportType('rooms_inventory')}
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                  reportType === 'rooms_inventory'
                    ? 'bg-amber-950/30 border-amber-500 text-amber-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="reportType"
                  checked={reportType === 'rooms_inventory'}
                  onChange={() => setReportType('rooms_inventory')}
                  className="mt-0.5 text-amber-500"
                />
                <div>
                  <div className="font-bold text-white text-xs">
                    Room Inventory, Availability & Blocked Rooms Audit
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Complete listing of all rooms by building, highlighted blocked rooms with reasons and expected reopening dates.
                  </div>
                </div>
              </label>

              {/* Option 4 */}
              <label
                onClick={() => setReportType('tour_manifest')}
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                  reportType === 'tour_manifest'
                    ? 'bg-amber-950/30 border-amber-500 text-amber-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="reportType"
                  checked={reportType === 'tour_manifest'}
                  onChange={() => setReportType('tour_manifest')}
                  className="mt-0.5 text-amber-500"
                />
                <div>
                  <div className="font-bold text-white text-xs">
                    Tour ID Specific Lodging Manifest
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Filter by a single Tour group ID for bus coordinators and tour guides.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Filters Row */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">
                Filter Tour ID
              </label>
              <select
                value={tourIdFilter}
                onChange={(e) => setTourIdFilter(e.target.value)}
                className="w-full bg-slate-900 text-white px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs focus:outline-none"
              >
                <option value="ALL">All Tours</option>
                {uniqueTourIds.map((tid) => (
                  <option key={tid} value={tid}>
                    {tid}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 font-semibold mb-1">
                Filter Building
              </label>
              <select
                value={buildingFilter}
                onChange={(e) => setBuildingFilter(e.target.value)}
                className="w-full bg-slate-900 text-white px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs focus:outline-none"
              >
                <option value="ALL">All Buildings</option>
                {uniqueBuildings.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Signature Box Checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="sigCheck"
              checked={includeSignatures}
              onChange={(e) => setIncludeSignatures(e.target.checked)}
              className="w-4 h-4 text-amber-500 rounded border-slate-700"
            />
            <label htmlFor="sigCheck" className="text-slate-300 text-xs cursor-pointer">
              Include Official Administrative Signatures & Stamp block
            </label>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-5 mt-5 border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isGenerating}
            className="px-5 py-2 bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white rounded-xl font-bold flex items-center gap-2 transition shadow-lg shadow-amber-900/30 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>{isGenerating ? 'Generating PDF...' : 'Download Administrative PDF'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
