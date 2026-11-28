import React, { useState, useMemo, useEffect, useRef } from 'react';
import { X, UserPlus, AlertCircle, ShieldCheck, ArrowRight } from 'lucide-react';
import { Reservation, Room, MoneyGivenStatus } from '../types';
import { isDuplicateReservation, normalizeItsId, normalizeText } from '../utils/deduplication';
import { getVacantRoomsForDuration, getDistinctBuildings } from '../services/storage';
import { btn, btnSm, field, fieldLabel, modalScrim, modalCard, modalHeader, modalTitle, modalClose, modalFooter } from './ui';

/* Shared form pieces for this dialog. */
const groupTitle = 'text-[15px] font-semibold text-stone-950 pb-2 border-b border-stone-200';
const helpText = 'mt-1.5 text-xs text-stone-500';
const errorText = 'mt-1.5 text-xs text-rose-700';
const fieldBad = ' border-rose-400';
const pick = (on: boolean) =>
  `inline-flex items-center h-8 max-sm:h-10 px-2.5 rounded-lg text-xs font-medium tabular-nums ring-1 ring-inset cursor-pointer ${
    on ? 'bg-brand-50 text-brand-800 ring-brand-500' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50'
  }`;
const Required = () => (
  <span className="text-rose-600" aria-hidden="true">
    {' '}*
  </span>
);

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
  
  // Dynamic distinct buildings list (core 3 + any custom buildings added by user)
  const distinctBuildings = useMemo(() => getDistinctBuildings(rooms), [rooms]);

  const [building, setBuilding] = useState<string>('Saifee');
  const [roomNumber, setRoomNumber] = useState('');
  const [shiftToCategoryA, setShiftToCategoryA] = useState(false);
  const [moneyGiven, setMoneyGiven] = useState<MoneyGivenStatus>('No');
  const [moneyNotes, setMoneyNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const wasOpenRef = useRef(false);

  // Reset form ONLY when modal transitions from closed -> open
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setItsId('');
      setApplicantName('');
      setAge('35');
      setGender('Male');
      setFamily(existingFamilies[0] || 'F-1');
      setTourRefNo('');
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
    wasOpenRef.current = isOpen;
  }, [isOpen, existingFamilies, existingOffices, categories, todayStr, defaultDepartureStr]);

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
      setErrorMsg('Enter the zair’s full name.');
      return;
    }

    if (!tourRefNo.trim()) {
      setErrorMsg('Enter a Tour ID.');
      return;
    }

    if (duplicateMatch) {
      setErrorMsg(
        `Cannot add: a zair with this ITS or name is already in the list (${duplicateMatch.applicantName}, family ${duplicateMatch.family}, tour ${duplicateMatch.tourRefNo}).`
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
      idara: '',
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
      setErrorMsg('This zair is already in the list.');
      return;
    }

    onAddZaer(newReservation);
    onClose();
  };

  // After a failed save, point at the fields that still need filling.
  const nameMissing = !!errorMsg && !applicantName.trim();
  const tourMissing = !!errorMsg && !tourRefNo.trim();
  const itsChecked = !duplicateMatch && itsId.trim().length >= 7;

  return (
    <div className={modalScrim}>
      <div className={`${modalCard} max-w-3xl`} role="dialog" aria-modal="true" aria-labelledby="add-zair-title">
        <div className={modalHeader}>
          <div className="min-w-0">
            <h3 id="add-zair-title" className={modalTitle}>
              Add zair
            </h3>
            <p className="mt-1 text-sm text-stone-600">
              Enter one zair’s details. The ITS and name are checked against the list so nobody is added twice.
            </p>
          </div>
          <button type="button" onClick={onClose} className={modalClose} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-7">
          {onSwitchToAddTourGroup && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-stone-50 ring-1 ring-inset ring-stone-200/70 px-4 py-3">
              <p className="text-[13px] text-stone-600">
                Adding a whole tour? Enter the Tour ID and dates once, then add everyone with their own family IDs.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSwitchToAddTourGroup();
                }}
                className={`${btnSm.secondary} max-sm:h-10 shrink-0`}
              >
                Add tour group instead
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {duplicateMatch && (
            <div role="alert" className="flex items-start gap-3 rounded-xl bg-rose-50 ring-1 ring-inset ring-rose-200 px-4 py-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="min-w-0 text-[13px] leading-relaxed text-rose-800">
                <p className="text-sm font-semibold">This zair is already in the list</p>
                <p className="mt-0.5">
                  <span className="font-semibold">{duplicateMatch.applicantName}</span>
                  {duplicateMatch.itsId && <span className="tabular-nums"> · ITS {duplicateMatch.itsId}</span>} · Family{' '}
                  {duplicateMatch.family} · Tour {duplicateMatch.tourRefNo} ·{' '}
                  {duplicateMatch.roomNumber
                    ? `Room ${duplicateMatch.roomNumber} (${duplicateMatch.building})`
                    : 'No room yet'}
                  . A zair cannot be added twice.
                </p>
              </div>
            </div>
          )}

          {/* Zair */}
          <section>
            <h4 className={groupTitle}>Zair</h4>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="az-its" className={fieldLabel}>
                  ITS
                </label>
                <input
                  id="az-its"
                  type="text"
                  inputMode="numeric"
                  placeholder="30318214"
                  value={itsId}
                  onChange={(e) => setItsId(e.target.value)}
                  aria-invalid={!!duplicateMatch}
                  className={`${field} tabular-nums${duplicateMatch ? fieldBad : ''}`}
                />
                {duplicateMatch ? (
                  <p className={errorText}>Already in the list.</p>
                ) : itsChecked ? (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-700">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    Not in the list. Safe to add.
                  </p>
                ) : (
                  <p className={helpText}>8 digits.</p>
                )}
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="az-name" className={fieldLabel}>
                  Full name
                  <Required />
                </label>
                <input
                  id="az-name"
                  type="text"
                  required
                  placeholder="Nafisa Abbas Fatehi"
                  value={applicantName}
                  onChange={(e) => setApplicantName(e.target.value)}
                  aria-invalid={nameMissing}
                  className={`${field}${nameMissing ? fieldBad : ''}`}
                />
                {nameMissing && <p className={errorText}>Enter the zair’s full name.</p>}
              </div>

              <div>
                <label htmlFor="az-age" className={fieldLabel}>
                  Age
                </label>
                <input
                  id="az-age"
                  type="number"
                  min="1"
                  max="120"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className={`${field} tabular-nums`}
                />
              </div>

              <div>
                <label htmlFor="az-gender" className={fieldLabel}>
                  Gender
                </label>
                <select
                  id="az-gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as 'Male' | 'Female')}
                  className={field}
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>

              <div>
                <label htmlFor="az-category" className={fieldLabel}>
                  Pilgrim category
                </label>
                <select id="az-category" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="az-jamaat" className={fieldLabel}>
                  Jamaat / mohalla <span className="font-normal text-stone-500">(optional)</span>
                </label>
                <input
                  id="az-jamaat"
                  type="text"
                  placeholder="HATEMI MOHALLA (MUMBAI)"
                  value={jamaat}
                  onChange={(e) => setJamaat(e.target.value)}
                  className={field}
                />
              </div>

              <div>
                <label htmlFor="az-hof" className={fieldLabel}>
                  Head of family ITS <span className="font-normal text-stone-500">(HOF)</span>
                </label>
                <input
                  id="az-hof"
                  type="text"
                  inputMode="numeric"
                  placeholder="20304504"
                  value={hofId}
                  onChange={(e) => setHofId(e.target.value)}
                  className={`${field} tabular-nums`}
                />
              </div>
            </div>
          </section>

          {/* Tour and family */}
          <section>
            <h4 className={groupTitle}>Tour and family</h4>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="az-tour" className={fieldLabel}>
                  Tour ID
                  <Required />
                </label>
                <input
                  id="az-tour"
                  type="text"
                  required
                  placeholder="NKERP/TOUR/2026/1333"
                  value={tourRefNo}
                  onChange={(e) => setTourRefNo(e.target.value)}
                  aria-invalid={tourMissing}
                  className={`${field} tabular-nums${tourMissing ? fieldBad : ''}`}
                />
                {tourMissing && <p className={errorText}>Enter a Tour ID.</p>}
                {existingTourIds.length > 0 && (
                  <>
                    <p className={helpText}>Or pick a tour already in the list:</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {existingTourIds.slice(0, 4).map((tid) => (
                        <button
                          key={tid}
                          type="button"
                          onClick={() => handleSelectTour(tid)}
                          aria-pressed={tourRefNo === tid}
                          className={pick(tourRefNo === tid)}
                        >
                          {tid}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div>
                <label htmlFor="az-family" className={fieldLabel}>
                  Family number
                  <Required />
                </label>
                <input
                  id="az-family"
                  type="text"
                  required
                  placeholder="F-1"
                  value={family}
                  onChange={(e) => setFamily(e.target.value)}
                  className={`${field} tabular-nums`}
                />
                {existingFamilies.length > 0 && (
                  <>
                    <p className={helpText}>Or pick a family already in the list:</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {existingFamilies.slice(0, 5).map((fam) => (
                        <button
                          key={fam}
                          type="button"
                          onClick={() => handleSelectFamily(fam)}
                          aria-pressed={family === fam}
                          className={pick(family === fam)}
                        >
                          {fam}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div>
                <label htmlFor="az-office" className={fieldLabel}>
                  Office
                </label>
                <input
                  id="az-office"
                  type="text"
                  placeholder="Fayz E Husayni Trust Mumbai"
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  className={field}
                />
              </div>

              <div>
                <label htmlFor="az-lead" className={fieldLabel}>
                  Group leader <span className="font-normal text-stone-500">(optional)</span>
                </label>
                <input
                  id="az-lead"
                  type="text"
                  placeholder="Husain Shaikh Asgar Arsiwala"
                  value={groupLeadName}
                  onChange={(e) => setGroupLeadName(e.target.value)}
                  className={field}
                />
              </div>
            </div>
          </section>

          {/* Dates and room */}
          <section>
            <h4 className={groupTitle}>Dates and room</h4>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label htmlFor="az-arr-date" className={fieldLabel}>
                  Arrival date
                  <Required />
                </label>
                <input
                  id="az-arr-date"
                  type="date"
                  required
                  value={arrivalDate}
                  onChange={(e) => setArrivalDate(e.target.value)}
                  className={`${field} tabular-nums cursor-pointer`}
                />
              </div>

              <div>
                <label htmlFor="az-arr-time" className={fieldLabel}>
                  Arrival time
                </label>
                <input
                  id="az-arr-time"
                  type="text"
                  placeholder="11:00 AM"
                  value={arrivalTime}
                  onChange={(e) => setArrivalTime(e.target.value)}
                  className={`${field} tabular-nums`}
                />
              </div>

              <div>
                <label htmlFor="az-dep-date" className={fieldLabel}>
                  Departure date
                  <Required />
                </label>
                <input
                  id="az-dep-date"
                  type="date"
                  required
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className={`${field} tabular-nums cursor-pointer`}
                />
              </div>

              <div>
                <label htmlFor="az-dep-time" className={fieldLabel}>
                  Departure time
                </label>
                <input
                  id="az-dep-time"
                  type="text"
                  placeholder="01:00 AM"
                  value={departureTime}
                  onChange={(e) => setDepartureTime(e.target.value)}
                  className={`${field} tabular-nums`}
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="az-building" className={fieldLabel}>
                  Building
                </label>
                <select
                  id="az-building"
                  value={building}
                  onChange={(e) => {
                    setBuilding(e.target.value);
                    setRoomNumber('');
                  }}
                  className={field}
                >
                  {distinctBuildings.map((bldg) => {
                    const count = rooms.filter((r) => r.building.toLowerCase() === bldg.toLowerCase()).length;
                    return (
                      <option key={bldg} value={bldg}>
                        {bldg} ({count} rooms)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="col-span-2">
                <label htmlFor="az-room" className={fieldLabel}>
                  Room
                </label>
                <select
                  id="az-room"
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  className={`${field} tabular-nums`}
                >
                  <option value="">Leave unallotted for now</option>
                  {vacantRooms.map((rm) => (
                    <option key={rm.id} value={rm.roomNumber}>
                      Room {rm.roomNumber} ({rm.building}) · sleeps {rm.capacity} · {rm.floorLabel || `Floor ${rm.floor}`}
                    </option>
                  ))}
                </select>
                <p className={helpText}>
                  {vacantRooms.length} vacant in {building} for these dates.
                </p>
              </div>
            </div>
          </section>

          {/* B→A shift */}
          <section>
            <h4 className={groupTitle}>B→A shift</h4>
            <label className="mt-3 flex items-start gap-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={shiftToCategoryA}
                onChange={(e) => setShiftToCategoryA(e.target.checked)}
                className="mt-0.5 w-[18px] h-[18px] rounded border-stone-300 cursor-pointer"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-stone-900">
                  Shift this zair from Category B (standard) to Category A (Nizaam)
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  Makes an accounts request slip so the money can be collected.
                </span>
              </span>
            </label>

            {shiftToCategoryA && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in duration-150">
                <div>
                  <label htmlFor="az-money" className={fieldLabel}>
                    Money given to accounts?
                  </label>
                  <select
                    id="az-money"
                    value={moneyGiven}
                    onChange={(e) => setMoneyGiven(e.target.value as MoneyGivenStatus)}
                    className={field}
                  >
                    <option value="No">No, money pending (make a request slip)</option>
                    <option value="Yes">Yes, collected by accounts</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="az-money-notes" className={fieldLabel}>
                    Accounts receipt / notes
                  </label>
                  <input
                    id="az-money-notes"
                    type="text"
                    placeholder="Paid in cash at reception desk"
                    value={moneyNotes}
                    onChange={(e) => setMoneyNotes(e.target.value)}
                    className={field}
                  />
                </div>
              </div>
            )}
          </section>
        </form>

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2 px-5 sm:px-6 py-3 border-t border-rose-200 bg-rose-50 text-[13px] text-rose-800"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className={modalFooter}>
          <button type="button" onClick={onClose} className={btn.ghost}>
            Cancel
          </button>
          <button type="button" disabled={!!duplicateMatch} onClick={handleSubmit} className={btn.primary}>
            <UserPlus className="w-4 h-4" />
            {duplicateMatch ? 'Already in the list' : 'Add zair'}
          </button>
        </div>
      </div>
    </div>
  );
};
