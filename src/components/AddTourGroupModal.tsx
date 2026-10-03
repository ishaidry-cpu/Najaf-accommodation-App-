import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  X, 
  Users, 
  Plus, 
  Trash2, 
  Calendar, 
  Clock, 
  Building2, 
  BedDouble, 
  AlertCircle, 
  CheckCircle2, 
  Copy, 
  Sparkles, 
  ArrowRight, 
  ShieldCheck, 
  UserPlus,
  Hash,
  Briefcase
} from 'lucide-react';
import { Reservation, Room, MoneyGivenStatus } from '../types';
import { normalizeItsId, normalizeText } from '../utils/deduplication';
import { getVacantRoomsForDuration } from '../services/storage';

export interface TourIndividualRow {
  id: string;
  family: string;
  itsId: string;
  applicantName: string;
  age: string;
  gender: 'Male' | 'Female';
  category: string;
  building: string;
  roomNumber: string;
  jamaat?: string;
  hofId?: string;
  moneyGiven?: MoneyGivenStatus;
}

interface AddTourGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTourBatch: (newReservations: Reservation[]) => boolean | void;
  existingReservations: Reservation[];
  rooms: Room[];
  categories: string[];
}

export const AddTourGroupModal: React.FC<AddTourGroupModalProps> = ({
  isOpen,
  onClose,
  onAddTourBatch,
  existingReservations,
  rooms,
  categories,
}) => {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const defaultDepartureStr = useMemo(
    () => new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    []
  );

  // Distinct Tour IDs for quick autofill/suggestion
  const existingTourIds = useMemo(() => {
    return Array.from(new Set(existingReservations.map((r) => (r.tourRefNo || '').trim()).filter(Boolean))).sort();
  }, [existingReservations]);

  // Distinct Office Names for suggestions
  const existingOffices = useMemo(() => {
    return Array.from(new Set(existingReservations.map((r) => (r.officeName || '').trim()).filter(Boolean))).sort();
  }, [existingReservations]);

  // Distinct Families for suggestions
  const existingFamilies = useMemo(() => {
    return Array.from(new Set(existingReservations.map((r) => (r.family || '').trim()).filter(Boolean))).sort();
  }, [existingReservations]);

  // Shared Tour Parameters (All individuals in this tour group share these)
  const [tourRefNo, setTourRefNo] = useState('');
  const [officeName, setOfficeName] = useState('Fayz E Husayni Trust Mumbai');
  const [arrivalDate, setArrivalDate] = useState(todayStr);
  const [arrivalTime, setArrivalTime] = useState('11:00 AM');
  const [departureDate, setDepartureDate] = useState(defaultDepartureStr);
  const [departureTime, setDepartureTime] = useState('01:00 AM');
  const [groupLeadName, setGroupLeadName] = useState('');
  const [defaultCategory, setDefaultCategory] = useState(categories[0] || 'Mumineen');

  // Dynamic distinct buildings list
  const distinctBuildings = useMemo(() => {
    const list = Array.from(new Set(rooms.map((r) => r.building).filter(Boolean)));
    return list.length > 0 ? list.sort() : ['Saifee', 'Burhani'];
  }, [rooms]);

  const [defaultBuilding, setDefaultBuilding] = useState<string>('Saifee');

  // Individuals Rows (Can have DIFFERENT family IDs)
  const [rows, setRows] = useState<TourIndividualRow[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  // Initial template rows
  const createNewRow = (familyVal: string = '1', buildingVal: string = defaultBuilding): TourIndividualRow => ({
    id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    family: familyVal,
    itsId: '',
    applicantName: '',
    age: '35',
    gender: 'Male',
    category: defaultCategory,
    building: buildingVal,
    roomNumber: '',
    jamaat: '',
    hofId: '',
    moneyGiven: 'No',
  });

  // Reset or initialize on open
  useEffect(() => {
    if (isOpen) {
      setTourRefNo(existingTourIds[0] || 'NKERP/TOUR/2026/101');
      setOfficeName(existingOffices[0] || 'Fayz E Husayni Trust Mumbai');
      setArrivalDate(todayStr);
      setArrivalTime('11:00 AM');
      setDepartureDate(defaultDepartureStr);
      setDepartureTime('01:00 AM');
      setGroupLeadName('');
      setDefaultCategory(categories[0] || 'Mumineen');
      setDefaultBuilding('Saifee');
      setErrorMsg('');

      // Start with 3 sample rows with different families
      setRows([
        {
          id: `row-1`,
          family: '101',
          itsId: '',
          applicantName: '',
          age: '42',
          gender: 'Male',
          category: categories[0] || 'Mumineen',
          building: 'Saifee',
          roomNumber: '',
          jamaat: '',
          hofId: '',
          moneyGiven: 'No',
        },
        {
          id: `row-2`,
          family: '101',
          itsId: '',
          applicantName: '',
          age: '38',
          gender: 'Female',
          category: categories[0] || 'Mumineen',
          building: 'Saifee',
          roomNumber: '',
          jamaat: '',
          hofId: '',
          moneyGiven: 'No',
        },
        {
          id: `row-3`,
          family: '102',
          itsId: '',
          applicantName: '',
          age: '29',
          gender: 'Male',
          category: categories[0] || 'Mumineen',
          building: 'Saifee',
          roomNumber: '',
          jamaat: '',
          hofId: '',
          moneyGiven: 'No',
        },
      ]);
    }
  }, [isOpen, existingTourIds, existingOffices, categories, todayStr, defaultDepartureStr]);

  // Autofill Tour metadata if existing Tour ID is selected
  const handleSelectTour = (tid: string) => {
    setTourRefNo(tid);
    const match = existingReservations.find((r) => r.tourRefNo === tid);
    if (match) {
      if (match.officeName) setOfficeName(match.officeName);
      if (match.groupLeadName) setGroupLeadName(match.groupLeadName);
      if (match.arrivalDate) setArrivalDate(match.arrivalDate);
      if (match.departureDate) setDepartureDate(match.departureDate);
    }
  };

  // Vacant rooms helper for any building
  const getVacantRoomsForBuilding = useCallback(
    (bldg: string) => {
      if (!arrivalDate || !departureDate) return [];
      return getVacantRoomsForDuration(bldg, arrivalDate, departureDate, rooms, existingReservations);
    },
    [arrivalDate, departureDate, rooms, existingReservations]
  );

  // Vacant rooms for Saifee and Burhani for the shared duration
  const vacantSaifeeRooms = useMemo(() => {
    return getVacantRoomsForBuilding('Saifee');
  }, [getVacantRoomsForBuilding]);

  const vacantBurhaniRooms = useMemo(() => {
    return getVacantRoomsForBuilding('Burhani');
  }, [getVacantRoomsForBuilding]);

  // Individual row field update
  const handleUpdateRow = (rowId: string, field: keyof TourIndividualRow, value: any) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const updated = { ...r, [field]: value };
        // If building changed, clear roomNumber if invalid
        if (field === 'building') {
          updated.roomNumber = '';
        }
        return updated;
      })
    );
  };

  // Add a single individual
  const handleAddIndividual = (sameFamilyAsLast: boolean = false) => {
    const lastFamily = rows.length > 0 ? rows[rows.length - 1].family : '101';
    let nextFamily = lastFamily;
    if (!sameFamilyAsLast) {
      const numMatch = lastFamily.match(/\d+/);
      if (numMatch) {
        const nextNum = parseInt(numMatch[0], 10) + 1;
        nextFamily = lastFamily.replace(/\d+/, String(nextNum));
      } else {
        nextFamily = `${lastFamily}-next`;
      }
    }
    setRows((prev) => [...prev, createNewRow(nextFamily, defaultBuilding)]);
  };

  // Add 5 individuals at once
  const handleAddMultiple = (count: number = 5) => {
    const lastFamily = rows.length > 0 ? rows[rows.length - 1].family : '100';
    let baseNum = parseInt(lastFamily.match(/\d+/)?.[0] || '100', 10);
    const newItems: TourIndividualRow[] = [];
    for (let i = 1; i <= count; i++) {
      baseNum += 1;
      newItems.push(createNewRow(String(baseNum), defaultBuilding));
    }
    setRows((prev) => [...prev, ...newItems]);
  };

  // Duplicate an individual (creating a family member under the same Family ID)
  const handleDuplicateRow = (row: TourIndividualRow) => {
    const newRow: TourIndividualRow = {
      ...createNewRow(row.family, row.building),
      category: row.category,
      jamaat: row.jamaat,
      hofId: row.itsId || row.hofId,
      roomNumber: row.roomNumber,
    };
    setRows((prev) => [...prev, newRow]);
  };

  // Remove an individual row
  const handleRemoveRow = (rowId: string) => {
    if (rows.length <= 1) {
      setErrorMsg('At least one individual is required in the tour group.');
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Fill sample data for quick demo/testing
  const handleFillSampleTour = () => {
    const sampleTour = `TOUR-NK-${Math.floor(100 + Math.random() * 900)}`;
    setTourRefNo(sampleTour);
    setOfficeName('Fayz E Husayni Trust Mumbai');
    setArrivalDate(todayStr);
    setArrivalTime('11:00 AM');
    setDepartureDate(defaultDepartureStr);
    setDepartureTime('01:00 AM');
    setGroupLeadName('Mulla Shabbir Bhai');

    setRows([
      {
        id: `sample-1`,
        family: '201',
        itsId: String(Math.floor(20000000 + Math.random() * 70000000)),
        applicantName: 'Mulla Shabbir Bhai Arsiwala',
        age: '48',
        gender: 'Male',
        category: 'Mumineen',
        building: 'Saifee',
        roomNumber: vacantSaifeeRooms[0]?.roomNumber || '',
        jamaat: 'MUMBAI',
        hofId: '',
        moneyGiven: 'No',
      },
      {
        id: `sample-2`,
        family: '201',
        itsId: String(Math.floor(20000000 + Math.random() * 70000000)),
        applicantName: 'Fatema Bai Arsiwala',
        age: '44',
        gender: 'Female',
        category: 'Mumineen',
        building: 'Saifee',
        roomNumber: vacantSaifeeRooms[0]?.roomNumber || '',
        jamaat: 'MUMBAI',
        hofId: '',
        moneyGiven: 'No',
      },
      {
        id: `sample-3`,
        family: '202',
        itsId: String(Math.floor(20000000 + Math.random() * 70000000)),
        applicantName: 'Husain Bhai Merchant',
        age: '32',
        gender: 'Male',
        category: 'Mumineen',
        building: 'Saifee',
        roomNumber: vacantSaifeeRooms[1]?.roomNumber || '',
        jamaat: 'DUBAI',
        hofId: '',
        moneyGiven: 'No',
      },
      {
        id: `sample-4`,
        family: '203',
        itsId: String(Math.floor(20000000 + Math.random() * 70000000)),
        applicantName: 'Amatullah Bai Merchant',
        age: '29',
        gender: 'Female',
        category: 'B to A',
        building: 'Burhani',
        roomNumber: vacantBurhaniRooms[0]?.roomNumber || '',
        jamaat: 'KARACHI',
        hofId: '',
        moneyGiven: 'Yes',
      },
    ]);
    setErrorMsg('');
  };

  // Metrics summary
  const uniqueFamiliesCount = useMemo(() => {
    return new Set(rows.map((r) => r.family.trim()).filter(Boolean)).size;
  }, [rows]);

  const allottedCount = useMemo(() => {
    return rows.filter((r) => r.roomNumber && r.roomNumber.trim() !== '').length;
  }, [rows]);

  // Duplicate checks across existing database and within current batch
  const duplicateWarnings = useMemo(() => {
    const warnings: Record<string, string> = {};
    const seenIts = new Map<string, string>();

    rows.forEach((r, idx) => {
      const its = normalizeItsId(r.itsId);
      if (!its) return;

      // Duplicate within current batch
      if (seenIts.has(its)) {
        warnings[r.id] = `Duplicate ITS ${its} entered in row #${idx + 1} (already in row #${seenIts.get(its)})`;
        return;
      }
      seenIts.set(its, String(idx + 1));

      // Duplicate in existing database
      const existingMatch = existingReservations.find((other) => normalizeItsId(other.itsId) === its);
      if (existingMatch) {
        warnings[r.id] = `ITS ${its} already exists in database (${existingMatch.applicantName} • Tour: ${existingMatch.tourRefNo})`;
      }
    });

    return warnings;
  }, [rows, existingReservations]);

  // Submission handler
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanTour = tourRefNo.trim();
    if (!cleanTour) {
      setErrorMsg('Please enter a valid Tour ID / Tour Reference Number.');
      return;
    }

    if (!arrivalDate || !departureDate) {
      setErrorMsg('Arrival and Departure dates are required.');
      return;
    }

    if (departureDate < arrivalDate) {
      setErrorMsg('Departure date cannot be earlier than Arrival date.');
      return;
    }

    if (rows.length === 0) {
      setErrorMsg('Please add at least one individual under this Tour ID.');
      return;
    }

    // Validate each row
    const newReservations: Reservation[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const fam = r.family.trim();
      const name = r.applicantName.trim();
      const its = r.itsId.trim();

      if (!fam) {
        setErrorMsg(`Row #${i + 1}: Family ID is required.`);
        return;
      }
      if (!name) {
        setErrorMsg(`Row #${i + 1}: Applicant / Individual Name is required.`);
        return;
      }

      // Check for hard duplicates
      const dupWarning = duplicateWarnings[r.id];
      if (dupWarning && dupWarning.includes('already exists in database')) {
        setErrorMsg(`Row #${i + 1}: ${dupWarning}. Please resolve duplicates before saving.`);
        return;
      }

      const rawArr = `${arrivalDate} ${arrivalTime || '11:00 AM'}`.trim();
      const rawDep = `${departureDate} ${departureTime || '01:00 AM'}`.trim();

      const reservation: Reservation = {
        id: `res-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 8)}`,
        itsId: its || `ITS-${Math.floor(10000000 + Math.random() * 90000000)}`,
        applicantName: name,
        age: r.age ? parseInt(r.age, 10) || r.age : 35,
        jamaat: r.jamaat || '',
        category: r.category || defaultCategory || 'Mumineen',
        gender: r.gender,
        family: fam,
        idara: 'Fayz',
        hofId: r.hofId || (r.gender === 'Male' ? its : ''),
        tourRefNo: cleanTour,
        officeName: officeName.trim() || 'Fayz E Husayni Trust Mumbai',
        groupLeadName: groupLeadName.trim() || name,
        arrivalDate,
        departureDate,
        rawArrivalStr: rawArr,
        rawDepartureStr: rawDep,
        arrivalTime: arrivalTime || '11:00 AM',
        departureTime: departureTime || '01:00 AM',
        arrivalDateTime: rawArr,
        departureDateTime: rawDep,
        building: r.building || defaultBuilding,
        roomNumber: r.roomNumber ? r.roomNumber.trim() : '',
        shiftToCategoryA: Boolean(r.category === 'B to A' || (r.category && r.category.toLowerCase().includes('b to a'))),
        accommodationCategory: r.category === 'B to A' ? 'Category A (Nizaam)' : 'Category B (Standard)',
        moneyGiven: r.moneyGiven || 'No',
        moneyGivenDate: r.moneyGiven === 'Yes' ? todayStr : undefined,
        isUploadedToPortal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      newReservations.push(reservation);
    }

    const success = onAddTourBatch(newReservations);
    if (success !== false) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-5xl w-full p-4 sm:p-6 shadow-2xl relative text-stone-800 flex flex-col max-h-[94vh]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-200/60 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="pb-3 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-[#124E39] text-[#EBD59E] shadow-2xs">
                <Users className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-base font-bold text-[#124E39]">
                  Add Tour Group — Shared Tour ID & Dates with Multiple Families
                </h3>
                <p className="text-xs text-stone-600 mt-0.5">
                  Enter one Tour ID and Arrival/Departure dates once, then add multiple individuals across different Family IDs.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleFillSampleTour}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-stone-200 hover:bg-stone-300 text-stone-800 transition cursor-pointer shadow-2xs"
              title="Populate test tour with sample multi-family individuals"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Fill Sample Tour</span>
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-5 pt-4 pr-1">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 1. Shared Tour & Schedule Header */}
          <div className="bg-white border border-stone-300 rounded-xl p-4 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#124E39]">
                <Briefcase className="w-4 h-4 text-[#124E39]" />
                <span>1. Shared Tour Details & Shared Dates (Common to all members)</span>
              </div>
              <span className="text-[11px] font-semibold text-stone-500">
                Arrival & Departure apply to every individual below
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
              {/* Tour ID */}
              <div>
                <label className="block font-bold text-stone-700 mb-1 flex items-center justify-between">
                  <span>Tour ID / Ref No. *</span>
                  {existingTourIds.length > 0 && (
                    <span className="text-[10px] text-stone-400 font-normal">
                      {existingTourIds.length} existing
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  required
                  list="existing-tour-ids-list"
                  placeholder="e.g. NKERP/TOUR/2026/105"
                  value={tourRefNo}
                  onChange={(e) => handleSelectTour(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 font-mono font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
                <datalist id="existing-tour-ids-list">
                  {existingTourIds.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>

              {/* Office Name */}
              <div>
                <label className="block font-bold text-stone-700 mb-1">Office Name *</label>
                <input
                  type="text"
                  required
                  list="existing-offices-list"
                  placeholder="e.g. Fayz E Husayni Mumbai"
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
                <datalist id="existing-offices-list">
                  {existingOffices.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </div>

              {/* Shared Arrival Date & Time */}
              <div>
                <label className="block font-bold text-emerald-900 mb-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Shared Arrival Date *</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    required
                    value={arrivalDate}
                    onChange={(e) => setArrivalDate(e.target.value)}
                    className="w-full bg-[#FAF7F2] border border-emerald-300 rounded-lg px-2 py-1.5 font-bold text-emerald-950 focus:outline-none focus:ring-1 focus:ring-emerald-700 cursor-pointer"
                  />
                  <input
                    type="text"
                    placeholder="11:00 AM"
                    value={arrivalTime}
                    onChange={(e) => setArrivalTime(e.target.value)}
                    className="w-24 bg-[#FAF7F2] border border-emerald-300 rounded-lg px-1.5 py-1.5 text-center font-mono text-[11px] font-bold text-emerald-950 focus:outline-none"
                    title="Arrival time (e.g. 11:00 AM or 14:30)"
                  />
                </div>
              </div>

              {/* Shared Departure Date & Time */}
              <div>
                <label className="block font-bold text-amber-900 mb-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-amber-700" />
                  <span>Shared Departure Date *</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    required
                    value={departureDate}
                    onChange={(e) => setDepartureDate(e.target.value)}
                    className="w-full bg-[#FAF7F2] border border-amber-300 rounded-lg px-2 py-1.5 font-bold text-amber-950 focus:outline-none focus:ring-1 focus:ring-amber-700 cursor-pointer"
                  />
                  <input
                    type="text"
                    placeholder="01:00 AM"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="w-24 bg-[#FAF7F2] border border-amber-300 rounded-lg px-1.5 py-1.5 text-center font-mono text-[11px] font-bold text-amber-950 focus:outline-none"
                    title="Departure time (e.g. 01:00 AM or 12:00 PM)"
                  />
                </div>
              </div>

              {/* Group Lead Name */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Group Lead Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Mulla Shabbir"
                  value={groupLeadName}
                  onChange={(e) => setGroupLeadName(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
              </div>

              {/* Default Pilgrim Category */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Default Category</label>
                <select
                  value={defaultCategory}
                  onChange={(e) => setDefaultCategory(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-stone-900 focus:outline-none"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Default Building */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Default Building</label>
                <select
                  value={defaultBuilding}
                  onChange={(e) => setDefaultBuilding(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 font-bold text-[#124E39] focus:outline-none cursor-pointer"
                >
                  {distinctBuildings.map((bldg) => {
                    const count = rooms.filter((r) => r.building.toLowerCase() === bldg.toLowerCase()).length;
                    return (
                      <option key={bldg} value={bldg}>
                        {bldg} Hotel ({count} Rooms)
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Vacant Rooms Summary */}
              <div className="flex flex-col justify-end">
                <div className="p-2 rounded-lg bg-stone-100 border border-stone-200 text-[11px] text-stone-700 flex flex-wrap items-center gap-1.5">
                  <span className="font-bold text-[#124E39]">Vacant this stay:</span>{' '}
                  {distinctBuildings.map((bldg, idx) => {
                    const vCount = getVacantRoomsForBuilding(bldg).length;
                    return (
                      <span key={bldg} className="font-semibold">
                        {vCount} {bldg}{idx < distinctBuildings.length - 1 ? ' • ' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 2. Multiple Individuals (With Different Family IDs) */}
          <div className="bg-white border border-stone-300 rounded-xl p-4 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#124E39]">
                  <Hash className="w-4 h-4 text-[#124E39]" />
                  <span>2. Individuals List — Different Family IDs Supported</span>
                </div>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  Each person can have their own unique Family ID, or you can group several people under the same Family ID.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleAddIndividual(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-2xs transition cursor-pointer"
                  title="Add another individual with a new Family ID"
                >
                  <Plus className="w-3.5 h-3.5 text-[#EBD59E]" />
                  <span>+ New Family Zaer</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddIndividual(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 shadow-2xs transition cursor-pointer"
                  title="Add another individual under the same Family ID as the last row"
                >
                  <UserPlus className="w-3.5 h-3.5 text-emerald-700" />
                  <span>+ Same Family Zaer</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddMultiple(5)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-300 transition cursor-pointer"
                  title="Add 5 rows at once"
                >
                  +5 Rows
                </button>
              </div>
            </div>

            {/* Metrics Chips Bar */}
            <div className="flex flex-wrap items-center gap-3 text-xs bg-stone-50 p-2.5 rounded-lg border border-stone-200">
              <span className="font-bold text-stone-800">Batch Summary:</span>
              <span className="bg-emerald-100 text-emerald-950 font-bold px-2 py-0.5 rounded border border-emerald-300">
                {rows.length} Total Individuals
              </span>
              <span className="bg-blue-100 text-blue-950 font-bold px-2 py-0.5 rounded border border-blue-300">
                {uniqueFamiliesCount} Distinct Family IDs
              </span>
              <span className="bg-purple-100 text-purple-950 font-bold px-2 py-0.5 rounded border border-purple-300">
                {allottedCount} Allotted to Rooms
              </span>
              <span className="bg-amber-100 text-amber-950 font-bold px-2 py-0.5 rounded border border-amber-300">
                {rows.length - allottedCount} Unallotted
              </span>
            </div>

            {/* Table of Individuals */}
            <div className="overflow-x-auto border border-stone-200 rounded-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-800 text-white uppercase text-[10px] font-bold">
                  <tr>
                    <th className="py-2.5 px-2.5 w-[3%] text-center">#</th>
                    <th className="py-2.5 px-2.5 w-[12%]">Family ID *</th>
                    <th className="py-2.5 px-2.5 w-[13%]">ITS ID</th>
                    <th className="py-2.5 px-2.5 w-[22%]">Applicant / Member Name *</th>
                    <th className="py-2.5 px-2.5 w-[7%] text-center">Age</th>
                    <th className="py-2.5 px-2.5 w-[9%] text-center">Gender</th>
                    <th className="py-2.5 px-2.5 w-[14%]">Hotel & Room Allotment</th>
                    <th className="py-2.5 px-2.5 w-[12%]">Category</th>
                    <th className="py-2.5 px-2.5 w-[8%] text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {rows.map((row, idx) => {
                    const hasDupWarning = duplicateWarnings[row.id];
                    const activeVacantRooms = getVacantRoomsForBuilding(row.building);

                    return (
                      <tr
                        key={row.id}
                        className={`transition ${hasDupWarning ? 'bg-rose-50/70' : idx % 2 === 0 ? 'bg-white' : 'bg-stone-50/60'}`}
                      >
                        {/* Index */}
                        <td className="py-2.5 px-2.5 text-center font-mono text-stone-400 font-bold">
                          {idx + 1}
                        </td>

                        {/* Family ID (Distinct per individual if desired) */}
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            required
                            placeholder="e.g. 101"
                            value={row.family}
                            onChange={(e) => handleUpdateRow(row.id, 'family', e.target.value)}
                            className="w-full bg-white border border-stone-300 rounded px-2 py-1 font-mono font-bold text-stone-900 text-xs focus:ring-1 focus:ring-[#124E39]"
                            title="Family ID (e.g. 101, 102, F-14). Can differ per person."
                          />
                        </td>

                        {/* ITS ID */}
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            placeholder="e.g. 30318214"
                            value={row.itsId}
                            onChange={(e) => handleUpdateRow(row.id, 'itsId', e.target.value)}
                            className={`w-full bg-white border rounded px-2 py-1 font-mono text-xs focus:ring-1 focus:ring-[#124E39] ${
                              hasDupWarning ? 'border-rose-400 text-rose-900 font-bold' : 'border-stone-300 text-stone-900'
                            }`}
                            title="8-digit ITS number"
                          />
                          {hasDupWarning && (
                            <div className="text-[10px] text-rose-700 font-medium leading-tight mt-0.5">
                              {hasDupWarning}
                            </div>
                          )}
                        </td>

                        {/* Applicant Name */}
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            required
                            placeholder="Full Name (e.g. Nafisa Abbas Fatehi)"
                            value={row.applicantName}
                            onChange={(e) => handleUpdateRow(row.id, 'applicantName', e.target.value)}
                            className="w-full bg-white border border-stone-300 rounded px-2 py-1 font-semibold text-stone-900 text-xs focus:ring-1 focus:ring-[#124E39]"
                          />
                        </td>

                        {/* Age */}
                        <td className="py-2 px-2 text-center">
                          <input
                            type="number"
                            min="0"
                            max="120"
                            value={row.age}
                            onChange={(e) => handleUpdateRow(row.id, 'age', e.target.value)}
                            className="w-14 text-center bg-white border border-stone-300 rounded px-1 py-1 font-mono text-xs focus:ring-1 focus:ring-[#124E39]"
                          />
                        </td>

                        {/* Gender */}
                        <td className="py-2 px-2 text-center">
                          <select
                            value={row.gender}
                            onChange={(e) => handleUpdateRow(row.id, 'gender', e.target.value as 'Male' | 'Female')}
                            className="bg-white border border-stone-300 rounded px-1.5 py-1 text-xs font-medium focus:ring-1 focus:ring-[#124E39]"
                          >
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                          </select>
                        </td>

                        {/* Building & Room Allotment */}
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <select
                              value={row.building}
                              onChange={(e) => handleUpdateRow(row.id, 'building', e.target.value)}
                              className="bg-white border border-stone-300 rounded px-1.5 py-1 text-[11px] font-bold text-[#124E39] focus:ring-1 focus:ring-[#124E39] cursor-pointer"
                            >
                              {distinctBuildings.map((bldg) => (
                                <option key={bldg} value={bldg}>{bldg}</option>
                              ))}
                            </select>

                            <select
                              value={row.roomNumber}
                              onChange={(e) => handleUpdateRow(row.id, 'roomNumber', e.target.value)}
                              className={`flex-1 bg-white border rounded px-1.5 py-1 text-xs font-mono font-bold ${
                                row.roomNumber ? 'border-emerald-400 text-emerald-950 bg-emerald-50/50' : 'border-stone-300 text-stone-500'
                              }`}
                            >
                              <option value="">Unallotted</option>
                              {activeVacantRooms.map((rm) => (
                                <option key={rm.id} value={rm.roomNumber}>
                                  Rm {rm.roomNumber} (Cap: {rm.capacity})
                                </option>
                              ))}
                              {row.roomNumber && !activeVacantRooms.some(r => r.roomNumber === row.roomNumber) && (
                                <option value={row.roomNumber}>Rm {row.roomNumber} (Occupied)</option>
                              )}
                            </select>
                          </div>
                        </td>

                        {/* Category */}
                        <td className="py-2 px-2">
                          <select
                            value={row.category}
                            onChange={(e) => handleUpdateRow(row.id, 'category', e.target.value)}
                            className="w-full bg-white border border-stone-300 rounded px-1.5 py-1 text-xs text-stone-800"
                          >
                            {categories.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>

                        {/* Actions */}
                        <td className="py-2 px-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleDuplicateRow(row)}
                              className="p-1 text-stone-400 hover:text-[#124E39] hover:bg-stone-200/60 rounded transition cursor-pointer"
                              title="Duplicate into same Family ID"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(row.id)}
                              className="p-1 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                              title="Remove individual from batch"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Quick Add Row footer */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => handleAddIndividual(false)}
                className="text-xs font-bold text-[#124E39] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add another individual with next family number</span>
              </button>

              <span className="text-[11px] text-stone-400">
                Shared Tour: <strong>{tourRefNo || '—'}</strong> • Dates: <strong>{arrivalDate}</strong> ➔ <strong>{departureDate}</strong>
              </span>
            </div>
          </div>

          {/* Modal Footer Controls */}
          <div className="pt-3 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-stone-600">
              Ready to create <strong className="text-[#124E39]">{rows.length} Zaereen</strong> across{' '}
              <strong className="text-stone-900">{uniqueFamiliesCount} Families</strong> for Tour{' '}
              <strong className="font-mono text-stone-900">{tourRefNo || 'Unassigned'}</strong>.
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-700 hover:bg-stone-200/60 border border-stone-300 transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-sm transition cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 text-[#EBD59E]" />
                <span>Save Tour Group ({rows.length} Zaereen)</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
