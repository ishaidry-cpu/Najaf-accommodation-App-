import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { X, Users, Plus, Trash2, AlertCircle, CheckCircle2, Copy, UserPlus, ClipboardPaste, Wand2 } from 'lucide-react';
import { Reservation, Room, MoneyGivenStatus } from '../types';
import { normalizeItsId } from '../utils/deduplication';
import { getVacantRoomsForDuration, normalizeBuildingName, normalizeRoomNumber, getDistinctBuildings } from '../services/storage';
import { parseBulkTourPaste, cleanClipboardText, normalizeGender } from '../utils/itsPasteParser';
import {
  btn,
  btnSm,
  field,
  fieldSm,
  fieldLabel,
  panel,
  modalScrim,
  modalCard,
  modalHeader,
  modalTitle,
  modalClose,
  modalFooter,
} from './ui';
import { SUBVENUE_ARRIVAL_TIME, SUBVENUE_DEPARTURE_TIME } from '../services/stayTimes';

/* Shared form pieces for this dialog. */
const groupTitle = 'text-[15px] font-semibold text-stone-950 pb-2 border-b border-stone-200';
const helpText = 'mt-1.5 text-xs text-stone-500';
const errorText = 'mt-1.5 text-xs text-rose-700';
const segWrap = 'inline-flex items-center gap-1 p-1 rounded-lg bg-stone-100';
const segBtn = (on: boolean) =>
  `h-8 max-sm:h-10 px-3 rounded-md text-[13px] whitespace-nowrap cursor-pointer ${
    on
      ? 'bg-white text-brand-700 font-semibold ring-1 ring-inset ring-stone-300'
      : 'font-medium text-stone-600 hover:text-stone-950'
  }`;
/** A field inside the members table (40px tall on phones, where each member is a stacked block). */
const cell = `${fieldSm} w-full max-md:h-10`;
const cellLabel = 'md:hidden block mb-1 text-xs font-medium text-stone-600';
const iconBtn =
  'w-9 h-9 max-md:w-10 max-md:h-10 rounded-lg flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 cursor-pointer';
const MSG_TOUR = 'Enter a Tour ID.';
const MSG_DATES = 'The departure date cannot be before the arrival date.';
const Required = () => (
  <span className="text-rose-600" aria-hidden="true">
    {' '}*
  </span>
);

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
  matchedFromHistory?: boolean;
}

interface AddTourGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTourBatch: (newReservations: Reservation[]) => boolean | void;
  existingReservations: Reservation[];
  rooms: Room[];
  categories: string[];
}

type PasteFamilyMode = 'separate' | 'same' | 'pasted';

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

  // Guard so background data polling NEVER wipes out an in-progress tour form
  const wasOpenRef = useRef(false);

  // Distinct Tour IDs & Offices for quick autofill/suggestion
  const existingTourIds = useMemo(() => {
    return Array.from(
      new Set(existingReservations.map((r) => (r.tourRefNo || '').trim()).filter(Boolean))
    ).sort();
  }, [existingReservations]);

  const existingOffices = useMemo(() => {
    return Array.from(
      new Set(existingReservations.map((r) => (r.officeName || '').trim()).filter(Boolean))
    ).sort();
  }, [existingReservations]);

  // Fast ITS lookup map for auto-filling names/details when a single ITS is typed/pasted
  const existingByIts = useMemo(() => {
    const map = new Map<string, Reservation>();
    for (const r of existingReservations) {
      const k = normalizeItsId(r.itsId);
      if (!k) continue;
      const prev = map.get(k);
      if (!prev || (!prev.applicantName && r.applicantName)) {
        map.set(k, r);
      }
    }
    return map;
  }, [existingReservations]);

  // Shared Tour Parameters
  const [tourRefNo, setTourRefNo] = useState('');
  const [officeName, setOfficeName] = useState('Fayz E Husayni Trust Mumbai');
  const [arrivalDate, setArrivalDate] = useState(todayStr);
  const [arrivalTime, setArrivalTime] = useState(SUBVENUE_ARRIVAL_TIME);
  const [departureDate, setDepartureDate] = useState(defaultDepartureStr);
  const [departureTime, setDepartureTime] = useState(SUBVENUE_DEPARTURE_TIME);
  const [groupLeadName, setGroupLeadName] = useState('');
  const [defaultCategory, setDefaultCategory] = useState(categories[0] || 'Mumineen');

  // All buildings in inventory (core 3 + any custom buildings added by user)
  const distinctBuildings = useMemo(() => getDistinctBuildings(rooms), [rooms]);
  const [defaultBuilding, setDefaultBuilding] = useState<string>('Saifee');
  const [batchRoomNumber, setBatchRoomNumber] = useState<string>('');

  // Bulk ITS Paste State
  const [isPasteOpen, setIsPasteOpen] = useState(true);
  const [pasteRawText, setPasteRawText] = useState('');
  const [pasteFamilyMode, setPasteFamilyMode] = useState<PasteFamilyMode>('separate');
  const [pasteSameFamilyId, setPasteSameFamilyId] = useState('101');
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  // Individuals Rows
  const [rows, setRows] = useState<TourIndividualRow[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const createNewRow = useCallback(
    (
      familyVal: string = '101',
      buildingVal: string = defaultBuilding,
      categoryVal: string = defaultCategory
    ): TourIndividualRow => ({
      id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      family: familyVal,
      itsId: '',
      applicantName: '',
      age: '35',
      gender: 'Male',
      category: categoryVal,
      building: buildingVal,
      roomNumber: '',
      jamaat: '',
      hofId: '',
      moneyGiven: 'No',
    }),
    [defaultBuilding, defaultCategory]
  );

  // Initialize ONLY when modal transitions from closed -> open
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setTourRefNo('');
      setOfficeName(existingOffices[0] || 'Fayz E Husayni Trust Mumbai');
      setArrivalDate(todayStr);
      setArrivalTime(SUBVENUE_ARRIVAL_TIME);
      setDepartureDate(defaultDepartureStr);
      setDepartureTime(SUBVENUE_DEPARTURE_TIME);
      setGroupLeadName('');
      const initialCat = categories[0] || 'Mumineen';
      setDefaultCategory(initialCat);
      setDefaultBuilding('Saifee');
      setBatchRoomNumber('');
      setIsPasteOpen(true);
      setPasteRawText('');
      setPasteFamilyMode('separate');
      setPasteSameFamilyId('101');
      setPasteNotice(null);
      setErrorMsg('');
      setRows([createNewRow('101', 'Saifee', initialCat)]);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, existingOffices, categories, todayStr, defaultDepartureStr, createNewRow]);

  // Autofill Tour metadata when picking an existing Tour ID
  const handleSelectTour = (tid: string) => {
    setTourRefNo(tid);
    const trimmed = tid.trim().toLowerCase();
    if (!trimmed) return;
    const match = existingReservations.find(
      (r) => (r.tourRefNo || r.tourId || '').trim().toLowerCase() === trimmed
    );
    if (match) {
      if (match.officeName) setOfficeName(match.officeName);
      if (match.groupLeadName) setGroupLeadName(match.groupLeadName);
      if (match.arrivalDate) setArrivalDate(match.arrivalDate.slice(0, 10));
      if (match.departureDate) setDepartureDate(match.departureDate.slice(0, 10));
      if (match.arrivalTime) setArrivalTime(match.arrivalTime);
      if (match.departureTime) setDepartureTime(match.departureTime);
    }
  };

  // Live nights calculation
  const calculatedNights = useMemo(() => {
    if (!arrivalDate || !departureDate) return 1;
    const d1 = new Date(arrivalDate);
    const d2 = new Date(departureDate);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
    return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000));
  }, [arrivalDate, departureDate]);

  // Vacant rooms helper for any building
  const getVacantRoomsForBuilding = useCallback(
    (bldg: string) => {
      if (!arrivalDate || !departureDate) return [];
      return getVacantRoomsForDuration(bldg, arrivalDate, departureDate, rooms, existingReservations);
    },
    [arrivalDate, departureDate, rooms, existingReservations]
  );

  // Live preview of bulk paste input
  const parsedPastePreview = useMemo(() => {
    return parseBulkTourPaste(pasteRawText, existingReservations, {
      defaultBuilding,
      defaultCategory,
    });
  }, [pasteRawText, existingReservations, defaultBuilding, defaultCategory]);

  // Helper to get next numeric family string based on current rows
  const getNextFamilyStart = (currentRows: TourIndividualRow[]): number => {
    let maxNum = 100;
    for (const r of currentRows) {
      const m = (r.family || '').match(/\d+/);
      if (m) {
        const n = parseInt(m[0], 10);
        if (!isNaN(n) && n > maxNum && n < 100000) maxNum = n;
      }
    }
    return maxNum + 1;
  };

  const isBlankRow = (r: TourIndividualRow) =>
    !r.itsId.trim() && !r.applicantName.trim() && !r.roomNumber.trim();

  // Apply parsed paste entries into the rows list stably
  const applyParsedEntries = (
    rawInput: string,
    insertAtRowIndex?: number
  ) => {
    const parsed = parseBulkTourPaste(rawInput, existingReservations, {
      defaultBuilding,
      defaultCategory,
    });

    if (parsed.entries.length === 0) {
      setErrorMsg(
        'No ITS numbers found in the pasted text. Paste 7 to 9 digit ITS numbers (one per line, or separated by spaces or commas) or spreadsheet rows.'
      );
      return false;
    }

    setErrorMsg('');

    setRows((prev) => {
      const existingNormIts = new Set(
        prev.map((r) => normalizeItsId(r.itsId)).filter(Boolean)
      );

      // Remove completely empty starter rows when inserting via bulk box
      const baseRows =
        insertAtRowIndex === undefined
          ? prev.filter((r) => !isBlankRow(r))
          : [...prev];

      let nextFamCounter = getNextFamilyStart(baseRows);
      const newRows: TourIndividualRow[] = [];
      let skippedAlreadyInList = 0;

      for (let i = 0; i < parsed.entries.length; i++) {
        const entry = parsed.entries[i];
        const norm = normalizeItsId(entry.itsId);

        // If inserting directly into row `insertAtRowIndex`, keep the targeted row slot if it was empty
        const overwritingCurrentRow = insertAtRowIndex !== undefined && i === 0;
        if (
          norm &&
          existingNormIts.has(norm) &&
          !(overwritingCurrentRow && normalizeItsId(prev[insertAtRowIndex]?.itsId) === norm)
        ) {
          skippedAlreadyInList++;
          continue;
        }
        if (norm) existingNormIts.add(norm);

        let fam = entry.family;
        if (pasteFamilyMode === 'same') {
          fam = pasteSameFamilyId.trim() || '101';
        } else if (pasteFamilyMode === 'separate' || !fam) {
          fam = String(nextFamCounter++);
        }

        const builtRow: TourIndividualRow = {
          id:
            overwritingCurrentRow && prev[insertAtRowIndex]
              ? prev[insertAtRowIndex].id
              : `row-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`,
          family: fam,
          itsId: entry.itsId,
          applicantName: entry.applicantName,
          age: entry.age || '35',
          gender: entry.gender || 'Male',
          category: entry.category || defaultCategory,
          building: entry.building || defaultBuilding,
          roomNumber: entry.roomNumber || batchRoomNumber || '',
          jamaat: entry.jamaat || '',
          hofId: entry.hofId || '',
          moneyGiven: 'No',
          matchedFromHistory: entry.matchedFromHistory,
        };

        newRows.push(builtRow);
      }

      if (newRows.length === 0) {
        setPasteNotice(
          `All ${parsed.entries.length} pasted ITS numbers are already in the list.`
        );
        return prev;
      }

      const skippedTotal = parsed.duplicatesSkipped + skippedAlreadyInList;
      setPasteNotice(
        `Added ${newRows.length} zaereen${
          parsed.autoMatchedCount > 0 ? ` (${parsed.autoMatchedCount} auto-filled from saved records)` : ''
        }${skippedTotal > 0 ? ` · ${skippedTotal} duplicate ITS skipped` : ''}.`
      );

      if (insertAtRowIndex !== undefined && prev[insertAtRowIndex]) {
        const before = baseRows.slice(0, insertAtRowIndex);
        const after = baseRows.slice(insertAtRowIndex + 1);
        return [...before, ...newRows, ...after];
      }

      return [...baseRows, ...newRows];
    });

    return true;
  };

  const handleApplyBulkPaste = () => {
    if (!pasteRawText.trim()) return;
    const ok = applyParsedEntries(pasteRawText);
    if (ok) {
      setPasteRawText('');
    }
  };

  // Direct paste inside any row's ITS input:
  // If multi-ITS or multi-line/tabbed text is pasted, expand cleanly into rows!
  const handleRowItsPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    rowIndex: number,
    rowId: string
  ) => {
    const raw = cleanClipboardText(e.clipboardData.getData('text') || '');
    if (!raw) return;

    const multiTokens = raw.match(/\b\d{7,10}\b/g) || [];
    const looksMulti = raw.includes('\n') || raw.includes('\t') || multiTokens.length > 1;

    if (looksMulti) {
      e.preventDefault();
      applyParsedEntries(raw, rowIndex);
      return;
    }

    // Single ITS pasted: clean quotes/spaces & autofill from history if blank
    e.preventDefault();
    const cleanedSingle = raw.replace(/^['"’‘#]+|['"’‘]+$/g, '').replace(/\s+/g, '');
    handleUpdateRow(rowId, 'itsId', cleanedSingle);
  };

  // Individual row field update (with smart auto-fill when typing a valid 7-9 digit ITS)
  const handleUpdateRow = (rowId: string, field: keyof TourIndividualRow, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const updated: TourIndividualRow = { ...r, [field]: value };

        if (field === 'building') {
          updated.roomNumber = '';
        }

        if (field === 'itsId') {
          const cleanIts = cleanClipboardText(value).replace(/^['"’‘#]+|['"’‘]+$/g, '').trim();
          updated.itsId = cleanIts;
          const norm = normalizeItsId(cleanIts);
          if (norm.length >= 7) {
            const match = existingByIts.get(norm);
            if (match) {
              updated.matchedFromHistory = true;
              if (!r.applicantName.trim() && match.applicantName) {
                updated.applicantName = match.applicantName;
              }
              if ((!r.age || r.age === '35') && match.age) {
                updated.age = String(match.age);
              }
              const normGender = normalizeGender(match.gender);
              if (normGender) {
                updated.gender = normGender;
              }
              if (!r.jamaat && match.jamaat) {
                updated.jamaat = match.jamaat;
              }
              if (!r.hofId && match.hofId) {
                updated.hofId = match.hofId;
              }
            } else {
              updated.matchedFromHistory = false;
            }
          }
        }

        return updated;
      })
    );
  };

  // Add single / multiple individuals
  const handleAddIndividual = (sameFamilyAsLast: boolean = false) => {
    const lastFamily = rows.length > 0 ? rows[rows.length - 1].family : '101';
    let nextFamily = lastFamily;
    if (!sameFamilyAsLast) {
      const numMatch = lastFamily.match(/\d+/);
      if (numMatch) {
        const nextNum = parseInt(numMatch[0], 10) + 1;
        nextFamily = lastFamily.replace(/\d+/, String(nextNum));
      } else {
        nextFamily = String(getNextFamilyStart(rows));
      }
    }
    setRows((prev) => [...prev, createNewRow(nextFamily, defaultBuilding, defaultCategory)]);
  };

  const handleAddMultiple = (count: number = 5) => {
    let baseNum = getNextFamilyStart(rows);
    const newItems: TourIndividualRow[] = [];
    for (let i = 0; i < count; i++) {
      newItems.push(createNewRow(String(baseNum++), defaultBuilding, defaultCategory));
    }
    setRows((prev) => [...prev, ...newItems]);
  };

  const handleDuplicateRow = (row: TourIndividualRow) => {
    const newRow: TourIndividualRow = {
      ...createNewRow(row.family, row.building, row.category),
      jamaat: row.jamaat,
      hofId: row.itsId || row.hofId,
      roomNumber: row.roomNumber,
    };
    setRows((prev) => [...prev, newRow]);
  };

  const handleRemoveRow = (rowId: string) => {
    if (rows.length <= 1) {
      setRows([createNewRow('101', defaultBuilding, defaultCategory)]);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Apply selected default building & optional room to all rows in 1 click
  const handleApplyBatchHotelRoom = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        building: defaultBuilding,
        roomNumber: batchRoomNumber || r.roomNumber,
      }))
    );
    setPasteNotice(
      batchRoomNumber
        ? `Applied ${defaultBuilding} room ${batchRoomNumber} to all ${rows.length} rows.`
        : `Set the building to ${defaultBuilding} for all ${rows.length} rows.`
    );
  };

  // Put all rows under one Family ID in 1 click
  const handleSetAllSameFamily = () => {
    const targetFam = pasteSameFamilyId.trim() || rows[0]?.family || '101';
    setRows((prev) => prev.map((r) => ({ ...r, family: targetFam })));
    setPasteNotice(`Grouped all ${rows.length} rows into family ${targetFam}.`);
  };

  // Metrics summary
  const uniqueFamiliesCount = useMemo(() => {
    return new Set(rows.map((r) => r.family.trim()).filter(Boolean)).size;
  }, [rows]);

  const allottedCount = useMemo(() => {
    return rows.filter((r) => r.roomNumber && r.roomNumber.trim() !== '').length;
  }, [rows]);

  // Accurate duplicate detection:
  // - Hard error only for duplicate ITS within this batch or ITS already in THIS exact Tour ID.
  // - Returning ITS from another tour is allowed & shown as info.
  const rowChecks = useMemo(() => {
    const batchErrors: Record<string, string> = {};
    const sameTourConflicts: Record<string, string> = {};
    const seenIts = new Map<string, number>();
    const currentTourNorm = tourRefNo.trim().toLowerCase();

    rows.forEach((r, idx) => {
      const its = normalizeItsId(r.itsId);
      if (!its) return;

      if (seenIts.has(its)) {
        batchErrors[r.id] = `Same ITS as row ${seenIts.get(its)}`;
        return;
      }
      seenIts.set(its, idx + 1);

      if (currentTourNorm) {
        const sameTourMatch = existingReservations.find(
          (other) =>
            normalizeItsId(other.itsId) === its &&
            (other.tourRefNo || other.tourId || '').trim().toLowerCase() === currentTourNorm
        );
        if (sameTourMatch) {
          sameTourConflicts[r.id] = `Already in tour ${sameTourMatch.tourRefNo}`;
        }
      }
    });

    const duplicateRowCount = Object.keys(batchErrors).length;
    const sameTourConflictCount = Object.keys(sameTourConflicts).length;

    return { batchErrors, sameTourConflicts, duplicateRowCount, sameTourConflictCount };
  }, [rows, existingReservations, tourRefNo]);

  const handleRemoveDuplicateRows = () => {
    const seen = new Set<string>();
    const kept: TourIndividualRow[] = [];
    let removed = 0;

    for (const r of rows) {
      const norm = normalizeItsId(r.itsId);
      if (norm && seen.has(norm)) {
        removed++;
        continue;
      }
      if (norm) seen.add(norm);
      kept.push(r);
    }

    setRows(kept.length > 0 ? kept : [createNewRow('101', defaultBuilding, defaultCategory)]);
    setPasteNotice(`Removed ${removed} duplicate row${removed === 1 ? '' : 's'}.`);
  };

  // Submission handler
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanTour = tourRefNo.trim();
    if (!cleanTour) {
      setErrorMsg(MSG_TOUR);
      return;
    }

    if (!arrivalDate || !departureDate) {
      setErrorMsg('Arrival and departure dates are both needed.');
      return;
    }

    if (departureDate < arrivalDate) {
      setErrorMsg(MSG_DATES);
      return;
    }

    // Filter out untouched blank trailing rows if at least 1 real row exists
    const nonBlankRows = rows.filter((r) => !isBlankRow(r));
    if (nonBlankRows.length === 0) {
      setErrorMsg('Paste ITS numbers or enter at least one zair to save this tour.');
      return;
    }

    if (rowChecks.duplicateRowCount > 0) {
      setErrorMsg(
        `There are ${rowChecks.duplicateRowCount} duplicate ITS entries in the list. Press "Remove duplicates" or fix them before saving.`
      );
      return;
    }

    const newReservations: Reservation[] = [];
    const nowIso = new Date().toISOString();

    for (let i = 0; i < nonBlankRows.length; i++) {
      const r = nonBlankRows[i];
      const fam = r.family.trim() || String(i + 1);
      const its = cleanClipboardText(r.itsId).replace(/^['"’‘#]+|['"’‘]+$/g, '').trim();
      const name = r.applicantName.trim() || (its ? `Zaer ITS ${its}` : '');

      if (!name) {
        setErrorMsg(`Row ${i + 1}: enter an ITS or a name.`);
        return;
      }

      if (rowChecks.sameTourConflicts[r.id]) {
        setErrorMsg(
          `Row ${i + 1}: ITS ${its} is already in tour ${cleanTour}. Remove or edit it before saving.`
        );
        return;
      }

      const rawArr = `${arrivalDate} ${arrivalTime || SUBVENUE_ARRIVAL_TIME}`.trim();
      const rawDep = `${departureDate} ${departureTime || SUBVENUE_DEPARTURE_TIME}`.trim();
      const chosenBuilding = normalizeBuildingName(r.building || defaultBuilding) || 'Saifee';
      const chosenRoom = normalizeRoomNumber(r.roomNumber);

      const isBToA = r.category === 'B to A' || r.category?.toLowerCase().includes('b to a');

      const reservation: Reservation = {
        id: `res-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 8)}`,
        itsId: its || `ITS-${Math.floor(10000000 + Math.random() * 90000000)}`,
        applicantName: name,
        age: r.age ? parseInt(r.age, 10) || r.age : 35,
        jamaat: r.jamaat || '',
        category: r.category || defaultCategory || 'Mumineen',
        gender: r.gender,
        family: fam,
        idara: '',
        hofId: r.hofId || (r.gender === 'Male' ? its : ''),
        tourRefNo: cleanTour,
        tourId: cleanTour,
        officeName: officeName.trim() || 'Fayz E Husayni Trust Mumbai',
        groupLeadName: groupLeadName.trim() || name,
        arrivalDate,
        departureDate,
        rawArrivalStr: rawArr,
        rawDepartureStr: rawDep,
        arrivalTime: arrivalTime || SUBVENUE_ARRIVAL_TIME,
        departureTime: departureTime || SUBVENUE_DEPARTURE_TIME,
        arrivalDateTime: `${arrivalDate}T${(arrivalTime || SUBVENUE_ARRIVAL_TIME).replace(/\s+/g, '')}`,
        departureDateTime: `${departureDate}T${(departureTime || SUBVENUE_DEPARTURE_TIME).replace(/\s+/g, '')}`,
        building: chosenBuilding,
        roomNumber: chosenRoom,
        shiftToCategoryA: Boolean(isBToA),
        accommodationCategory: isBToA ? 'Category A (Nizaam)' : 'Category B (Standard)',
        moneyGiven: r.moneyGiven || 'No',
        moneyGivenDate: r.moneyGiven === 'Yes' ? todayStr : undefined,
        isUploadedToPortal: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      newReservations.push(reservation);
    }

    const success = onAddTourBatch(newReservations);
    if (success !== false) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const activeDefaultVacantRooms = getVacantRoomsForBuilding(defaultBuilding);
  const readyCount = rows.filter((r) => !isBlankRow(r)).length;

  // After a failed save, point at the fields that caused it.
  const tourMissing = !!errorMsg && !tourRefNo.trim();
  const datesWrong = !!errorMsg && !!arrivalDate && !!departureDate && departureDate < arrivalDate;
  // A message about one field goes away once that field is put right; the next save checks again.
  const shownError =
    (errorMsg === MSG_TOUR && tourRefNo.trim()) || (errorMsg === MSG_DATES && !datesWrong) ? '' : errorMsg;
  const hasProblems = !!shownError || rowChecks.duplicateRowCount > 0 || rowChecks.sameTourConflictCount > 0;

  return (
    <div className={modalScrim}>
      <div className={`${modalCard} max-w-6xl`} role="dialog" aria-modal="true" aria-labelledby="add-tour-title">
        <div className={modalHeader}>
          <div className="min-w-0">
            <h3 id="add-tour-title" className={modalTitle}>
              Add tour group
            </h3>
            <p className="mt-1 text-sm text-stone-600">
              Enter the Tour ID and dates once, then paste everyone’s ITS numbers or add them row by row.
            </p>
          </div>
          <button type="button" onClick={onClose} className={`${modalClose} max-sm:w-10 max-sm:h-10`} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-8">
            {/* 1. Tour details */}
            <section>
              <h4 className={groupTitle}>1. Tour details</h4>
              <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="col-span-2">
                  <label htmlFor="tg-tour" className={fieldLabel}>
                    Tour ID
                    <Required />
                  </label>
                  <input
                    id="tg-tour"
                    type="text"
                    required
                    list="existing-tour-ids-list"
                    placeholder="New Tour ID, or pick one already in the list"
                    value={tourRefNo}
                    onChange={(e) => handleSelectTour(e.target.value)}
                    aria-invalid={tourMissing}
                    className={`${field} tabular-nums${tourMissing ? ' aria-invalid:border-rose-400' : ''}`}
                  />
                  <datalist id="existing-tour-ids-list">
                    {existingTourIds.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                  {tourMissing ? (
                    <p className={errorText}>{MSG_TOUR}</p>
                  ) : (
                    existingTourIds.length > 0 && (
                      <p className={helpText}>
                        {existingTourIds.length} tours in the list. Choosing one fills in its office and dates.
                      </p>
                    )
                  )}
                </div>

                <div className="col-span-2">
                  <label htmlFor="tg-office" className={fieldLabel}>
                    Office
                    <Required />
                  </label>
                  <input
                    id="tg-office"
                    type="text"
                    required
                    list="existing-offices-list"
                    placeholder="Fayz E Husayni Trust Mumbai"
                    value={officeName}
                    onChange={(e) => setOfficeName(e.target.value)}
                    className={field}
                  />
                  <datalist id="existing-offices-list">
                    {existingOffices.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label htmlFor="tg-arr-date" className={fieldLabel}>
                    Arrival date
                    <Required />
                  </label>
                  <input
                    id="tg-arr-date"
                    type="date"
                    required
                    value={arrivalDate}
                    onChange={(e) => setArrivalDate(e.target.value)}
                    className={`${field} tabular-nums cursor-pointer`}
                  />
                </div>
                <div>
                  <label htmlFor="tg-arr-time" className={fieldLabel}>
                    Arrival time
                  </label>
                  <input
                    id="tg-arr-time"
                    type="text"
                    placeholder="10:00 AM"
                    value={arrivalTime}
                    onChange={(e) => setArrivalTime(e.target.value)}
                    className={`${field} tabular-nums`}
                  />
                </div>
                <div>
                  <label htmlFor="tg-dep-date" className={fieldLabel}>
                    Departure date
                    <Required />
                  </label>
                  <input
                    id="tg-dep-date"
                    type="date"
                    required
                    value={departureDate}
                    onChange={(e) => setDepartureDate(e.target.value)}
                    aria-invalid={datesWrong}
                    className={`${field} tabular-nums cursor-pointer${datesWrong ? ' aria-invalid:border-rose-400' : ''}`}
                  />
                  {datesWrong && <p className={errorText}>Cannot be before the arrival date.</p>}
                </div>
                <div>
                  <label htmlFor="tg-dep-time" className={fieldLabel}>
                    Departure time
                  </label>
                  <input
                    id="tg-dep-time"
                    type="text"
                    placeholder="08:00 AM"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className={`${field} tabular-nums`}
                  />
                </div>

                <p className="col-span-full -mt-1.5 text-xs text-stone-500 tabular-nums">
                  <span className="font-medium text-stone-700">
                    {calculatedNights} night{calculatedNights === 1 ? '' : 's'}
                  </span>
                  . Vacant for these dates:{' '}
                  {distinctBuildings.map((bldg, idx) => (
                    <span key={bldg}>
                      <span className="font-medium text-stone-700">{getVacantRoomsForBuilding(bldg).length}</span> {bldg}
                      {idx < distinctBuildings.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                  .
                </p>

                <div className="col-span-2">
                  <label htmlFor="tg-lead" className={fieldLabel}>
                    Group lead <span className="font-normal text-stone-500">(optional)</span>
                  </label>
                  <input
                    id="tg-lead"
                    type="text"
                    placeholder="Mulla Shabbir"
                    value={groupLeadName}
                    onChange={(e) => setGroupLeadName(e.target.value)}
                    className={field}
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="tg-category" className={fieldLabel}>
                    Default category
                  </label>
                  <select
                    id="tg-category"
                    value={defaultCategory}
                    onChange={(e) => setDefaultCategory(e.target.value)}
                    className={field}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2 lg:col-span-1">
                  <label htmlFor="tg-building" className={fieldLabel}>
                    Default building
                  </label>
                  <select
                    id="tg-building"
                    value={defaultBuilding}
                    onChange={(e) => {
                      setDefaultBuilding(e.target.value);
                      setBatchRoomNumber('');
                    }}
                    className={field}
                  >
                    {distinctBuildings.map((bldg) => (
                      <option key={bldg} value={bldg}>
                        {bldg}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 lg:col-span-3">
                  <label htmlFor="tg-room" className={fieldLabel}>
                    Room for everyone <span className="font-normal text-stone-500">(optional)</span>
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      id="tg-room"
                      value={batchRoomNumber}
                      onChange={(e) => setBatchRoomNumber(e.target.value)}
                      className={`${field} tabular-nums sm:flex-1`}
                    >
                      <option value="">Allot rooms later (unallotted)</option>
                      {activeDefaultVacantRooms.map((rm) => (
                        <option key={rm.id} value={rm.roomNumber}>
                          Room {rm.roomNumber} (sleeps {rm.capacity})
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={handleApplyBatchHotelRoom} className={`${btn.secondary} shrink-0`}>
                      Apply to all rows
                    </button>
                  </div>
                </div>
                <p className="col-span-full -mt-1.5 text-xs text-stone-500">
                  New rows start in the default building. “Apply to all rows” sets that building on every row, and the
                  room too if one is chosen.
                </p>
              </div>
            </section>

            {/* 2. Members */}
            <section>
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-2 border-b border-stone-200">
                <h4 className="text-[15px] font-semibold text-stone-950">
                  2. Members <span className="font-normal text-stone-500 tabular-nums">({rows.length})</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setIsPasteOpen((v) => !v)}
                  aria-expanded={isPasteOpen}
                  aria-controls="tg-paste-block"
                  className={`${btnSm.secondary} max-sm:h-10`}
                >
                  <ClipboardPaste className="w-4 h-4" />
                  {isPasteOpen ? 'Hide paste box' : 'Paste ITS numbers'}
                </button>
              </div>

              {/* Paste from a list or a spreadsheet */}
              {isPasteOpen && (
                <div id="tg-paste-block" className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-4">
                  <div className="lg:col-span-2">
                    <label htmlFor="tg-paste" className={fieldLabel}>
                      Paste ITS numbers or spreadsheet rows
                    </label>
                    <textarea
                      id="tg-paste"
                      rows={6}
                      value={pasteRawText}
                      onChange={(e) => setPasteRawText(e.target.value)}
                      placeholder={'30318214\n20491822, 40581920\n30318214\tMulla Shabbir Bhai\t48\tM\t101'}
                      className="block w-full min-h-[132px] rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-stone-900 tabular-nums placeholder:text-stone-400 resize-y"
                    />
                    <div className="mt-1.5">
                      <p className="min-h-[18px] text-xs text-stone-600 tabular-nums" aria-live="polite">
                        {pasteRawText.trim() ? (
                          <>
                            Found <span className="font-semibold text-stone-950">{parsedPastePreview.entries.length}</span> ITS
                            {parsedPastePreview.autoMatchedCount > 0 && (
                              <span className="text-emerald-700">
                                {' '}
                                · {parsedPastePreview.autoMatchedCount} matched from records
                              </span>
                            )}
                            {parsedPastePreview.duplicatesSkipped > 0 && (
                              <span className="text-amber-800">
                                {' '}
                                · {parsedPastePreview.duplicatesSkipped} duplicate skipped
                              </span>
                            )}
                            {parsedPastePreview.invalidTokens.length > 0 && (
                              <span className="text-rose-700">
                                {' '}
                                · {parsedPastePreview.invalidTokens.length} non-ITS number(s) ignored
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-stone-500">
                            You can also paste several ITS lines straight into any ITS box in the table below.
                          </span>
                        )}
                      </p>
                    </div>

                    <p className={`${fieldLabel} mt-4`} id="tg-famid-label">
                      Family IDs for pasted rows
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className={segWrap} role="group" aria-labelledby="tg-famid-label">
                            <button
                              type="button"
                              onClick={() => setPasteFamilyMode('separate')}
                              aria-pressed={pasteFamilyMode === 'separate'}
                              className={segBtn(pasteFamilyMode === 'separate')}
                            >
                              Separate
                            </button>
                            <button
                              type="button"
                              onClick={() => setPasteFamilyMode('same')}
                              aria-pressed={pasteFamilyMode === 'same'}
                              className={segBtn(pasteFamilyMode === 'same')}
                            >
                              Same family
                            </button>
                            <button
                              type="button"
                              onClick={() => setPasteFamilyMode('pasted')}
                              aria-pressed={pasteFamilyMode === 'pasted'}
                              className={segBtn(pasteFamilyMode === 'pasted')}
                            >
                              From sheet
                            </button>
                          </div>
                          {pasteFamilyMode === 'same' && (
                            <input
                              type="text"
                              value={pasteSameFamilyId}
                              onChange={(e) => setPasteSameFamilyId(e.target.value)}
                              placeholder="101"
                              aria-label="Family ID for all pasted rows"
                              title="Family ID assigned to all pasted rows"
                              className={`${field.replace('w-full', 'w-20')} tabular-nums`}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-auto">
                        {pasteRawText && (
                          <button type="button" onClick={() => setPasteRawText('')} className={btn.ghost}>
                            Clear box
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={parsedPastePreview.entries.length === 0}
                          onClick={handleApplyBulkPaste}
                          className={btn.primary}
                        >
                          <Wand2 className="w-4 h-4" />
                          Add {parsedPastePreview.entries.length || ''} to list
                        </button>
                      </div>
                    </div>
                    <p className={helpText}>
                      {pasteFamilyMode === 'separate'
                        ? 'Each pasted zair gets the next family number.'
                        : pasteFamilyMode === 'same'
                        ? 'Everyone pasted goes into this one family.'
                        : 'Uses the family column from the sheet. Rows without one get the next number.'}
                    </p>
                  </div>

                  <div>
                    <div className={`${panel} px-4 py-3`}>
                      <p className="text-[13px] font-semibold text-stone-900">What you can paste</p>
                      <p className="mt-1 text-xs leading-relaxed text-stone-600">
                        ITS numbers, one per line or separated by spaces or commas. Or rows copied from a spreadsheet,
                        with columns like these:
                      </p>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-left text-xs tabular-nums">
                          <thead className="text-stone-500">
                            <tr>
                              <th className="pr-3 py-1 font-medium">ITS</th>
                              <th className="pr-3 py-1 font-medium">Name</th>
                              <th className="pr-3 py-1 font-medium">Age</th>
                              <th className="pr-3 py-1 font-medium">Gender</th>
                              <th className="py-1 font-medium">Family</th>
                            </tr>
                          </thead>
                          <tbody className="text-stone-800">
                            <tr className="border-t border-stone-200">
                              <td className="pr-3 py-1">30318214</td>
                              <td className="pr-3 py-1 whitespace-nowrap">Mulla Shabbir Bhai</td>
                              <td className="pr-3 py-1">48</td>
                              <td className="pr-3 py-1">M</td>
                              <td className="py-1">101</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-stone-600">
                        Keep the header row and Building, Room, Category, Jamaat and HOF columns are read too. Names fill
                        in from saved records when the ITS is known.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {pasteNotice && (
                <div
                  role="status"
                  className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-emerald-50 ring-1 ring-inset ring-emerald-200 pl-4 pr-1.5 py-1 text-[13px] text-emerald-800"
                >
                  <span className="flex items-center gap-2 py-1.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{pasteNotice}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setPasteNotice(null)}
                    aria-label="Dismiss"
                    className="w-8 h-8 max-sm:w-10 max-sm:h-10 shrink-0 rounded-lg flex items-center justify-center hover:bg-emerald-100 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Members table */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="text-[13px] text-stone-600 tabular-nums">
                  <span className="font-semibold text-stone-950">{readyCount}</span> ready ·{' '}
                  <span className="font-semibold text-stone-950">{uniqueFamiliesCount}</span>{' '}
                  {uniqueFamiliesCount === 1 ? 'family' : 'families'} ·{' '}
                  <span className="font-semibold text-stone-950">{allottedCount}</span> with rooms
                  {rowChecks.duplicateRowCount > 0 && (
                    <span className="font-medium text-rose-700"> · {rowChecks.duplicateRowCount} duplicate ITS</span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {rowChecks.duplicateRowCount > 0 && (
                    <button type="button" onClick={handleRemoveDuplicateRows} className={`${btnSm.danger} max-sm:h-10`}>
                      <Trash2 className="w-4 h-4" />
                      Remove duplicates ({rowChecks.duplicateRowCount})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSetAllSameFamily}
                    className={`${btnSm.secondary} max-sm:h-10`}
                    title="Put everyone in this list under one Family ID"
                  >
                    <Users className="w-4 h-4" />
                    Group all as one family
                  </button>
                </div>
              </div>

              <div className="mt-2 rounded-xl ring-1 ring-inset ring-stone-200 overflow-x-auto md:max-h-[min(52dvh,480px)] md:overflow-y-auto">
                <table className="w-full md:min-w-[940px] text-left text-[13px] border-collapse max-md:block">
                  <thead className="max-md:hidden bg-stone-50 text-xs font-semibold text-stone-600 sticky top-0 z-10 [&_th]:bg-stone-50 [&_th]:shadow-[inset_0_-1px_0_var(--color-stone-200)]">
                    <tr>
                      <th scope="col" className="py-2.5 pl-3 pr-2 w-10 font-semibold text-right">
                        #
                      </th>
                      <th scope="col" className="py-2.5 px-2 w-[8%] font-semibold">
                        Family
                      </th>
                      <th scope="col" className="py-2.5 px-2 w-[12%] font-semibold">
                        ITS
                      </th>
                      <th scope="col" className="py-2.5 px-2 font-semibold">
                        Name
                      </th>
                      <th scope="col" className="py-2.5 px-2 w-[72px] font-semibold">
                        Age
                      </th>
                      <th scope="col" className="py-2.5 px-2 w-[104px] font-semibold">
                        Gender
                      </th>
                      <th scope="col" className="py-2.5 px-2 w-[22%] font-semibold">
                        Building and room
                      </th>
                      <th scope="col" className="py-2.5 px-2 w-[11%] font-semibold">
                        Category
                      </th>
                      <th scope="col" className="py-2.5 pl-2 pr-3 w-[88px] font-semibold">
                        <span className="sr-only">Row actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="max-md:block divide-y divide-stone-200">
                    {rows.map((row, idx) => {
                      const batchErr = rowChecks.batchErrors[row.id];
                      const tourConflict = rowChecks.sameTourConflicts[row.id];
                      const activeVacantRooms = getVacantRoomsForBuilding(row.building);
                      const n = idx + 1;

                      return (
                        <tr
                          key={row.id}
                          className={`max-md:grid max-md:grid-cols-6 max-md:gap-x-2 max-md:gap-y-2.5 max-md:px-3 max-md:py-3 align-top ${
                            batchErr || tourConflict ? 'bg-rose-50/70' : 'bg-white'
                          }`}
                        >
                          <td className="max-md:order-1 max-md:col-span-3 max-md:flex max-md:items-center md:py-2 md:pl-3 md:pr-2 md:pt-[17px] md:text-right text-stone-500 tabular-nums">
                            <span className="md:hidden text-[13px] font-semibold text-stone-900">Zair {n}</span>
                            <span className="max-md:hidden">{n}</span>
                          </td>

                          <td className="max-md:order-3 max-md:col-span-2 max-md:block md:py-2 md:px-2">
                            <span className={cellLabel}>Family</span>
                            <input
                              type="text"
                              placeholder="101"
                              aria-label={`Family, row ${n}`}
                              value={row.family}
                              onChange={(e) => handleUpdateRow(row.id, 'family', e.target.value)}
                              className={`${cell} tabular-nums`}
                            />
                          </td>

                          <td className="max-md:order-3 max-md:col-span-4 max-md:block md:py-2 md:px-2">
                            <span className={cellLabel}>ITS</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="30318214"
                              aria-label={`ITS, row ${n}`}
                              aria-invalid={!!(batchErr || tourConflict)}
                              value={row.itsId}
                              onChange={(e) => handleUpdateRow(row.id, 'itsId', e.target.value)}
                              onPaste={(e) => handleRowItsPaste(e, idx, row.id)}
                              className={`${cell} tabular-nums${batchErr || tourConflict ? ' aria-invalid:border-rose-400' : ''}`}
                              title="Enter an 8-digit ITS, or paste several ITS numbers here"
                            />
                            {(batchErr || tourConflict) && (
                              <div className="mt-1 text-xs leading-tight text-rose-700">{batchErr || tourConflict}</div>
                            )}
                            {!batchErr && !tourConflict && row.matchedFromHistory && (
                              <div className="mt-1 text-xs leading-tight text-emerald-700">Matched from records</div>
                            )}
                          </td>

                          <td className="max-md:order-3 max-md:col-span-6 max-md:block md:py-2 md:px-2">
                            <span className={cellLabel}>Name</span>
                            <input
                              type="text"
                              placeholder={row.itsId ? 'Optional, fills in if known' : 'Full name'}
                              aria-label={`Name, row ${n}`}
                              value={row.applicantName}
                              onChange={(e) => handleUpdateRow(row.id, 'applicantName', e.target.value)}
                              className={cell}
                            />
                          </td>

                          <td className="max-md:order-3 max-md:col-span-2 max-md:block md:py-2 md:px-2">
                            <span className={cellLabel}>Age</span>
                            <input
                              type="number"
                              min="0"
                              max="120"
                              aria-label={`Age, row ${n}`}
                              value={row.age}
                              onChange={(e) => handleUpdateRow(row.id, 'age', e.target.value)}
                              className={`${cell} tabular-nums`}
                            />
                          </td>

                          <td className="max-md:order-3 max-md:col-span-4 max-md:block md:py-2 md:px-2">
                            <span className={cellLabel}>Gender</span>
                            <select
                              aria-label={`Gender, row ${n}`}
                              value={row.gender}
                              onChange={(e) => handleUpdateRow(row.id, 'gender', e.target.value)}
                              className={cell}
                            >
                              <option value="Male">Male</option>
                              <option value="Female">Female</option>
                            </select>
                          </td>

                          <td className="max-md:order-3 max-md:col-span-6 max-md:block md:py-2 md:px-2">
                            <span className={cellLabel}>Building and room</span>
                            <div className="flex items-center gap-1.5">
                              <select
                                aria-label={`Building, row ${n}`}
                                value={row.building}
                                onChange={(e) => handleUpdateRow(row.id, 'building', e.target.value)}
                                className={`${cell} flex-1 min-w-0`}
                              >
                                {distinctBuildings.map((bldg) => (
                                  <option key={bldg} value={bldg}>
                                    {bldg}
                                  </option>
                                ))}
                              </select>

                              <select
                                aria-label={`Room, row ${n}`}
                                value={row.roomNumber}
                                onChange={(e) => handleUpdateRow(row.id, 'roomNumber', e.target.value)}
                                className={`${cell} flex-1 min-w-0 tabular-nums ${
                                  row.roomNumber ? 'font-semibold text-stone-950' : 'text-stone-500'
                                }`}
                              >
                                <option value="">Unallotted</option>
                                {activeVacantRooms.map((rm) => (
                                  <option key={rm.id} value={rm.roomNumber}>
                                    Room {rm.roomNumber} ({rm.capacity})
                                  </option>
                                ))}
                                {row.roomNumber && !activeVacantRooms.some((r) => r.roomNumber === row.roomNumber) && (
                                  <option value={row.roomNumber}>Room {row.roomNumber}</option>
                                )}
                              </select>
                            </div>
                          </td>

                          <td className="max-md:order-3 max-md:col-span-6 max-md:block md:py-2 md:px-2">
                            <span className={cellLabel}>Category</span>
                            <select
                              aria-label={`Category, row ${n}`}
                              value={row.category}
                              onChange={(e) => handleUpdateRow(row.id, 'category', e.target.value)}
                              className={cell}
                            >
                              {categories.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="max-md:order-2 max-md:col-span-3 max-md:block md:py-2 md:pl-2 md:pr-3">
                            <div className="flex items-center justify-end gap-0.5">
                              <button
                                type="button"
                                onClick={() => handleDuplicateRow(row)}
                                className={iconBtn}
                                aria-label={`Add another member to the family of row ${n}`}
                                title="Add another member to the same family"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveRow(row.id)}
                                className={`${iconBtn} hover:text-rose-700 hover:bg-rose-50`}
                                aria-label={`Remove row ${n}`}
                                title="Remove row"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => handleAddIndividual(false)} className={`${btnSm.secondary} max-sm:h-10`}>
                  <Plus className="w-4 h-4" />
                  New family zair
                </button>
                <button type="button" onClick={() => handleAddIndividual(true)} className={`${btnSm.secondary} max-sm:h-10`}>
                  <UserPlus className="w-4 h-4" />
                  Same family
                </button>
                <button type="button" onClick={() => handleAddMultiple(5)} className={`${btnSm.ghost} max-sm:h-10`}>
                  <Plus className="w-4 h-4" />5 rows
                </button>
              </div>
            </section>
          </div>

          {/* Problems that stop the save, gathered in one place */}
          {hasProblems && (
            <div
              role="alert"
              className="shrink-0 flex items-start gap-2.5 px-5 sm:px-6 py-3 border-t border-rose-200 bg-rose-50 text-[13px] text-rose-800 max-h-[26dvh] overflow-y-auto"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <ul className="min-w-0 flex-1 space-y-1">
                {shownError && <li className="font-medium">{shownError}</li>}
                {rowChecks.duplicateRowCount > 0 && (
                  <li>
                    {rowChecks.duplicateRowCount} duplicate ITS in the list. Remove {rowChecks.duplicateRowCount === 1 ? 'it' : 'them'} or
                    fix {rowChecks.duplicateRowCount === 1 ? 'it' : 'them'} before saving.
                  </li>
                )}
                {rowChecks.sameTourConflictCount > 0 && (
                  <li>
                    {rowChecks.sameTourConflictCount} ITS already in tour {tourRefNo.trim()}. Remove or edit{' '}
                    {rowChecks.sameTourConflictCount === 1 ? 'that row' : 'those rows'} before saving.
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className={`${modalFooter} sm:justify-between`}>
            <p className="max-sm:w-full text-[13px] text-stone-600 tabular-nums">
              <span className="font-semibold text-stone-950">{readyCount} zaereen</span> in{' '}
              <span className="font-semibold text-stone-950">
                {uniqueFamiliesCount} {uniqueFamiliesCount === 1 ? 'family' : 'families'}
              </span>{' '}
              for tour <span className="font-semibold text-stone-950">{tourRefNo.trim() || '—'}</span>
            </p>
            <div className="flex items-center gap-2 ml-auto">
              <button type="button" onClick={onClose} className={btn.ghost}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={readyCount === 0 || rowChecks.duplicateRowCount > 0}
                className={btn.primary}
              >
                <CheckCircle2 className="w-4 h-4" />
                Save tour group ({readyCount})
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
