import React, { useState, useMemo } from 'react';
import { 
  ArrowUpRight, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  Printer, 
  Download, 
  Building2, 
  Users, 
  Filter, 
  DollarSign, 
  Receipt, 
  Clock, 
  Sparkles, 
  Check, 
  X, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown,
  Plus,
  RotateCcw
} from 'lucide-react';
import { Reservation, MoneyGivenStatus } from '../types';

interface CategoryUpgradeViewProps {
  reservations: Reservation[];
  onToggleMoneyGiven: (reservationId: string, status: MoneyGivenStatus) => void;
  onOpenAccountsSlip: (reservation: Reservation) => void;
  onToggleShiftToCategoryA?: (reservationId: string, willShift: boolean) => void;
}

export const CategoryUpgradeView: React.FC<CategoryUpgradeViewProps> = ({
  reservations,
  onToggleMoneyGiven,
  onOpenAccountsSlip,
  onToggleShiftToCategoryA,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [moneyFilter, setMoneyFilter] = useState<'ALL' | 'Yes' | 'No'>('ALL');
  const [hotelFilter, setHotelFilter] = useState<'ALL' | 'Saifee' | 'Burhani'>('ALL');

  // Modal to shift a zaer from B to A
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [shiftSearchQuery, setShiftSearchQuery] = useState('');

  // Sorting
  const [sortColumn, setSortColumn] = useState<string>('itsId');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Filter only B to A accommodation shift requests
  const shiftRequests = useMemo(() => {
    return reservations.filter(
      (r) => r.shiftToCategoryA || r.accommodationCategory === 'Category A (Nizaam)'
    );
  }, [reservations]);

  // Zaereen eligible to shift (currently on Standard B)
  const eligibleZaereen = useMemo(() => {
    return reservations.filter(
      (r) => !r.shiftToCategoryA && r.accommodationCategory !== 'Category A (Nizaam)'
    );
  }, [reservations]);

  const filteredEligibleZaereen = useMemo(() => {
    if (!shiftSearchQuery.trim()) return eligibleZaereen.slice(0, 15);
    const q = shiftSearchQuery.toLowerCase();
    return eligibleZaereen.filter(
      (r) =>
        r.applicantName.toLowerCase().includes(q) ||
        r.itsId.toLowerCase().includes(q) ||
        r.family.toLowerCase().includes(q) ||
        r.tourRefNo.toLowerCase().includes(q)
    );
  }, [eligibleZaereen, shiftSearchQuery]);

  const filteredAndSortedRequests = useMemo(() => {
    const filtered = shiftRequests.filter((r) => {
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          (r.applicantName && r.applicantName.toLowerCase().includes(q)) ||
          (r.itsId && r.itsId.toLowerCase().includes(q)) ||
          (r.jamaat && r.jamaat.toLowerCase().includes(q)) ||
          (r.category && r.category.toLowerCase().includes(q)) ||
          (r.idara && r.idara.toLowerCase().includes(q)) ||
          (r.family && r.family.toLowerCase().includes(q)) ||
          (r.tourRefNo && r.tourRefNo.toLowerCase().includes(q)) ||
          (r.officeName && r.officeName.toLowerCase().includes(q));
        if (!match) return false;
      }

      if (moneyFilter !== 'ALL' && r.moneyGiven !== moneyFilter) return false;
      if (hotelFilter !== 'ALL' && r.building !== hotelFilter) return false;

      return true;
    });

    filtered.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      switch (sortColumn) {
        case 'itsId':
          valA = parseInt(a.itsId, 10) || 0;
          valB = parseInt(b.itsId, 10) || 0;
          break;
        case 'applicantName':
          valA = (a.applicantName || '').toLowerCase();
          valB = (b.applicantName || '').toLowerCase();
          break;
        case 'category':
          valA = (a.category || '').toLowerCase();
          valB = (b.category || '').toLowerCase();
          break;
        case 'family':
          return sortDirection === 'asc'
            ? (a.family || '').localeCompare(b.family || '', undefined, { numeric: true, sensitivity: 'base' })
            : (b.family || '').localeCompare(a.family || '', undefined, { numeric: true, sensitivity: 'base' });
        case 'tourRefNo':
          return sortDirection === 'asc'
            ? (a.tourRefNo || '').localeCompare(b.tourRefNo || '', undefined, { numeric: true, sensitivity: 'base' })
            : (b.tourRefNo || '').localeCompare(a.tourRefNo || '', undefined, { numeric: true, sensitivity: 'base' });
        case 'moneyGiven':
          valA = a.moneyGiven || 'No';
          valB = b.moneyGiven || 'No';
          break;
        case 'building':
          valA = (a.building || '').toLowerCase();
          valB = (b.building || '').toLowerCase();
          break;
        default:
          valA = a.id;
          valB = b.id;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [shiftRequests, searchTerm, moneyFilter, hotelFilter, sortColumn, sortDirection]);

  const totalShifts = shiftRequests.length;
  const moneyGivenCount = shiftRequests.filter((r) => r.moneyGiven === 'Yes').length;
  const moneyPendingCount = shiftRequests.filter((r) => r.moneyGiven === 'No').length;

  const renderSortIndicator = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-emerald-200/50 inline ml-1 opacity-40 hover:opacity-100" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-[#EBD59E] inline ml-1 font-bold" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-[#EBD59E] inline ml-1 font-bold" />
    );
  };

  const handleExecuteShift = (reservationId: string) => {
    if (onToggleShiftToCategoryA) {
      onToggleShiftToCategoryA(reservationId, true);
    }
    setIsShiftModalOpen(false);
    setShiftSearchQuery('');
  };

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#124E39]" />
            <h2 className="text-lg font-bold text-[#124E39] tracking-tight">
              Accommodation B ➔ A Shift Requests & Accounts Slips
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold">
              {totalShifts} Total Shift Requests
            </span>
          </div>
          <p className="text-xs text-stone-600 mt-1 max-w-2xl">
            When a Zair requests to shift accommodation from Standard (B) to Nizaam (A), an official request slip is generated for the Accounts Department. Accounts collects the money and marks whether money was given.
          </p>
        </div>

        {/* Quick Actions & Counters */}
        <div className="flex flex-wrap items-center gap-3">
          {onToggleShiftToCategoryA && (
            <button
              onClick={() => setIsShiftModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-xs transition"
            >
              <Plus className="w-4 h-4 text-[#EBD59E]" />
              <span>Shift New Zaer (B ➔ A)</span>
            </button>
          )}

          <div className="bg-emerald-50 border border-emerald-200 px-3.5 py-2 rounded-xl text-center">
            <span className="text-[10px] uppercase font-bold text-emerald-800 block">Money Given: Yes</span>
            <span className="text-lg font-extrabold text-emerald-950">{moneyGivenCount}</span>
          </div>
          <div className="bg-amber-50 border border-amber-200 px-3.5 py-2 rounded-xl text-center">
            <span className="text-[10px] uppercase font-bold text-amber-800 block">Pending Accounts: No</span>
            <span className="text-lg font-extrabold text-amber-950">{moneyPendingCount}</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-[#E6DFD5] rounded-xl p-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
            <input
              type="text"
              placeholder="Search by ITS ID, Applicant Name, Family, Tour Ref..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg pl-9 pr-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-emerald-700"
            />
          </div>

          <select
            value={moneyFilter}
            onChange={(e) => setMoneyFilter(e.target.value as any)}
            className="bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-stone-800"
          >
            <option value="ALL">All Payment States</option>
            <option value="Yes">Money Given: Yes (Received)</option>
            <option value="No">Money Given: No (Pending)</option>
          </select>

          <select
            value={hotelFilter}
            onChange={(e) => setHotelFilter(e.target.value as any)}
            className="bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-stone-800"
          >
            <option value="ALL">All Hotels</option>
            <option value="Saifee">Saifee Hotel</option>
            <option value="Burhani">Burhani Hotel</option>
          </select>
        </div>
      </div>

      {/* Requests Table (Fonts bigger, wrap text, complete tour id visible, interactive sort) */}
      <div className="bg-white border border-[#E6DFD5] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm md:text-base border-collapse">
            <thead className="bg-[#124E39] text-white uppercase text-xs tracking-wider font-bold select-none">
              <tr>
                <th
                  onClick={() => handleSort('itsId')}
                  className="py-3.5 px-3 cursor-pointer hover:bg-[#0E3C2C] transition min-w-[120px]"
                >
                  <div className="flex items-center">
                    <span>ITS ID</span>
                    {renderSortIndicator('itsId')}
                  </div>
                </th>

                <th
                  onClick={() => handleSort('applicantName')}
                  className="py-3.5 px-3.5 cursor-pointer hover:bg-[#0E3C2C] transition min-w-[190px]"
                >
                  <div className="flex items-center">
                    <span>Applicant Name</span>
                    {renderSortIndicator('applicantName')}
                  </div>
                </th>

                <th className="py-3.5 px-2 text-center min-w-[65px]">Age / Sex</th>

                <th
                  onClick={() => handleSort('category')}
                  className="py-3.5 px-3 cursor-pointer hover:bg-[#0E3C2C] transition min-w-[130px]"
                >
                  <div className="flex items-center">
                    <span>Category</span>
                    {renderSortIndicator('category')}
                  </div>
                </th>

                <th 
                  onClick={() => handleSort('family')}
                  className="py-3.5 px-3 cursor-pointer hover:bg-[#0E3C2C] transition min-w-[90px]"
                >
                  <div className="flex items-center">
                    <span>Family</span>
                    {renderSortIndicator('family')}
                  </div>
                </th>

                {/* Complete Tour ID Visible, Bigger font, wrap text */}
                <th
                  onClick={() => handleSort('tourRefNo')}
                  className="py-3.5 px-3.5 cursor-pointer hover:bg-[#0E3C2C] transition min-w-[230px] max-w-[320px]"
                >
                  <div className="flex items-center">
                    <span>Tour Reference No.</span>
                    {renderSortIndicator('tourRefNo')}
                  </div>
                </th>

                <th className="py-3.5 px-3.5 min-w-[180px]">Office Name</th>
                <th className="py-3.5 px-3 min-w-[130px]">Stay Dates</th>
                <th 
                  onClick={() => handleSort('building')}
                  className="py-3.5 px-3 cursor-pointer hover:bg-[#0E3C2C] transition min-w-[140px]"
                >
                  <div className="flex items-center">
                    <span>Hotel & Room</span>
                    {renderSortIndicator('building')}
                  </div>
                </th>

                <th
                  onClick={() => handleSort('moneyGiven')}
                  className="py-3.5 px-3 text-center bg-[#0E3C2C] cursor-pointer hover:bg-[#08281D] transition min-w-[140px]"
                >
                  <div className="flex items-center justify-center">
                    <span>Money Given</span>
                    {renderSortIndicator('moneyGiven')}
                  </div>
                </th>

                <th className="py-3.5 px-3 text-center min-w-[130px]">Accounts Slip</th>

                {onToggleShiftToCategoryA && (
                  <th className="py-3.5 px-2 text-center w-16">Revert</th>
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-stone-100 text-stone-900 text-sm md:text-base">
              {filteredAndSortedRequests.length > 0 ? (
                filteredAndSortedRequests.map((res) => {
                  const isPaid = res.moneyGiven === 'Yes';
                  return (
                    <tr key={res.id} className="hover:bg-[#FAF7F2] transition">
                      <td className="py-3.5 px-3 font-mono font-bold text-stone-950 text-sm md:text-base">
                        {res.itsId}
                      </td>

                      <td className="py-3.5 px-3.5 whitespace-normal break-words font-bold text-stone-950 text-sm md:text-base">
                        <div>{res.applicantName}</div>
                        {res.jamaat && (
                          <div className="text-xs text-stone-500 font-normal">{res.jamaat}</div>
                        )}
                      </td>

                      <td className="py-3.5 px-2 text-center text-stone-700 font-semibold text-xs md:text-sm">
                        {res.age} / {res.gender === 'Female' ? 'F' : 'M'}
                      </td>

                      {/* Pilgrim Category: Mumineen, Muntasbeen, Qasreali, Baitezainy */}
                      <td className="py-3.5 px-3">
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-950 border border-emerald-300">
                          {res.category || 'Mumineen'}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 font-mono font-extrabold text-emerald-900 text-sm md:text-base">
                        {res.family}
                      </td>

                      {/* Complete Tour ID Visible, wrap text, font bold */}
                      <td className="py-3.5 px-3.5 whitespace-normal break-words break-all font-mono font-bold text-stone-950 text-sm md:text-base min-w-[230px] max-w-[320px] leading-relaxed">
                        {res.tourRefNo}
                      </td>

                      <td className="py-3.5 px-3.5 whitespace-normal break-words text-stone-700 text-xs md:text-sm font-medium min-w-[180px]">
                        {res.officeName}
                      </td>

                      <td className="py-3.5 px-3 text-stone-800 text-xs md:text-sm font-medium">
                        <div>{res.arrivalDate}</div>
                        <div className="text-[11px] text-stone-500">to {res.departureDate}</div>
                      </td>

                      <td className="py-3.5 px-3">
                        <span className="font-bold text-[#124E39] text-xs md:text-sm">
                          {res.building} {res.roomNumber ? `Rm ${res.roomNumber}` : '(Unassigned)'}
                        </span>
                        <div className="text-[10px] text-amber-800 font-bold mt-0.5">
                          Shifted to Nizaam (A)
                        </div>
                      </td>

                      {/* Money Given Toggle */}
                      <td className="py-3.5 px-3 text-center bg-stone-50/60">
                        <button
                          type="button"
                          onClick={() => onToggleMoneyGiven(res.id, isPaid ? 'No' : 'Yes')}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs md:text-sm font-bold transition shadow-2xs ${
                            isPaid
                              ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                              : 'bg-amber-600 hover:bg-amber-700 text-white'
                          }`}
                          title="Click to toggle Money Given status for accounts"
                        >
                          {isPaid ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#EBD59E]" />
                              <span>Yes (Received)</span>
                            </>
                          ) : (
                            <>
                              <Clock className="w-3.5 h-3.5" />
                              <span>No (Pending)</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* Print / View Slip Button */}
                      <td className="py-3.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => onOpenAccountsSlip(res)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs md:text-sm font-bold bg-[#FAF7F2] hover:bg-stone-200/80 text-[#124E39] border border-[#124E39]/30 transition shadow-2xs"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Request Slip</span>
                        </button>
                      </td>

                      {/* Revert Action */}
                      {onToggleShiftToCategoryA && (
                        <td className="py-3.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => onToggleShiftToCategoryA(res.id, false)}
                            className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-700 transition"
                            title="Revert back to Standard B accommodation"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-stone-400 text-sm italic">
                    No accommodation B ➔ A shift requests found. Click "Shift New Zaer (B ➔ A)" above to create an accommodation upgrade request for accounts.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal to Shift a Zaer */}
      {isShiftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-3xl shadow-2xl max-w-xl w-full overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-[#124E39] text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5 text-[#EBD59E]" />
                <h3 className="font-bold text-base">Select Zaer to Shift (Standard B ➔ Nizaam A)</h3>
              </div>
              <button
                onClick={() => setIsShiftModalOpen(false)}
                className="p-1 rounded-full hover:bg-white/10 text-white/80 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <p className="text-xs text-stone-600">
                Search zaereen currently accommodated in Standard (B) and request a shift to Category A (Nizaam). This creates an Accounts Request Slip for money collection.
              </p>

              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search by ITS ID, Applicant Name, Family..."
                  value={shiftSearchQuery}
                  onChange={(e) => setShiftSearchQuery(e.target.value)}
                  className="w-full bg-white border border-stone-300 rounded-xl pl-9 pr-3 py-2 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#124E39]"
                />
              </div>

              <div className="divide-y divide-stone-200 border border-stone-200 rounded-xl bg-white max-h-72 overflow-y-auto">
                {filteredEligibleZaereen.length > 0 ? (
                  filteredEligibleZaereen.map((z) => (
                    <div
                      key={z.id}
                      className="p-3 hover:bg-[#FAF7F2] flex items-center justify-between gap-3 transition"
                    >
                      <div>
                        <div className="font-bold text-stone-900 text-sm">{z.applicantName}</div>
                        <div className="text-xs text-stone-500 font-mono">
                          ITS: {z.itsId} • Family: {z.family} • Tour: {z.tourRefNo}
                        </div>
                        <div className="text-[11px] text-emerald-800 font-semibold mt-0.5">
                          Category: {z.category} • Hotel: {z.building} {z.roomNumber ? `Rm ${z.roomNumber}` : '(Unassigned)'}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleExecuteShift(z.id)}
                        className="px-3 py-1.5 rounded-lg bg-[#124E39] hover:bg-[#0E3C2C] text-white text-xs font-bold transition flex items-center gap-1 shrink-0 shadow-2xs"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5 text-[#EBD59E]" />
                        <span>Shift to A</span>
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-xs text-stone-400 italic">
                    No eligible zaereen found. All zaereen may already be shifted to Category A.
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-stone-100 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setIsShiftModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-stone-300 hover:bg-white text-stone-700 text-xs font-bold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
