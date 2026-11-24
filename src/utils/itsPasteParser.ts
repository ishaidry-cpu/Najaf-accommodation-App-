import { Reservation } from '../types';
import { normalizeItsId } from './deduplication';
import { normalizeBuildingName, normalizeRoomNumber } from '../services/storage';

export interface ParsedPasteEntry {
  itsId: string;
  applicantName: string;
  age: string;
  gender: 'Male' | 'Female';
  family: string;
  building: string;
  roomNumber: string;
  category: string;
  jamaat: string;
  hofId: string;
  matchedFromHistory: boolean;
}

export interface ParsedPasteResult {
  entries: ParsedPasteEntry[];
  duplicatesSkipped: number;
  autoMatchedCount: number;
  invalidTokens: string[];
  mode: 'tabular' | 'its_list';
}

const INVISIBLE_CHARS_RE = /[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E]/g;

/**
 * Strips invisible direction/zero-width characters, smart quotes, Excel apostrophes, and formula wrappers.
 */
export function cleanClipboardText(raw: string): string {
  return String(raw || '')
    .replace(INVISIBLE_CHARS_RE, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n');
}

function cleanCell(raw: string): string {
  let s = String(raw || '').replace(INVISIBLE_CHARS_RE, '').trim();
  // Unwrap Excel formula strings like ="30318214"
  const formulaMatch = s.match(/^=\s*"(.*)"$/);
  if (formulaMatch) s = formulaMatch[1].trim();
  // Strip wrapping quotes and leading Excel apostrophe
  s = s.replace(/^['"’‘]+|['"’‘]+$/g, '').trim();
  return s;
}

function normalizeGenderToken(val: string): 'Male' | 'Female' | null {
  const s = val.trim().toLowerCase();
  if (!s) return null;
  if (s === 'f' || s === 'female' || s === 'woman' || s === 'lady' || s === 'bai' || s === 'behn') {
    return 'Female';
  }
  if (s === 'm' || s === 'male' || s === 'man' || s === 'bhai') {
    return 'Male';
  }
  return null;
}

export function normalizeGender(val?: string | null): 'Male' | 'Female' | null {
  if (!val) return null;
  return normalizeGenderToken(String(val));
}

function extractItsToken(raw: string): string | null {
  const cleaned = cleanCell(raw).replace(/^#/, '');
  // Standard ITS IDs are 7-9 digits (usually 8 digits)
  if (/^\d{7,10}$/.test(cleaned)) {
    return cleaned;
  }
  // Alphanumeric prefixed ITS-30318214
  const prefixed = cleaned.match(/^its[-_:\s#]*(\d{6,10})$/i);
  if (prefixed) return prefixed[1];
  return null;
}

function splitCsvOrTabLine(line: string, delimiter: '\t' | ',' | '|' | ';'): string[] {
  if (delimiter === '\t' || delimiter === '|' || delimiter === ';') {
    return line.split(delimiter).map(cleanCell);
  }
  // Safe CSV splitter handling quoted commas
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cleanCell(cur));
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cleanCell(cur));
  return out;
}

function buildExistingByItsMap(existingReservations: Reservation[]): Map<string, Reservation> {
  const map = new Map<string, Reservation>();
  for (const r of existingReservations) {
    const key = normalizeItsId(r.itsId);
    if (!key) continue;
    const prev = map.get(key);
    // Prefer a record that actually has a real applicant name
    if (!prev || (!prev.applicantName && r.applicantName)) {
      map.set(key, r);
    }
  }
  return map;
}

function enrichEntry(
  partial: Partial<ParsedPasteEntry> & { itsId: string },
  existingByIts: Map<string, Reservation>,
  defaults: { defaultBuilding: string; defaultCategory: string }
): ParsedPasteEntry {
  const norm = normalizeItsId(partial.itsId);
  const match = norm ? existingByIts.get(norm) : undefined;

  return {
    itsId: partial.itsId,
    applicantName: partial.applicantName?.trim() || match?.applicantName?.trim() || '',
    age: partial.age?.trim() || (match?.age !== undefined && match?.age !== '' ? String(match.age) : '35'),
    gender: partial.gender || normalizeGender(match?.gender) || 'Male',
    family: partial.family?.trim() || match?.family?.trim() || '',
    building: partial.building ? normalizeBuildingName(partial.building) : defaults.defaultBuilding,
    roomNumber: partial.roomNumber ? normalizeRoomNumber(partial.roomNumber) : '',
    category: partial.category?.trim() || match?.category?.trim() || defaults.defaultCategory,
    jamaat: partial.jamaat?.trim() || match?.jamaat?.trim() || '',
    hofId: partial.hofId?.trim() || match?.hofId?.trim() || '',
    matchedFromHistory: Boolean(match),
  };
}

/**
 * Parses bulk pasted ITS IDs, WhatsApp/text lists, or Excel/Sheet rows into structured entries.
 * Deterministic and defensive against malformed whitespace, duplicates, quotes, and Excel artifacts.
 */
export function parseBulkTourPaste(
  rawText: string,
  existingReservations: Reservation[],
  defaults: { defaultBuilding?: string; defaultCategory?: string } = {}
): ParsedPasteResult {
  const defaultBuilding = defaults.defaultBuilding || 'Saifee';
  const defaultCategory = defaults.defaultCategory || 'Mumineen';
  const existingByIts = buildExistingByItsMap(existingReservations);

  const text = cleanClipboardText(rawText).trim();
  if (!text) {
    return {
      entries: [],
      duplicatesSkipped: 0,
      autoMatchedCount: 0,
      invalidTokens: [],
      mode: 'its_list',
    };
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Detect tabular Excel/Sheets copy-paste (tabs or structured multi-column lines with headers/names)
  const hasTabs = lines.some((l) => l.includes('\t'));
  const hasPipes = lines.some((l) => l.includes('|'));
  const hasStructuredCommas =
    !hasTabs &&
    lines.length >= 1 &&
    lines.every((l) => l.includes(',')) &&
    lines.some((l) => /[a-zA-Z]{2,}/.test(l));

  if (hasTabs || hasPipes || hasStructuredCommas) {
    const delimiter: '\t' | '|' | ',' = hasTabs ? '\t' : hasPipes ? '|' : ',';
    const rawRows = lines.map((l) => splitCsvOrTabLine(l, delimiter));

    // Check if first row is a header row
    const firstRowLower = rawRows[0].map((c) => c.toLowerCase());
    const looksLikeHeader = firstRowLower.some((c) =>
      /^(its|its\s*id|its\s*no|name|applicant|full\s*name|family|age|gender|sex|room|hotel|building|category|jamaat|hof)$/.test(c)
    );

    const colIdx = {
      its: -1,
      name: -1,
      age: -1,
      gender: -1,
      family: -1,
      building: -1,
      room: -1,
      category: -1,
      jamaat: -1,
      hof: -1,
    };

    if (looksLikeHeader) {
      firstRowLower.forEach((h, i) => {
        if (/\bits\b/.test(h) && !/hof/.test(h)) colIdx.its = i;
        else if (/hof/.test(h)) colIdx.hof = i;
        else if (/name|applicant|zaer|member|guest/.test(h)) colIdx.name = i;
        else if (/^age$/.test(h)) colIdx.age = i;
        else if (/gender|sex/.test(h)) colIdx.gender = i;
        else if (/family|fam/.test(h)) colIdx.family = i;
        else if (/hotel|building|manzil/.test(h)) colIdx.building = i;
        else if (/room/.test(h)) colIdx.room = i;
        else if (/cat/.test(h)) colIdx.category = i;
        else if (/jamaat|mohalla/.test(h)) colIdx.jamaat = i;
      });
    }

    const dataRows = looksLikeHeader ? rawRows.slice(1) : rawRows;
    const seenIts = new Set<string>();
    const entries: ParsedPasteEntry[] = [];
    const invalidTokens: string[] = [];
    let duplicatesSkipped = 0;
    let autoMatchedCount = 0;

    for (const cells of dataRows) {
      if (cells.every((c) => !c)) continue;

      let itsId = '';
      let applicantName = '';
      let age = '';
      let gender: 'Male' | 'Female' | undefined;
      let family = '';
      let building = '';
      let roomNumber = '';
      let category = '';
      let jamaat = '';
      let hofId = '';

      if (looksLikeHeader) {
        if (colIdx.its >= 0) itsId = extractItsToken(cells[colIdx.its] || '') || cleanCell(cells[colIdx.its] || '');
        if (colIdx.name >= 0) applicantName = cells[colIdx.name] || '';
        if (colIdx.age >= 0) age = cells[colIdx.age] || '';
        if (colIdx.gender >= 0) gender = normalizeGenderToken(cells[colIdx.gender] || '') || undefined;
        if (colIdx.family >= 0) family = cells[colIdx.family] || '';
        if (colIdx.building >= 0) building = cells[colIdx.building] || '';
        if (colIdx.room >= 0) roomNumber = cells[colIdx.room] || '';
        if (colIdx.category >= 0) category = cells[colIdx.category] || '';
        if (colIdx.jamaat >= 0) jamaat = cells[colIdx.jamaat] || '';
        if (colIdx.hof >= 0) hofId = extractItsToken(cells[colIdx.hof] || '') || cells[colIdx.hof] || '';
      } else {
        // Smart headerless detection per cell
        for (const cell of cells) {
          if (!cell) continue;
          const maybeIts = extractItsToken(cell);
          if (maybeIts) {
            if (!itsId) itsId = maybeIts;
            else if (!hofId) hofId = maybeIts;
            continue;
          }
          const maybeGender = normalizeGenderToken(cell);
          if (maybeGender && !gender) {
            gender = maybeGender;
            continue;
          }
          if (/^(burhani|saifee|saifi|badri)/i.test(cell) && !building) {
            building = cell;
            continue;
          }
          if (/^\d{1,3}$/.test(cell)) {
            const num = parseInt(cell, 10);
            if (num >= 0 && num <= 115 && !age && applicantName) {
              age = String(num);
              continue;
            }
            if (!family) {
              family = cell;
              continue;
            }
            if (!age && num <= 115) {
              age = String(num);
              continue;
            }
          }
          if (!applicantName && /[a-zA-Z]{2,}/.test(cell)) {
            applicantName = cell;
            continue;
          }
          if (!roomNumber && /^(?:rm\s*)?[gGmM]?\d{1,4}$/i.test(cell) && building) {
            roomNumber = cell;
            continue;
          }
        }
      }

      // If multiple ITS numbers appear inside a single row (e.g. comma-separated ITS IDs on one line)
      const normIts = normalizeItsId(itsId);
      if (!normIts && !applicantName) {
        // Fallback: extract any 7-9 digit tokens from the whole row
        const rowStr = cells.join(' ');
        const matches = rowStr.match(/\b\d{7,9}\b/g) || [];
        if (matches.length === 0) continue;
        for (const m of matches) {
          const k = normalizeItsId(m);
          if (seenIts.has(k)) {
            duplicatesSkipped++;
            continue;
          }
          seenIts.add(k);
          const entry = enrichEntry({ itsId: m }, existingByIts, { defaultBuilding, defaultCategory });
          if (entry.matchedFromHistory) autoMatchedCount++;
          entries.push(entry);
        }
        continue;
      }

      if (normIts) {
        if (seenIts.has(normIts)) {
          duplicatesSkipped++;
          continue;
        }
        seenIts.add(normIts);
      }

      const entry = enrichEntry(
        { itsId, applicantName, age, gender, family, building, roomNumber, category, jamaat, hofId },
        existingByIts,
        { defaultBuilding, defaultCategory }
      );
      if (entry.matchedFromHistory) autoMatchedCount++;
      entries.push(entry);
    }

    if (entries.length > 0) {
      return {
        entries,
        duplicatesSkipped,
        autoMatchedCount,
        invalidTokens,
        mode: 'tabular',
      };
    }
  }

  // Plain ITS list / mixed WhatsApp / Email paste mode
  const seenIts = new Set<string>();
  const entries: ParsedPasteEntry[] = [];
  const invalidTokens: string[] = [];
  let duplicatesSkipped = 0;
  let autoMatchedCount = 0;

  for (const rawLine of lines) {
    // Remove leading bullet or list numbering like "1. ", "2) ", "- ", "• "
    const line = rawLine.replace(/^\s*(?:\d{1,3}[.)]\s+|[-*•▪●]+\s+)/, '').trim();
    if (!line) continue;

    // Look for 7-10 digit ITS IDs inside the line
    const itsMatches = line.match(/\b\d{7,10}\b/g);
    if (itsMatches && itsMatches.length === 1 && /[a-zA-Z]{2,}/.test(line)) {
      // Single ITS + Name on the same line (e.g. "30318214 - Mulla Shabbir Bhai" or "Fatema Bai (20491822)")
      const its = itsMatches[0];
      const norm = normalizeItsId(its);
      if (seenIts.has(norm)) {
        duplicatesSkipped++;
        continue;
      }
      seenIts.add(norm);
      const strippedName = line
        .replace(its, '')
        .replace(/\bits\b[:\s#-]*/gi, '')
        .replace(/[()[\]{}|•·–—-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const entry = enrichEntry(
        { itsId: its, applicantName: strippedName },
        existingByIts,
        { defaultBuilding, defaultCategory }
      );
      if (entry.matchedFromHistory) autoMatchedCount++;
      entries.push(entry);
      continue;
    }

    // Split line by common separators (comma, semicolon, space, slash, pipe)
    const tokens = line
      .split(/[\s,;|/]+/)
      .map(cleanCell)
      .filter(Boolean);

    for (const token of tokens) {
      const its = extractItsToken(token);
      if (its) {
        const norm = normalizeItsId(its);
        if (seenIts.has(norm)) {
          duplicatesSkipped++;
          continue;
        }
        seenIts.add(norm);
        const entry = enrichEntry({ itsId: its }, existingByIts, { defaultBuilding, defaultCategory });
        if (entry.matchedFromHistory) autoMatchedCount++;
        entries.push(entry);
      } else if (/\d/.test(token) && token.length >= 4 && !/^\d{1,3}[.)]?$/.test(token)) {
        // Digits that are too short/malformed to be a valid 7-10 digit ITS
        invalidTokens.push(token);
      }
    }
  }

  return {
    entries,
    duplicatesSkipped,
    autoMatchedCount,
    invalidTokens,
    mode: 'its_list',
  };
}
