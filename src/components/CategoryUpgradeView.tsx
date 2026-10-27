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
  RotateCcw,
  Trash2,
  ShieldAlert
} from 'lucide-react';
import { Reservation, Room, MoneyGivenStatus, UserRole } from '../types';

interface CategoryUpgradeViewProps {
  reservations: Reservation[];
  rooms?: Room[];
  onToggleMoneyGiven: (reservationId: string, status: MoneyGivenStatus) => void;
  onOpenAccountsSlip: (reservation: Reservation) => void;
  onToggleShiftToCategoryA?: (reservationId: string, willShift: boolean) => void;
  onAddZaer?: (newZaer: Reservation) => boolean | void;
  onDeleteReservation?: (id: string) => void;
  userRole?: UserRole;
}

export const CategoryUpgradeView: React.FC<CategoryUpgradeViewProps> = ({
  reservations,
  rooms = [],
  onToggleMoneyGiven,
  onOpenAccountsSlip,
  onToggleShiftToCategoryA,
  onAddZaer,
  onDeleteReservation,
  userRole = 'admin',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [moneyFilter, setMoneyFilter] = useState<'ALL' | 'Yes' | 'No'>('ALL');
  const [hotelFilter, setHotelFilter] = useState<'ALL' | 'Saifee' | 'Burhani'>('ALL');

  // Deletion protection modals for B to A
  const [bToARecordToDelete, setBToARecordToDelete] = useState<Reservation | null>(null);
  const [bToABlockedNotice, setBToABlockedNotice] = useState<Reservation | null>(null);

  // Modal to add a new zaer shifting from B to A (not previously in portal)
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);

  // New Zaer (B ➔ A) Form Fields
  const [newTourId, setNewTourId] = useState('');
  const [newPaxCount, setNewPaxCount] = useState<number>(1);
  const [newArrivalDate, setNewArrivalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newDepartureDate, setNewDepartureDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [newBuilding, setNewBuilding] = useState<'Saifee' | 'Burhani'>('Saifee');
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newApplicantName, setNewApplicantName] = useState('');
  const [newItsId, setNewItsId] = useState('');
  const [newFamily, setNewFamily] = useState('1');
  const [newPhone, setNewPhone] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [formError, setFormError] = useState('');

  // Calculate nights live
  const calculatedNights = useMemo(() => {
    if (!newArrivalDate || !newDepartureDate) return 1;
    const d1 = new Date(newArrivalDate);
    const d2 = new Date(newDepartureDate);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
    const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
    return Math.max(1, diffDays);
  }, [newArrivalDate, newDepartureDate]);

  // Unique existing Tour IDs for auto-suggestion
  const existingTourIds = useMemo(() => {
    const set = new Set<string>();
    reservations.forEach((r) => {
      const t = (r.tourRefNo || r.tourId || '').trim();
      if (t) set.add(t);
    });
    return Array.from(set).sort();
  }, [reservations]);

  // Available rooms for chosen hotel
  const availableRoomsForBuilding = useMemo(() => {
    if (!rooms || rooms.length === 0) return [];
    return rooms.filter((r) => (r.building || '').toLowerCase().includes(newBuilding.toLowerCase()));
  }, [rooms, newBuilding]);

  const handleTourIdChange = (val: string) => {
    setNewTourId(val);
    const trimmed = val.trim().toLowerCase();
    const match = reservations.find((r) => (r.tourRefNo || r.tourId || '').trim().toLowerCase() === trimmed);
    if (match && match.arrivalDate) {
      setNewArrivalDate(match.arrivalDate);
      if (match.departureDate) {
        setNewDepartureDate(match.departureDate);
      }
    }
  };

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
  // All zaereen in this portal are A category; when b to A is pressed, new zair is added who is shifted from B
  const shiftRequests = useMemo(() => {
    return reservations.filter(
      (r) => r.shiftToCategoryA || r.category === 'B to A' || (r.category && r.category.toLowerCase().includes('b to a'))
    );
  }, [reservations]);

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

  const handleSubmitNewShiftZaer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTourId.trim()) {
      setFormError('Please enter a Tour ID.');
      return;
    }
    if (!newArrivalDate || !newDepartureDate) {
      setFormError('Please select arrival and departure dates.');
      return;
    }
    if (!newRoomNumber.trim()) {
      setFormError('Please select or specify the room given in.');
      return;
    }

    const createdReservation: Reservation = {
      id: `b2a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      itsId: newItsId.trim() || `B2A-${Math.floor(100000 + Math.random() * 900000)}`,
      applicantName: newApplicantName.trim() || `Zaer (Tour ${newTourId.trim()})`,
      gender: 'Male',
      age: 35,
      jamaat: 'Najaf',
      family: newFamily.trim() || '1',
      idara: 'Accommodation Office',
      tourRefNo: newTourId.trim(),
      tourId: newTourId.trim(),
      officeName: 'Faiz-e-Husaini Najaf',
      groupLeadName: newApplicantName.trim() || `Zaer (Tour ${newTourId.trim()})`,
      paxCount: Math.max(1, newPaxCount || 1),
      pax: Math.max(1, newPaxCount || 1),
      totalGuests: Math.max(1, newPaxCount || 1),
      arrivalDate: newArrivalDate,
      departureDate: newDepartureDate,
      building: newBuilding,
      roomNumber: newRoomNumber.trim(),
      category: 'B to A',
      accommodationCategory: 'Category A (Nizaam)',
      shiftToCategoryA: true,
      moneyGiven: 'No',
      paymentStatus: 'Pending',
      isUploadedToPortal: false,
      specialRequests: newNotes.trim() ? `Shift B to A: ${newNotes.trim()}` : 'Shifted from Category B to Category A',
      guestContact: newPhone.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (onAddZaer) {
      onAddZaer(createdReservation);
    } else if (onToggleShiftToCategoryA) {
      onToggleShiftToCategoryA(createdReservation.id, true);
    }

    // Reset and close
    setIsShiftModalOpen(false);
    setFormError('');
    setNewTourId('');
    setNewPaxCount(1);
    setNewApplicantName('');
    setNewItsId('');
    setNewRoomNumber('');
    setNewPhone('');
    setNewNotes('');

    // Immediately open B to A Accounts Request Slip with the 7 details
    onOpenAccountsSlip(createdReservation);
  };

  const handleInitiateDelete = (res: Reservation) => {
    if (userRole !== 'admin') {
      setBToABlockedNotice(res);
      return;
    }
    setBToARecordToDelete(res);
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
            All zaereen in this portal are Category A. When a new Zaer arrives from Category B and shifts to Category A, click below to add them and generate the official 7-detail Accounts Slip.
          </p>
        </div>

        {/* Quick Actions & Counters */}
        <div className="flex flex-wrap items-center gap-3">
          {(onAddZaer || onToggleShiftToCategoryA) && (
            <button
              onClick={() => {
                setFormError('');
                setIsShiftModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-xs transition cursor-pointer"
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

                {(onDeleteReservation || onToggleShiftToCategoryA) && (
                  <th className="py-3.5 px-2 text-center w-16">Remove</th>
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

                      {/* Remove / Revert Action (Admin Protected) */}
                      {(onDeleteReservation || onToggleShiftToCategoryA) && (
                        <td className="py-3.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleInitiateDelete(res)}
                            className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-700 transition cursor-pointer"
                            title="Delete or Revert B to A record"
                          >
                            <Trash2 className="w-4 h-4" />
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

      {/* Modal to Add New Zaer Shifting B to A */}
      {isShiftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="bg-[#124E39] text-white p-4 sm:p-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-800/80 rounded-xl">
                  <ArrowUpRight className="w-5 h-5 text-[#EBD59E]" />
                </div>
                <div>
                  <h3 className="font-bold text-base sm:text-lg">Add New Zaer (Shift B ➔ A)</h3>
                  <p className="text-xs text-[#EBD59E]/90 mt-0.5">
                    Register a new Zaer shifting from Standard (B) to Category A and generate Accounts Slip
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsShiftModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSubmitNewShiftZaer} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 text-emerald-900 leading-relaxed">
                <strong>Portal Category Note:</strong> All zaereen in this portal belong to Category A. Entering this new zaer creates their Category A accommodation booking and immediately opens the official 7-detail Accounts Request Slip.
              </div>

              {/* CORE 7 DETAILS FIELDS */}
              <div className="space-y-3.5">
                <div className="text-xs font-bold text-[#124E39] uppercase tracking-wider border-b border-stone-200 pb-1">
                  1. Official Slip Details (Required)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Tour ID */}
                  <div>
                    <label className="block font-bold text-stone-800 mb-1">
                      Tour ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      list="b2a-tour-ids"
                      placeholder="e.g. NZ-2026-TOUR-44"
                      value={newTourId}
                      onChange={(e) => handleTourIdChange(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[#124E39]"
                      required
                    />
                    <datalist id="b2a-tour-ids">
                      {existingTourIds.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                    <span className="text-[10px] text-stone-500 mt-0.5 block">
                      Type new Tour ID or pick from existing tours.
                    </span>
                  </div>

                  {/* Number of Pax */}
                  <div>
                    <label className="block font-bold text-stone-800 mb-1">
                      Number of pax <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={newPaxCount}
                      onChange={(e) => setNewPaxCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-bold focus:outline-none focus:ring-2 focus:ring-[#124E39]"
                      required
                    />
                    <span className="text-[10px] text-stone-500 mt-0.5 block">
                      Total persons shifting from B to A.
                    </span>
                  </div>

                  {/* Date of Arrival */}
                  <div>
                    <label className="block font-bold text-stone-800 mb-1">
                      Date of arrival <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={newArrivalDate}
                      onChange={(e) => setNewArrivalDate(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#124E39]"
                      required
                    />
                  </div>

                  {/* Date of Departure */}
                  <div>
                    <label className="block font-bold text-stone-800 mb-1">
                      Date of departure <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={newDepartureDate}
                      onChange={(e) => setNewDepartureDate(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#124E39]"
                      required
                    />
                  </div>
                </div>

                {/* Number of Nights Live Calculation Indicator */}
                <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-amber-950 block">Number of nights:</span>
                    <span className="text-[11px] text-amber-800">
                      Calculated automatically from arrival & departure dates.
                    </span>
                  </div>
                  <div className="text-base font-extrabold text-[#124E39] bg-white px-3 py-1 rounded-lg border border-amber-300 shadow-2xs font-mono">
                    {calculatedNights} Nights
                  </div>
                </div>

                {/* Room Given In */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                  <div>
                    <label className="block font-bold text-stone-800 mb-1">
                      Hotel / Building <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={newBuilding}
                      onChange={(e) => {
                        setNewBuilding(e.target.value as any);
                        setNewRoomNumber('');
                      }}
                      className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-semibold focus:outline-none focus:ring-2 focus:ring-[#124E39]"
                    >
                      <option value="Saifee">Saifee Hotel</option>
                      <option value="Burhani">Burhani Hotel</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-stone-800 mb-1">
                      Room given in <span className="text-red-500">*</span>
                    </label>
                    <div className="space-y-1">
                      <input
                        type="text"
                        list="available-rooms-list"
                        placeholder="Select room or type room number (e.g. 204)"
                        value={newRoomNumber}
                        onChange={(e) => setNewRoomNumber(e.target.value)}
                        className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-stone-900 font-bold focus:outline-none focus:ring-2 focus:ring-[#124E39]"
                        required
                      />
                      <datalist id="available-rooms-list">
                        {availableRoomsForBuilding.map((rm) => (
                          <option key={rm.id} value={rm.roomNumber}>
                            Room {rm.roomNumber} ({rm.capacity} beds - {rm.status})
                          </option>
                        ))}
                      </datalist>
                      <span className="text-[10px] text-stone-500 block">
                        Assigned room in {newBuilding} Hotel.
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* OPTIONAL IDENTIFICATION METADATA FOR PORTAL */}
              <div className="space-y-3 pt-2">
                <div className="text-xs font-bold text-stone-600 uppercase tracking-wider border-b border-stone-200 pb-1">
                  2. Zaer Information (Optional for Records)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-stone-700 mb-1">
                      Applicant / Head of Pax Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Murtaza Bhai (or leave blank for Tour Zaer)"
                      value={newApplicantName}
                      onChange={(e) => setNewApplicantName(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      ITS ID (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 30482910"
                      value={newItsId}
                      onChange={(e) => setNewItsId(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 text-stone-900 font-mono focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Family Number
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 1"
                      value={newFamily}
                      onChange={(e) => setNewFamily(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Phone / WhatsApp
                    </label>
                    <input
                      type="tel"
                      placeholder="+964 / +91 ..."
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Notes / Remarks
                    </label>
                    <input
                      type="text"
                      placeholder="Accounts note or request..."
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                    />
                  </div>
                </div>
              </div>

              {/* Form Actions Footer */}
              <div className="pt-3 border-t border-stone-200 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsShiftModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-stone-300 hover:bg-white text-stone-700 font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#124E39] hover:bg-[#0E3C2C] text-white font-bold transition shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-[#EBD59E]" />
                  <span>Save & Generate B ➔ A Slip</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* B to A Entry Deletion Modal */}
      {bToARecordToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-lg w-full overflow-hidden p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-amber-700">
                <AlertCircle className="w-6 h-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <div className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black bg-purple-100 text-purple-900 border border-purple-300 uppercase tracking-wide mb-1">
                  B TO A REGISTRY PROTECTED
                </div>
                <h3 className="text-base sm:text-lg font-bold text-stone-900">
                  Delete B to A Shift Entry
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBToARecordToDelete(null)}
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Prompt */}
            <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 space-y-2 shadow-xs">
              <div className="flex items-center gap-2 text-amber-950 font-black text-sm sm:text-base">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                <span>This entry is in B to A. Do you want to delete it?</span>
              </div>
              <p className="text-xs text-amber-900 leading-relaxed font-medium">
                When a pax is added in B to A, it should not be deleted at any cost until deleted by the admin. Deleting will permanently remove their B to A shift status, free up room <strong>{bToARecordToDelete.building} {bToARecordToDelete.roomNumber ? `Rm ${bToARecordToDelete.roomNumber}` : ''}</strong>, and purge their Accounts Slip record.
              </p>
            </div>

            {/* Pilgrim Summary */}
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5 text-xs space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-stone-900 text-sm">{bToARecordToDelete.applicantName}</div>
                  <div className="font-mono text-stone-500 text-[11px]">ITS ID: {bToARecordToDelete.itsId}</div>
                </div>
                <span className="font-mono text-xs font-bold text-[#124E39]">Tour: {bToARecordToDelete.tourRefNo}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-stone-600 text-[11px] pt-1">
                <div>Room: <strong className="text-stone-900">{bToARecordToDelete.building} Rm {bToARecordToDelete.roomNumber || 'Unassigned'}</strong></div>
                <div>Payment: <strong className="text-stone-900">{bToARecordToDelete.moneyGiven === 'Yes' ? 'Paid ✓' : 'Pending ✗'}</strong></div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setBToARecordToDelete(null)}
                className="px-4 py-2 rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 font-bold text-xs transition cursor-pointer"
              >
                No, Keep in B to A
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteReservation) {
                    onDeleteReservation(bToARecordToDelete.id);
                  } else if (onToggleShiftToCategoryA) {
                    onToggleShiftToCategoryA(bToARecordToDelete.id, false);
                  }
                  setBToARecordToDelete(null);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Yes, Delete B to A Entry</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blocked Modal for Non-Admin */}
      {bToABlockedNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-md w-full overflow-hidden p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-red-600">
                <ShieldAlert className="w-5 h-5 text-red-600" />
              </div>
              <div className="flex-1">
                <div className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-900 border border-red-300 uppercase tracking-wide mb-1">
                  ADMIN ONLY PERMISSION
                </div>
                <h3 className="text-base font-bold text-stone-900">
                  Deletion Blocked: B to A Record
                </h3>
                <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                  When a pax is added in <strong>B to A</strong>, it <strong>should not be deleted at any cost until deleted by the admin</strong>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBToABlockedNotice(null)}
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              Please switch to <strong>Admin role</strong> using your Admin PIN to authorize the deletion of B to A records.
            </div>

            <div className="flex justify-end pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setBToABlockedNotice(null)}
                className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-900 text-white font-bold text-xs transition cursor-pointer"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
