import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Users,
  Plus,
  Trash2,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Copy,
  UserPlus,
  Hash,
  Briefcase,
  ClipboardPaste,
  Wand2,
  Building2,
} from 'lucide-react';
import { Reservation, Room, MoneyGivenStatus } from '../types';
import { normalizeItsId } from '../utils/deduplication';
import { getVacantRoomsForDuration, normalizeBuildingName, normalizeRoomNumber } from '../services/storage';
import { parseBulkTourPaste, cleanClipboardText, normalizeGender } from '../utils/itsPasteParser';

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
  const [arrivalTime, setArrivalTime] = useState('11:00 AM');
  const [departureDate, setDepartureDate] = useState(defaultDepartureStr);
  const [departureTime, setDepartureTime] = useState('01:00 AM');
  const [groupLeadName, setGroupLeadName] = useState('');
  const [defaultCategory, setDefaultCategory] = useState(categories[0] || 'Mumineen');

  // Strictly the 3 official buildings (Burhani, Saifee, Badri)
  const distinctBuildings = useMemo(() => ['Burhani', 'Saifee', 'Badri'] as const, []);
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
      setArrivalTime('11:00 AM');
      setDepartureDate(defaultDepartureStr);
      setDepartureTime('01:00 AM');
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
        'No valid ITS numbers found in pasted text. Paste 7–9 digit ITS numbers (one per line, space, or comma-separated) or Excel rows.'
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
          `All ${parsed.entries.length} pasted ITS IDs are already in the list above.`
        );
        return prev;
      }

      const skippedTotal = parsed.duplicatesSkipped + skippedAlreadyInList;
      setPasteNotice(
        `Added ${newRows.length} Zaereen${
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
        ? `Applied ${defaultBuilding} Room ${batchRoomNumber} to all ${rows.length} rows.`
        : `Set hotel to ${defaultBuilding} for all ${rows.length} rows.`
    );
  };

  // Put all rows under one Family ID in 1 click
  const handleSetAllSameFamily = () => {
    const targetFam = pasteSameFamilyId.trim() || rows[0]?.family || '101';
    setRows((prev) => prev.map((r) => ({ ...r, family: targetFam })));
    setPasteNotice(`Grouped all ${rows.length} rows into Family #${targetFam}.`);
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
        batchErrors[r.id] = `Duplicate in row #${seenIts.get(its)}`;
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
          sameTourConflicts[r.id] = `Already in Tour ${sameTourMatch.tourRefNo}`;
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
      setErrorMsg('Please enter a Tour ID / Reference Number.');
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

    // Filter out untouched blank trailing rows if at least 1 real row exists
    const nonBlankRows = rows.filter((r) => !isBlankRow(r));
    if (nonBlankRows.length === 0) {
      setErrorMsg('Paste ITS IDs or enter at least one Zair to save this tour.');
      return;
    }

    if (rowChecks.duplicateRowCount > 0) {
      setErrorMsg(
        `There are ${rowChecks.duplicateRowCount} duplicate ITS entries in the list. Click "Remove Duplicates" above or fix them before saving.`
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
        setErrorMsg(`Row #${i + 1}: Enter either an ITS ID or Applicant Name.`);
        return;
      }

      if (rowChecks.sameTourConflicts[r.id]) {
        setErrorMsg(
          `Row #${i + 1}: ITS ${its} is already present in Tour "${cleanTour}". Remove or edit it before saving.`
        );
        return;
      }

      const rawArr = `${arrivalDate} ${arrivalTime || '11:00 AM'}`.trim();
      const rawDep = `${departureDate} ${departureTime || '01:00 AM'}`.trim();
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
        arrivalTime: arrivalTime || '11:00 AM',
        departureTime: departureTime || '01:00 AM',
        arrivalDateTime: `${arrivalDate}T${(arrivalTime || '11:00 AM').replace(/\s+/g, '')}`,
        departureDateTime: `${departureDate}T${(departureTime || '01:00 AM').replace(/\s+/g, '')}`,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-950/45 backdrop-blur-[2px] animate-in fade-in duration-150">
      <div className="bg-[#f6f8f7] border border-[#e2e8e5] rounded-2xl max-w-6xl w-full p-4 sm:p-6 shadow-2xl relative text-stone-800 flex flex-col max-h-[94vh]">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-200/60 transition cursor-pointer"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="pb-3 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-8">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-[#0f4a37] text-white shadow-2xs">
              <Users className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-[#0f4a37]">
                Add Tour Group — Bulk ITS Paste &amp; Quick Setup
              </h3>
              <p className="text-xs text-stone-600 mt-0.5">
                Enter Tour ID and dates once, then paste all ITS numbers (or Excel rows) to add the whole group together.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsPasteOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer whitespace-nowrap shrink-0 ${
              isPasteOpen
                ? 'bg-[#0f4a37] text-white border-[#0f4a37]'
                : 'bg-white hover:bg-stone-100 text-[#0f4a37] border-[#0f4a37]/30'
            }`}
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>{isPasteOpen ? 'Hide Bulk Paste' : 'Paste All ITS IDs'}</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-4 pt-4 pr-1">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 1. Shared Tour & Schedule Header */}
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0f4a37]">
                <Briefcase className="w-4 h-4 text-[#0f4a37]" />
                <span>1. Tour Details &amp; Stay Dates</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-stone-600 tabular-nums">
                <span>
                  Duration: <strong className="text-[#0f4a37]">{calculatedNights} Nights</strong>
                </span>
                <span>·</span>
                <span>
                  Vacant:{' '}
                  {distinctBuildings.map((bldg, idx) => (
                    <span key={bldg} className="font-semibold text-stone-800">
                      {getVacantRoomsForBuilding(bldg).length} {bldg}
                      {idx < distinctBuildings.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {/* Tour ID */}
              <div>
                <label className="block font-bold text-stone-700 mb-1 flex items-center justify-between">
                  <span>Tour ID / Ref No. *</span>
                  {existingTourIds.length > 0 && (
                    <span className="text-[10px] text-stone-400 font-normal">
                      {existingTourIds.length} in portal
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  required
                  list="existing-tour-ids-list"
                  placeholder="Enter new or pick existing Tour ID"
                  value={tourRefNo}
                  onChange={(e) => handleSelectTour(e.target.value)}
                  className="w-full bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-1.5 font-mono font-bold text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#0f4a37]/40"
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
                  placeholder="e.g. Fayz E Husayni Trust Mumbai"
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  className="w-full bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-1.5 text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#0f4a37]/40"
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
                  <span>Arrival Date &amp; Time *</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    required
                    value={arrivalDate}
                    onChange={(e) => setArrivalDate(e.target.value)}
                    className="w-full bg-[#f6f8f7] border border-emerald-300 rounded-lg px-2 py-1.5 font-bold text-emerald-950 focus:outline-none focus:ring-1 focus:ring-emerald-700 cursor-pointer tabular-nums"
                  />
                  <input
                    type="text"
                    placeholder="11:00 AM"
                    value={arrivalTime}
                    onChange={(e) => setArrivalTime(e.target.value)}
                    className="w-24 bg-[#f6f8f7] border border-emerald-300 rounded-lg px-1.5 py-1.5 text-center font-mono text-[11px] font-bold text-emerald-950 focus:outline-none tabular-nums"
                  />
                </div>
              </div>

              {/* Shared Departure Date & Time */}
              <div>
                <label className="block font-bold text-amber-900 mb-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-amber-700" />
                  <span>Departure Date &amp; Time *</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    required
                    value={departureDate}
                    onChange={(e) => setDepartureDate(e.target.value)}
                    className="w-full bg-[#f6f8f7] border border-amber-300 rounded-lg px-2 py-1.5 font-bold text-amber-950 focus:outline-none focus:ring-1 focus:ring-amber-700 cursor-pointer tabular-nums"
                  />
                  <input
                    type="text"
                    placeholder="01:00 AM"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="w-24 bg-[#f6f8f7] border border-amber-300 rounded-lg px-1.5 py-1.5 text-center font-mono text-[11px] font-bold text-amber-950 focus:outline-none tabular-nums"
                  />
                </div>
              </div>

              {/* Group Lead Name */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Group Lead (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Mulla Shabbir"
                  value={groupLeadName}
                  onChange={(e) => setGroupLeadName(e.target.value)}
                  className="w-full bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-1.5 text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#0f4a37]"
                />
              </div>

              {/* Default Category */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Default Category</label>
                <select
                  value={defaultCategory}
                  onChange={(e) => setDefaultCategory(e.target.value)}
                  className="w-full bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-1.5 text-stone-900 focus:outline-none"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Default Building + Batch Room Apply */}
              <div className="sm:col-span-2">
                <label className="block font-semibold text-stone-700 mb-1 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-[#0f4a37]" />
                  <span>Quick Assign Hotel &amp; Room to All Rows</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={defaultBuilding}
                    onChange={(e) => {
                      setDefaultBuilding(e.target.value);
                      setBatchRoomNumber('');
                    }}
                    className="bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-1.5 font-bold text-[#0f4a37] focus:outline-none cursor-pointer"
                  >
                    {distinctBuildings.map((bldg) => (
                      <option key={bldg} value={bldg}>
                        {bldg}
                      </option>
                    ))}
                  </select>
                  <select
                    value={batchRoomNumber}
                    onChange={(e) => setBatchRoomNumber(e.target.value)}
                    className="flex-1 bg-[#f6f8f7] border border-stone-300 rounded-lg px-2.5 py-1.5 font-mono font-bold text-stone-800 focus:outline-none cursor-pointer"
                  >
                    <option value="">Allot rooms later (Unallotted)</option>
                    {activeDefaultVacantRooms.map((rm) => (
                      <option key={rm.id} value={rm.roomNumber}>
                        Rm {rm.roomNumber} (Cap {rm.capacity})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleApplyBatchHotelRoom}
                    className="px-3 py-1.5 rounded-lg bg-stone-200 hover:bg-stone-300 text-stone-900 font-bold transition cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Apply to List
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Stable Bulk ITS Paste Box */}
          {isPasteOpen && (
            <div className="bg-white border border-emerald-300 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0f4a37]">
                    <ClipboardPaste className="w-4 h-4 text-[#0f4a37]" />
                    <span>Bulk Paste All ITS IDs or Excel Rows</span>
                  </div>
                  <p className="text-[11px] text-stone-600 mt-0.5">
                    Paste any number of ITS IDs (new lines, spaces, commas, WhatsApp lists) or copy-paste columns directly from Excel/Sheets. Names auto-fill from saved records when known.
                  </p>
                </div>

                {/* Family Grouping Selector for Pasted ITS */}
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  <span className="text-stone-500 font-semibold">Family IDs:</span>
                  <div className="inline-flex bg-stone-100 p-0.5 rounded-lg border border-stone-200">
                    <button
                      type="button"
                      onClick={() => setPasteFamilyMode('separate')}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer whitespace-nowrap ${
                        pasteFamilyMode === 'separate' ? 'bg-white text-[#0f4a37] shadow-2xs' : 'text-stone-600'
                      }`}
                    >
                      Separate
                    </button>
                    <button
                      type="button"
                      onClick={() => setPasteFamilyMode('same')}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer whitespace-nowrap ${
                        pasteFamilyMode === 'same' ? 'bg-white text-[#0f4a37] shadow-2xs' : 'text-stone-600'
                      }`}
                    >
                      Same Family
                    </button>
                    <button
                      type="button"
                      onClick={() => setPasteFamilyMode('pasted')}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer whitespace-nowrap ${
                        pasteFamilyMode === 'pasted' ? 'bg-white text-[#0f4a37] shadow-2xs' : 'text-stone-600'
                      }`}
                    >
                      From Sheet
                    </button>
                  </div>
                  {pasteFamilyMode === 'same' && (
                    <input
                      type="text"
                      value={pasteSameFamilyId}
                      onChange={(e) => setPasteSameFamilyId(e.target.value)}
                      placeholder="101"
                      className="w-16 bg-[#f6f8f7] border border-stone-300 rounded-lg px-2 py-1 font-mono font-bold text-xs text-stone-900"
                      title="Family ID assigned to all pasted rows"
                    />
                  )}
                </div>
              </div>

              <textarea
                rows={4}
                value={pasteRawText}
                onChange={(e) => setPasteRawText(e.target.value)}
                placeholder={'Paste ITS numbers or Excel rows here, for example:\n30318214\n20491822, 40581920\n30318214\tMulla Shabbir Bhai\t48\tM\t101'}
                className="w-full bg-[#f6f8f7] border border-stone-300 rounded-xl px-3 py-2 font-mono text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#0f4a37]/40 resize-y"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-3 text-stone-600 tabular-nums">
                  {pasteRawText.trim() ? (
                    <>
                      <span>
                        Detected <strong className="text-[#0f4a37]">{parsedPastePreview.entries.length}</strong> ITS
                      </span>
                      {parsedPastePreview.autoMatchedCount > 0 && (
                        <span>
                          · <strong className="text-emerald-700">{parsedPastePreview.autoMatchedCount}</strong> matched from records
                        </span>
                      )}
                      {parsedPastePreview.duplicatesSkipped > 0 && (
                        <span>
                          · <strong className="text-amber-700">{parsedPastePreview.duplicatesSkipped}</strong> duplicate skipped
                        </span>
                      )}
                      {parsedPastePreview.invalidTokens.length > 0 && (
                        <span className="text-rose-700">
                          · {parsedPastePreview.invalidTokens.length} non-ITS number(s) ignored
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-stone-500">
                      Tip: You can also paste multiple ITS lines straight into any ITS box in the table below.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {pasteRawText && (
                    <button
                      type="button"
                      onClick={() => setPasteRawText('')}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-stone-600 hover:bg-stone-100 cursor-pointer"
                    >
                      Clear Box
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={parsedPastePreview.entries.length === 0}
                    onClick={handleApplyBulkPaste}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-[#0f4a37] hover:bg-[#0b3a2b] disabled:opacity-40 text-white shadow-2xs transition cursor-pointer whitespace-nowrap"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-[#ecdcae]" />
                    <span>Add {parsedPastePreview.entries.length || ''} Pasted ITS to List</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {pasteNotice && (
            <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs font-semibold flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{pasteNotice}</span>
              </span>
              <button
                type="button"
                onClick={() => setPasteNotice(null)}
                className="text-emerald-700 hover:text-emerald-950 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 3. Individuals List */}
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0f4a37]">
                  <Hash className="w-4 h-4 text-[#0f4a37]" />
                  <span>2. Tour Members ({rows.length})</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600 mt-1 tabular-nums">
                  <span><strong className="text-stone-900">{readyCount}</strong> ready</span>
                  <span>·</span>
                  <span><strong className="text-stone-900">{uniqueFamiliesCount}</strong> families</span>
                  <span>·</span>
                  <span><strong className="text-stone-900">{allottedCount}</strong> with rooms</span>
                  {rowChecks.duplicateRowCount > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-rose-700 font-bold">
                        {rowChecks.duplicateRowCount} duplicate ITS
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {rowChecks.duplicateRowCount > 0 && (
                  <button
                    type="button"
                    onClick={handleRemoveDuplicateRows}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-rose-100 hover:bg-rose-200 text-rose-900 border border-rose-300 transition cursor-pointer whitespace-nowrap"
                  >
                    Remove Duplicates ({rowChecks.duplicateRowCount})
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSetAllSameFamily}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-300 transition cursor-pointer whitespace-nowrap"
                  title="Put everyone in this list under one Family ID"
                >
                  Group Same Family
                </button>

                <button
                  type="button"
                  onClick={() => handleAddIndividual(false)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0f4a37] hover:bg-[#0b3a2b] text-white transition cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5 text-[#ecdcae]" />
                  <span>New Family Zaer</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddIndividual(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 transition cursor-pointer whitespace-nowrap"
                >
                  <UserPlus className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Same Family</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddMultiple(5)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-300 transition cursor-pointer whitespace-nowrap"
                >
                  +5 Rows
                </button>
              </div>
            </div>

            {/* Table of Individuals */}
            <div className="overflow-x-auto border border-stone-200 rounded-xl max-h-[340px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 text-stone-600 border-b border-stone-200 uppercase text-[10px] font-medium sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-2 w-8 text-center">#</th>
                    <th className="py-2.5 px-2 w-[10%]">Family *</th>
                    <th className="py-2.5 px-2 w-[15%]">ITS ID (Paste OK)</th>
                    <th className="py-2.5 px-2 w-[23%]">Name (Auto-fills if known)</th>
                    <th className="py-2.5 px-2 w-[7%] text-center">Age</th>
                    <th className="py-2.5 px-2 w-[9%] text-center">Sex</th>
                    <th className="py-2.5 px-2 w-[17%]">Hotel &amp; Room</th>
                    <th className="py-2.5 px-2 w-[11%]">Category</th>
                    <th className="py-2.5 px-2 w-16 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {rows.map((row, idx) => {
                    const batchErr = rowChecks.batchErrors[row.id];
                    const tourConflict = rowChecks.sameTourConflicts[row.id];
                    const activeVacantRooms = getVacantRoomsForBuilding(row.building);

                    return (
                      <tr
                        key={row.id}
                        className={`transition ${
                          batchErr || tourConflict
                            ? 'bg-rose-50/70'
                            : idx % 2 === 0
                            ? 'bg-white'
                            : 'bg-stone-50/50'
                        }`}
                      >
                        <td className="py-2 px-2 text-center font-mono text-stone-400 font-bold tabular-nums">
                          {idx + 1}
                        </td>

                        <td className="py-2 px-2">
                          <input
                            type="text"
                            placeholder="101"
                            value={row.family}
                            onChange={(e) => handleUpdateRow(row.id, 'family', e.target.value)}
                            className="w-full bg-white border border-stone-300 rounded px-2 py-1 font-mono font-bold text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4a37] tabular-nums"
                          />
                        </td>

                        <td className="py-2 px-2">
                          <input
                            type="text"
                            placeholder="30318214"
                            value={row.itsId}
                            onChange={(e) => handleUpdateRow(row.id, 'itsId', e.target.value)}
                            onPaste={(e) => handleRowItsPaste(e, idx, row.id)}
                            className={`w-full bg-white border rounded px-2 py-1 font-mono text-xs focus:ring-1 focus:ring-[#0f4a37] tabular-nums ${
                              batchErr || tourConflict
                                ? 'border-rose-400 text-rose-900 font-bold'
                                : row.matchedFromHistory
                                ? 'border-emerald-400 text-emerald-950 font-bold'
                                : 'border-stone-300 text-stone-900'
                            }`}
                            title="Enter 8-digit ITS or paste multiple ITS IDs here"
                          />
                          {(batchErr || tourConflict) && (
                            <div className="text-[10px] text-rose-700 font-semibold leading-tight mt-0.5">
                              {batchErr || tourConflict}
                            </div>
                          )}
                          {!batchErr && !tourConflict && row.matchedFromHistory && (
                            <div className="text-[10px] text-emerald-700 font-medium leading-tight mt-0.5">
                              Matched from history
                            </div>
                          )}
                        </td>

                        <td className="py-2 px-2">
                          <input
                            type="text"
                            placeholder={row.itsId ? 'Optional (or auto-filled)' : 'Full Name *'}
                            value={row.applicantName}
                            onChange={(e) => handleUpdateRow(row.id, 'applicantName', e.target.value)}
                            className="w-full bg-white border border-stone-300 rounded px-2 py-1 font-semibold text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4a37]"
                          />
                        </td>

                        <td className="py-2 px-2 text-center">
                          <input
                            type="number"
                            min="0"
                            max="120"
                            value={row.age}
                            onChange={(e) => handleUpdateRow(row.id, 'age', e.target.value)}
                            className="w-12 text-center bg-white border border-stone-300 rounded px-1 py-1 font-mono text-xs focus:ring-1 focus:ring-[#0f4a37] tabular-nums"
                          />
                        </td>

                        <td className="py-2 px-2 text-center">
                          <select
                            value={row.gender}
                            onChange={(e) => handleUpdateRow(row.id, 'gender', e.target.value)}
                            className="bg-white border border-stone-300 rounded px-1.5 py-1 text-xs font-medium focus:ring-1 focus:ring-[#0f4a37]"
                          >
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                          </select>
                        </td>

                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <select
                              value={row.building}
                              onChange={(e) => handleUpdateRow(row.id, 'building', e.target.value)}
                              className="bg-white border border-stone-300 rounded px-1.5 py-1 text-[11px] font-bold text-[#0f4a37] focus:ring-1 focus:ring-[#0f4a37] cursor-pointer"
                            >
                              {distinctBuildings.map((bldg) => (
                                <option key={bldg} value={bldg}>
                                  {bldg}
                                </option>
                              ))}
                            </select>

                            <select
                              value={row.roomNumber}
                              onChange={(e) => handleUpdateRow(row.id, 'roomNumber', e.target.value)}
                              className={`flex-1 bg-white border rounded px-1.5 py-1 text-xs font-mono font-bold tabular-nums ${
                                row.roomNumber
                                  ? 'border-emerald-400 text-emerald-950 bg-emerald-50/50'
                                  : 'border-stone-300 text-stone-500'
                              }`}
                            >
                              <option value="">Unallotted</option>
                              {activeVacantRooms.map((rm) => (
                                <option key={rm.id} value={rm.roomNumber}>
                                  Rm {rm.roomNumber} ({rm.capacity})
                                </option>
                              ))}
                              {row.roomNumber && !activeVacantRooms.some((r) => r.roomNumber === row.roomNumber) && (
                                <option value={row.roomNumber}>Rm {row.roomNumber}</option>
                              )}
                            </select>
                          </div>
                        </td>

                        <td className="py-2 px-2">
                          <select
                            value={row.category}
                            onChange={(e) => handleUpdateRow(row.id, 'category', e.target.value)}
                            className="w-full bg-white border border-stone-300 rounded px-1.5 py-1 text-xs text-stone-800"
                          >
                            {categories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="py-2 px-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleDuplicateRow(row)}
                              className="p-1 text-stone-400 hover:text-[#0f4a37] hover:bg-stone-200/60 rounded transition cursor-pointer"
                              title="Add another member to same Family ID"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(row.id)}
                              className="p-1 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                              title="Remove row"
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
          </div>

          {/* Modal Footer Controls */}
          <div className="pt-3 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-stone-600 tabular-nums">
              Ready to save <strong className="text-[#0f4a37]">{readyCount} Zaereen</strong> across{' '}
              <strong className="text-stone-900">{uniqueFamiliesCount} Families</strong> for Tour{' '}
              <strong className="font-mono text-stone-900">{tourRefNo.trim() || '—'}</strong>.
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
                disabled={readyCount === 0 || rowChecks.duplicateRowCount > 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-[#0f4a37] hover:bg-[#0b3a2b] disabled:opacity-50 text-white shadow-sm transition cursor-pointer whitespace-nowrap"
              >
                <CheckCircle2 className="w-4 h-4 text-[#ecdcae]" />
                <span>Save Tour Group ({readyCount} Zaereen)</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
