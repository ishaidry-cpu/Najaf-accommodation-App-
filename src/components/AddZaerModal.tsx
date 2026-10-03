import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, 
  UserPlus, 
  CheckCircle2, 
  AlertCircle, 
  Calendar, 
  Building2, 
  BedDouble, 
  ShieldCheck, 
  Users, 
  Clock, 
  ArrowRight,
  BadgeAlert
} from 'lucide-react';
import { Reservation, Room, MoneyGivenStatus } from '../types';
import { isDuplicateReservation, normalizeItsId, normalizeText } from '../utils/deduplication';
import { getVacantRoomsForDuration } from '../services/storage';

interface AddZaerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddZaer: (newZaer: Reservation) => boolean | void;
  existingReservations: Reservation[];
  rooms: Room[];
  categories: string[];
  onSwitchToAddTourGroup?: () => void;
}

export const AddZaerModal: React.FC<AddZaerModalProps> = ({
  isOpen,
  onClose,
  onAddZaer,
  existingReservations,
  rooms,
  categories,
  onSwitchToAddTourGroup,
}) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const defaultDepartureStr = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

  // Distinct Tour IDs for quick autofill/suggestion
  const existingTourIds = useMemo(() => {
    return Array.from(new Set(existingReservations.map((r) => (r.tourRefNo || '').trim()).filter(Boolean))).sort();
  }, [existingReservations]);

  // Distinct Office Names for suggestions
  const existingOffices = useMemo(() => {
    return Array.from(new Set(existingReservations.map((r) => (r.officeName || '').trim()).filter(Boolean))).sort();
  }, [existingReservations]);

  // Distinct Families
  const existingFamilies = useMemo(() => {
    return Array.from(new Set(existingReservations.map((r) => (r.family || '').trim()).filter(Boolean))).sort();
  }, [existingReservations]);

  // Form state
  const [itsId, setItsId] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [age, setAge] = useState<string>('35');
  const [gender, setGender] = useState<'Male' | 'Female'>('Male');
  const [family, setFamily] = useState('');
  const [tourRefNo, setTourRefNo] = useState('');
  const [officeName, setOfficeName] = useState('Fayz E Husayni Trust Mumbai');
  const [jamaat, setJamaat] = useState('');
  const [groupLeadName, setGroupLeadName] = useState('');
  const [hofId, setHofId] = useState('');
  const [category, setCategory] = useState(categories[0] || 'Mumineen');
  const [arrivalDate, setArrivalDate] = useState(todayStr);
  const [arrivalTime, setArrivalTime] = useState('11:00 AM');
  const [departureDate, setDepartureDate] = useState(defaultDepartureStr);
  const [departureTime, setDepartureTime] = useState('01:00 AM');
  
  // Dynamic distinct buildings list
  const distinctBuildings = useMemo(() => {
    const list = Array.from(new Set(rooms.map((r) => r.building).filter(Boolean)));
    return list.length > 0 ? list.sort() : ['Saifee', 'Burhani'];
  }, [rooms]);

  const [building, setBuilding] = useState<string>('Saifee');
  const [roomNumber, setRoomNumber] = useState('');
  const [shiftToCategoryA, setShiftToCategoryA] = useState(false);
  const [moneyGiven, setMoneyGiven] = useState<MoneyGivenStatus>('No');
  const [moneyNotes, setMoneyNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Reset form when opened
  useEffect(() => {
    if (isOpen) {
      setItsId('');
      setApplicantName('');
      setAge('35');
      setGender('Male');
      setFamily(existingFamilies[0] || 'F-1');
      setTourRefNo(existingTourIds[0] || 'NKERP/TOUR/2026/101');
      setOfficeName(existingOffices[0] || 'Fayz E Husayni Trust Mumbai');
      setJamaat('');
      setGroupLeadName('');
      setHofId('');
      setCategory(categories[0] || 'Mumineen');
      setArrivalDate(todayStr);
      setArrivalTime('11:00 AM');
      setDepartureDate(defaultDepartureStr);
      setDepartureTime('01:00 AM');
      setBuilding('Saifee');
      setRoomNumber('');
      setShiftToCategoryA(false);
      setMoneyGiven('No');
      setMoneyNotes('');
      setErrorMsg('');
    }
  }, [isOpen, existingFamilies, existingTourIds, existingOffices, categories, todayStr, defaultDepartureStr]);

  // Autofill Tour metadata when user selects/types a tour
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

  // Autofill Family metadata
  const handleSelectFamily = (fam: string) => {
    setFamily(fam);
    const match = existingReservations.find((r) => r.family === fam);
    if (match) {
      if (match.tourRefNo) setTourRefNo(match.tourRefNo);
      if (match.building) setBuilding(match.building as 'Saifee' | 'Burhani');
      if (match.roomNumber) setRoomNumber(match.roomNumber);
      if (match.groupLeadName) setGroupLeadName(match.groupLeadName);
    }
  };

  // Dynamic vacant rooms for selected building & duration
  const vacantRooms = useMemo(() => {
    if (!arrivalDate || !departureDate) return [];
    return getVacantRoomsForDuration(
      building,
      arrivalDate,
      departureDate,
      rooms,
      existingReservations
    );
  }, [building, arrivalDate, departureDate, rooms, existingReservations]);

  // Real-time duplicate detection:
  // "if not in the list already"
  const duplicateMatch = useMemo(() => {
    const trimmedIts = normalizeItsId(itsId);
    const trimmedName = normalizeText(applicantName);
    const trimmedTour = normalizeText(tourRefNo);

    if (!trimmedIts && !trimmedName) return null;

    // Check by ITS ID (primary unique identifier)
    if (trimmedIts) {
      const match = existingReservations.find((r) => normalizeItsId(r.itsId) === trimmedIts);
      if (match) return match;
    }

    // Check by Tour + Name
    if (trimmedName && trimmedTour) {
      const match = existingReservations.find((r) => {
        return normalizeText(r.applicantName) === trimmedName && normalizeText(r.tourRefNo) === trimmedTour;
      });
      if (match) return match;
    }

    return null;
  }, [itsId, applicantName, tourRefNo, existingReservations]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!applicantName.trim()) {
      setErrorMsg('Please enter the Zair applicant full name.');
      return;
    }

    if (!tourRefNo.trim()) {
      setErrorMsg('Please provide a Tour ID / Tour Reference Number.');
      return;
    }

    if (duplicateMatch) {
      setErrorMsg(
        `Cannot add: A Zair with this ITS ID or Name already exists in the system (${duplicateMatch.applicantName}, Family ${duplicateMatch.family}, Tour ${duplicateMatch.tourRefNo}).`
      );
      return;
    }

    const newId = `zaer-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const formattedRawArrival = arrivalTime ? `${arrivalDate} ${arrivalTime}` : arrivalDate;
    const formattedRawDeparture = departureTime ? `${departureDate} ${departureTime}` : departureDate;

    const newReservation: Reservation = {
      id: newId,
      itsId: itsId.trim(),
      applicantName: applicantName.trim(),
      age: parseInt(age, 10) || 0,
      gender,
      family: family.trim() || 'F-1',
      tourRefNo: tourRefNo.trim(),
      officeName: officeName.trim() || 'Fayz E Husayni Trust Mumbai',
      jamaat: jamaat.trim() || undefined,
      hofId: hofId.trim() || undefined,
      groupLeadName: groupLeadName.trim() || applicantName.trim(),
      category: category || 'Mumineen',
      idara: 'Faiz-e-Husaini',
      arrivalDate,
      departureDate,
      rawArrivalStr: formattedRawArrival,
      rawDepartureStr: formattedRawDeparture,
      building: roomNumber ? building : (building || 'Saifee'),
      roomNumber: roomNumber.trim(),
      shiftToCategoryA,
      accommodationCategory: shiftToCategoryA ? 'Category A (Nizaam)' : 'Category B (Standard)',
      requestSlipNo: shiftToCategoryA ? `SLIP-${family.trim() || 'FAM'}-${Date.now().toString().slice(-4)}` : undefined,
      requestSlipDate: shiftToCategoryA ? todayStr : undefined,
      moneyGiven: shiftToCategoryA ? moneyGiven : 'No',
      moneyNotes: shiftToCategoryA && moneyNotes ? moneyNotes.trim() : undefined,
      isUploadedToPortal: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Strict duplication guard
    if (existingReservations.some((r) => isDuplicateReservation(r, newReservation))) {
      setErrorMsg('A duplicate record already exists in the list.');
      return;
    }

    onAddZaer(newReservation);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-3xl w-full p-5 sm:p-7 shadow-2xl relative text-stone-800 max-h-[92vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-stone-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#124E39] text-[#EBD59E] shadow-xs">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-[#124E39]">Add New Zair</h3>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300">
                  Unique-Check Active
                </span>
              </div>
              <p className="text-xs text-stone-600 mt-0.5">
                Manually enter complete details for a Zair. Verified against current zaereen list to prevent duplicate entries.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-200/60 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Switch to Tour Group Builder */}
        {onSwitchToAddTourGroup && (
          <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-300/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-emerald-950 shadow-2xs">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#124E39] shrink-0" />
              <span>
                Adding a full tour group? Add one Tour ID with <strong>different family IDs</strong> & multiple individuals sharing the same dates.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onSwitchToAddTourGroup();
              }}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] shadow-2xs transition cursor-pointer shrink-0 text-xs"
            >
              <span>Add Tour Group Instead</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 py-4 space-y-5 pr-1">

          {/* Duplicate Detection Alert / Status Banner */}
          {duplicateMatch ? (
            <div className="p-3.5 rounded-xl bg-rose-50 border-2 border-rose-300 text-rose-950 flex items-start gap-3 shadow-xs">
              <BadgeAlert className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-bold text-rose-900 text-sm">
                  ⚠️ Zair Already Exists in List!
                </div>
                <p className="mt-1 text-rose-800 leading-relaxed">
                  A registered record already exists with matching credentials:{' '}
                  <strong>{duplicateMatch.applicantName}</strong>{' '}
                  {duplicateMatch.itsId && <span>(ITS: <strong>{duplicateMatch.itsId}</strong>)</span>} •{' '}
                  Family: <strong>{duplicateMatch.family}</strong> • Tour: <strong>{duplicateMatch.tourRefNo}</strong> •{' '}
                  Room: <strong>{duplicateMatch.roomNumber ? `Room ${duplicateMatch.roomNumber} (${duplicateMatch.building})` : 'Unallotted'}</strong>.
                </p>
                <div className="mt-2 text-[11px] font-bold text-rose-900">
                  Duplicate zaereen cannot be re-added to preserve data integrity.
                </div>
              </div>
            </div>
          ) : (
            itsId.trim().length >= 7 && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 flex items-center gap-2.5 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>✓ Verified Unique: This ITS ID is not in the present list. Safe to add.</span>
              </div>
            )
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-100 border border-rose-300 text-rose-900 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Personal Details */}
          <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-3.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#124E39] border-b border-stone-100 pb-1.5 flex items-center gap-1.5">
              <span>1. Zair Personal Information</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* ITS ID */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  ITS ID <span className="text-stone-400 font-normal">(8 Digits)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 30318214"
                  value={itsId}
                  onChange={(e) => setItsId(e.target.value)}
                  className={`w-full bg-[#FAF7F2] border rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-stone-900 focus:outline-none focus:ring-1 ${
                    duplicateMatch ? 'border-rose-400 focus:ring-rose-500' : 'border-stone-300 focus:ring-[#124E39]'
                  }`}
                />
              </div>

              {/* Applicant Name */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  Full Name / Applicant Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Nafisa Abbas Fatehi"
                  value={applicantName}
                  onChange={(e) => setApplicantName(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
              </div>

              {/* Age */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">Age</label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
              </div>

              {/* Gender */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">Gender</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as 'Male' | 'Female')}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>

              {/* Pilgrim Category */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">Pilgrim Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Jamaat / Mohalla */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  Jamaat / Mohalla <span className="text-stone-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. HATEMI MOHALLA (MUMBAI)"
                  value={jamaat}
                  onChange={(e) => setJamaat(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
              </div>

              {/* HOF ITS ID */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  Head of Family ITS <span className="text-stone-400 font-normal">(HOF)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 20304504"
                  value={hofId}
                  onChange={(e) => setHofId(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-mono text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Tour & Family Affiliation */}
          <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-3.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#124E39] border-b border-stone-100 pb-1.5 flex items-center gap-1.5">
              <span>2. Tour ID & Family Grouping</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Tour Reference No */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-stone-700">
                    Tour ID <span className="text-rose-500">*</span>
                  </label>
                  {existingTourIds.length > 0 && (
                    <span className="text-[10px] text-stone-400">or pick existing below</span>
                  )}
                </div>
                <input
                  type="text"
                  required
                  placeholder="e.g. NKERP/TOUR/2026/1333"
                  value={tourRefNo}
                  onChange={(e) => setTourRefNo(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />

                {/* Quick tour chips */}
                {existingTourIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {existingTourIds.slice(0, 4).map((tid) => (
                      <button
                        key={tid}
                        type="button"
                        onClick={() => handleSelectTour(tid)}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border transition cursor-pointer ${
                          tourRefNo === tid
                            ? 'bg-[#124E39] text-[#EBD59E] border-[#124E39] font-bold'
                            : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                        }`}
                      >
                        {tid}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Family Number */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-stone-700">
                    Family Number <span className="text-rose-500">*</span>
                  </label>
                  {existingFamilies.length > 0 && (
                    <span className="text-[10px] text-stone-400">or pick existing</span>
                  )}
                </div>
                <input
                  type="text"
                  required
                  placeholder="e.g. F-1, 102"
                  value={family}
                  onChange={(e) => setFamily(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />

                {/* Quick family chips */}
                {existingFamilies.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {existingFamilies.slice(0, 5).map((fam) => (
                      <button
                        key={fam}
                        type="button"
                        onClick={() => handleSelectFamily(fam)}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border transition cursor-pointer ${
                          family === fam
                            ? 'bg-[#124E39] text-[#EBD59E] border-[#124E39] font-bold'
                            : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                        }`}
                      >
                        {fam}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Office Name */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  Office Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Fayz E Husayni Trust Mumbai"
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
              </div>

              {/* Group Lead Name */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  Group Leader Name <span className="text-stone-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Husain Shaikh Asgar Arsiwala"
                  value={groupLeadName}
                  onChange={(e) => setGroupLeadName(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Arrival, Departure & Room Allotment */}
          <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-3.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#124E39] border-b border-stone-100 pb-1.5 flex items-center gap-1.5">
              <span>3. Dates & Room Allotment</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Arrival Date */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  Arrival Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={arrivalDate}
                  onChange={(e) => setArrivalDate(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39] cursor-pointer"
                />
              </div>

              {/* Arrival Time */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">Arrival Time</label>
                <input
                  type="text"
                  placeholder="e.g. 11:00 AM"
                  value={arrivalTime}
                  onChange={(e) => setArrivalTime(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
              </div>

              {/* Departure Date */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  Departure Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39] cursor-pointer"
                />
              </div>

              {/* Departure Time */}
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">Departure Time</label>
                <input
                  type="text"
                  placeholder="e.g. 01:00 AM"
                  value={departureTime}
                  onChange={(e) => setDepartureTime(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                />
              </div>
            </div>

            {/* Room Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  Hotel / Building
                </label>
                <select
                  value={building}
                  onChange={(e) => {
                    setBuilding(e.target.value);
                    setRoomNumber('');
                  }}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-bold text-[#124E39] focus:outline-none focus:ring-1 focus:ring-[#124E39] cursor-pointer"
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

              <div>
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  Room Allotment <span className="text-stone-400 font-normal">({vacantRooms.length} Vacant for these dates)</span>
                </label>
                <select
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  className="w-full bg-white border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#124E39]"
                >
                  <option value="">-- Leave Unallotted for Now --</option>
                  {vacantRooms.map((rm) => (
                    <option key={rm.id} value={rm.roomNumber}>
                      Room {rm.roomNumber} ({rm.building}) • Pax {rm.capacity} • {rm.floorLabel || `Floor ${rm.floor}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 4: Accommodation B to A Shift (Optional) */}
          <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-bold text-stone-900 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shiftToCategoryA}
                    onChange={(e) => setShiftToCategoryA(e.target.checked)}
                    className="w-4 h-4 text-[#124E39] rounded border-stone-300 focus:ring-[#124E39] cursor-pointer"
                  />
                  <span>Shift from Standard (B) to Nizaam (Category A)</span>
                </label>
                <p className="text-[11px] text-stone-500 ml-6 mt-0.5">
                  Generates an Accounts Request Slip for money collection for this Zair.
                </p>
              </div>
            </div>

            {shiftToCategoryA && (
              <div className="p-3 bg-[#FAF7F2] border border-[#124E39]/30 rounded-xl space-y-3 animate-in fade-in duration-150">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      Money Given to Accounts?
                    </label>
                    <select
                      value={moneyGiven}
                      onChange={(e) => setMoneyGiven(e.target.value as MoneyGivenStatus)}
                      className="w-full bg-white border border-stone-300 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-900"
                    >
                      <option value="No">No — Money Pending (Generate Request Slip)</option>
                      <option value="Yes">Yes — Money Collected by Accounts</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      Accounts Receipt / Notes
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Paid in cash at reception desk"
                      value={moneyNotes}
                      onChange={(e) => setMoneyNotes(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

        </form>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-stone-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 transition cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!!duplicateMatch}
            onClick={handleSubmit}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm transition ${
              duplicateMatch
                ? 'bg-stone-300 text-stone-500 cursor-not-allowed'
                : 'bg-[#124E39] hover:bg-[#0E3C2C] text-[#EBD59E] cursor-pointer'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>{duplicateMatch ? 'Zair Already in List (Cannot Add Duplicate)' : 'Add Zair to System'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
