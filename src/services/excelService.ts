import * as XLSX from 'xlsx';
import { Reservation, DEFAULT_ZAEREEN_CATEGORIES } from '../types';

export interface ParsedZaerRow {
  itsId: string;
  applicantName: string;
  age: number | string;
  jamaat?: string;
  rotationId?: string;
  category: string; // 'Mumineen', 'Muntasbeen', 'Qasreali', 'Baitezainy'
  gender: string;
  family: string;
  idara: string;
  hofId?: string;
  groupAdmin?: string;
  groupId?: string;
  tourRefNo: string;
  officeName: string;
  groupLeadName: string;
  arrivalDate: string;
  departureDate: string;
  rawArrivalStr?: string;
  rawDepartureStr?: string;
  // Optional pre-filled fields if present:
  moneyGiven?: 'Yes' | 'No';
  building?: string;
  roomNumber?: string;
  isUploadedToPortal?: boolean;
}

/**
 * Standardize date strings into YYYY-MM-DD format.
 * Handles Excel serial numbers, formats with leading apostrophes like "'01-10-2026 11:00 AM",
 * DD-MM-YYYY, DD/MM/YYYY, and ISO formats.
 */
export function normalizeDate(val: any): string {
  if (!val && val !== 0) return '';
  
  if (typeof val === 'number') {
    // Excel serial date number
    try {
      const parsed = XLSX.SSF.parse_date_code(val);
      if (parsed) {
        const y = parsed.y;
        const m = String(parsed.m).padStart(2, '0');
        const d = String(parsed.d).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } catch {
      // fallback
    }
  }

  // Strip leading/trailing quotes, apostrophes, and whitespace (e.g. "'01-10-2026 11:00 AM")
  let str = String(val).trim().replace(/^['"’‘\s]+|['"’‘\s]+$/g, '');

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }

  // Handle DD-MM-YYYY or DD/MM/YYYY with optional time like "01-10-2026 11:00 AM"
  const dmyMatch = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Handle YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Try parsing Date object
  const dateObj = new Date(str);
  if (!isNaN(dateObj.getTime()) && dateObj.getFullYear() > 1970) {
    return dateObj.toISOString().slice(0, 10);
  }

  return str;
}

/**
 * Parse raw text (CSV, TSV, Semicolon-delimited) into 2D array of strings
 */
function parseTextToRows(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmptyLines = lines.map(l => l.trim()).filter(l => l.length > 0);
  if (nonEmptyLines.length === 0) return [];

  const sample = nonEmptyLines.slice(0, 5).join('\n');
  const commaCount = (sample.match(/,/g) || []).length;
  const semicolonCount = (sample.match(/;/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  const pipeCount = (sample.match(/\|/g) || []).length;

  let delimiter = ',';
  if (semicolonCount > commaCount && semicolonCount > tabCount) delimiter = ';';
  else if (tabCount > commaCount && tabCount > semicolonCount) delimiter = '\t';
  else if (pipeCount > commaCount) delimiter = '|';

  const result: string[][] = [];

  for (const line of nonEmptyLines) {
    const row: string[] = [];
    let inQuotes = false;
    let currentCell = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        row.push(currentCell.trim().replace(/^["']|["']$/g, ''));
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
    row.push(currentCell.trim().replace(/^["']|["']$/g, ''));
    if (row.some(c => c.length > 0)) {
      result.push(row);
    }
  }

  return result;
}

/**
 * Helper to test if a row looks like a header row
 */
function calculateHeaderScore(row: any[]): number {
  const rowStr = row.map((c: any) => String(c || '').toLowerCase()).join(' ');
  let score = 0;
  if (rowStr.includes('its id') || rowStr.includes('its')) score += 3;
  if (rowStr.includes('applicant name') || rowStr.includes('applicant')) score += 3;
  if (rowStr.includes('tour reference no') || rowStr.includes('tour ref') || rowStr.includes('tour')) score += 3;
  if (rowStr.includes('jamaat') || rowStr.includes('jamat')) score += 2;
  if (rowStr.includes('family')) score += 2;
  if (rowStr.includes('category')) score += 2;
  if (rowStr.includes('office name') || rowStr.includes('office')) score += 2;
  if (rowStr.includes('group lead name') || rowStr.includes('group lead')) score += 2;
  if (rowStr.includes('arrival date') || rowStr.includes('arrival')) score += 2;
  if (rowStr.includes('departure date') || rowStr.includes('departure')) score += 2;
  if (rowStr.includes('hof_id') || rowStr.includes('group_id')) score += 2;
  if (rowStr.includes('age')) score += 1;
  if (rowStr.includes('gender') || rowStr.includes('sex')) score += 1;
  if (rowStr.includes('idara')) score += 1;
  return score;
}

/**
 * Reads an Excel file buffer or File and extracts zaereen rows matching the exact columns in user's image.
 */
export async function parseZaereenExcelFile(file: File): Promise<ParsedZaerRow[]> {
  let rawRows: any[][] = [];

  // 1. Try reading with SheetJS
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true, raw: false });
    
    if (workbook.SheetNames && workbook.SheetNames.length > 0) {
      let maxScore = -1;
      let bestRows: any[][] = [];

      for (const sheetName of workbook.SheetNames) {
        const ws = workbook.Sheets[sheetName];
        if (!ws) continue;
        const currentRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        
        const cleanedRows = currentRows.filter(r => Array.isArray(r) && r.some(c => String(c || '').trim() !== ''));
        if (cleanedRows.length === 0) continue;

        let sheetScore = cleanedRows.length;
        for (let r = 0; r < Math.min(cleanedRows.length, 10); r++) {
          sheetScore += calculateHeaderScore(cleanedRows[r]) * 5;
        }

        if (sheetScore > maxScore) {
          maxScore = sheetScore;
          bestRows = cleanedRows;
        }
      }

      if (bestRows.length > 0) {
        rawRows = bestRows;
      }
    }
  } catch (sheetJsError) {
    console.warn('SheetJS arrayBuffer read error, attempting text fallback:', sheetJsError);
  }

  // 2. Fallback: If SheetJS found 0 rows or only 1 combined row, try text-based parsing
  if (rawRows.length < 2) {
    try {
      const text = await file.text();
      const textRows = parseTextToRows(text);
      if (textRows.length > rawRows.length) {
        rawRows = textRows;
      }
    } catch {
      // fallback failed
    }
  }

  if (!rawRows || rawRows.length === 0) {
    throw new Error('The uploaded file appears to be empty or unreadable. Please check that it contains zaereen data.');
  }

  // 3. Handle single-column rows (e.g. semicolon-separated CSV)
  const isSingleColSemicolon = rawRows.length > 0 && rawRows[0].length === 1 && String(rawRows[0][0] || '').includes(';');
  const isSingleColComma = rawRows.length > 0 && rawRows[0].length === 1 && String(rawRows[0][0] || '').includes(',');
  const isSingleColTab = rawRows.length > 0 && rawRows[0].length === 1 && String(rawRows[0][0] || '').includes('\t');

  if (isSingleColSemicolon || isSingleColComma || isSingleColTab) {
    const delim = isSingleColSemicolon ? ';' : isSingleColTab ? '\t' : ',';
    rawRows = rawRows.map(r => {
      if (r.length === 1 && typeof r[0] === 'string') {
        return r[0].split(delim).map(c => c.trim().replace(/^["']|["']$/g, ''));
      }
      return r;
    });
  }

  // 4. Find Header Row
  let headerRowIndex = -1;
  let bestHeaderScore = 0;

  for (let r = 0; r < Math.min(rawRows.length, 25); r++) {
    const score = calculateHeaderScore(rawRows[r]);
    if (score > bestHeaderScore) {
      bestHeaderScore = score;
      headerRowIndex = r;
    }
  }

  if (headerRowIndex === -1 || bestHeaderScore < 2) {
    const row0Strings = rawRows[0].filter(c => typeof c === 'string' && isNaN(Number(c)) && c.trim().length > 0).length;
    if (row0Strings >= 2 && rawRows.length > 1) {
      headerRowIndex = 0;
    } else {
      headerRowIndex = -1;
    }
  }

  let headers: string[] = [];
  let dataStartIndex = 0;

  if (headerRowIndex >= 0) {
    headers = rawRows[headerRowIndex].map((h: any) =>
      String(h || '').trim().toLowerCase()
    );
    dataStartIndex = headerRowIndex + 1;
  }

  const findCol = (keywords: string[]): number => {
    if (headers.length === 0) return -1;
    return headers.findIndex((h) => keywords.some((k) => h === k || h.includes(k)));
  };

  // Exact matching for columns in the user's image:
  // ITS Id | Applicant Name | Age | Jamaat | Rotation Id | Category | Gender | Family | Idara | HOF_ID | GroupAdmin | GROUP_ID | Tour Reference No. | Office Name | Group Lead Name | Arrival Date | Departure Date
  let itsIdx = findCol(['its id', 'its no', 'its number', 'its', 'ejamaat']);
  let nameIdx = findCol(['applicant name', 'applicant', 'zair name', 'zaereen name', 'full name', 'name']);
  let ageIdx = findCol(['age', 'years']);
  let jamaatIdx = findCol(['jamaat', 'jamat', 'mohalla']);
  let rotIdx = findCol(['rotation id', 'rotation']);
  let catIdx = findCol(['category', 'cat', 'class']);
  let genderIdx = findCol(['gender', 'sex']);
  let famIdx = findCol(['family', 'family no', 'family number', 'family id', 'fam']);
  let idaraIdx = findCol(['idara', 'organization', 'trust']);
  let hofIdx = findCol(['hof_id', 'hof id', 'hof']);
  let groupAdminIdx = findCol(['groupadmin', 'group admin']);
  let groupIdIdx = findCol(['group_id', 'group id']);
  let tourIdx = findCol(['tour reference no.', 'tour reference no', 'tour ref no', 'tour ref', 'tour reference', 'tour id']);
  let officeIdx = findCol(['office name', 'office', 'branch']);
  let leadIdx = findCol(['group lead name', 'group lead', 'group leader', 'lead name', 'leader']);
  let arrIdx = findCol(['arrival date', 'arrival', 'arr date']);
  let depIdx = findCol(['departure date', 'departure', 'dep date']);
  let moneyIdx = findCol(['money given', 'money', 'paid']);
  let bldgIdx = findCol(['building', 'hotel']);
  let roomIdx = findCol(['room number', 'room no', 'room']);
  let portalIdx = findCol(['uploaded on main portal', 'main portal', 'portal upload', 'uploaded', 'portal']);

  // Positional fallback based on exact image structure if indices not found
  if (itsIdx < 0 && headers.length >= 13) {
    itsIdx = 0;
    nameIdx = 1;
    ageIdx = 2;
    jamaatIdx = 3;
    rotIdx = 4;
    catIdx = 5;
    genderIdx = 6;
    famIdx = 7;
    idaraIdx = 8;
    hofIdx = 9;
    groupAdminIdx = 10;
    groupIdIdx = 11;
    tourIdx = 12;
    officeIdx = 13;
    leadIdx = 14;
    arrIdx = 15;
    depIdx = 16;
  } else {
    if (itsIdx < 0) itsIdx = 0;
    if (nameIdx < 0 && rawRows[0]?.length > 1) nameIdx = 1;
  }

  const parsedList: ParsedZaerRow[] = [];

  for (let r = dataStartIndex; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0 || row.every((c: any) => !c && c !== 0)) continue;

    const applicantName = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '';
    const itsId = itsIdx >= 0 ? String(row[itsIdx] || '').trim().replace(/^['"\s]+|['"\s]+$/g, '') : '';

    if (!applicantName && !itsId) {
      const anyData = row.some((c: any) => String(c || '').trim().length > 0);
      if (!anyData) continue;
    }

    let age = ageIdx >= 0 ? row[ageIdx] : '';
    if (typeof age === 'string') age = age.trim();

    // Pilgrim category: Mumineen, Muntasbeen, Qasreali, Baitezainy (Keep exact string from Excel)
    let rawCategory = catIdx >= 0 ? String(row[catIdx] || '').trim() : 'Mumineen';
    let category = rawCategory || 'Mumineen';

    const jamaat = jamaatIdx >= 0 && row[jamaatIdx] ? String(row[jamaatIdx]).trim() : '';
    const rotationId = rotIdx >= 0 && row[rotIdx] ? String(row[rotIdx]).trim() : '';
    const rawGender = genderIdx >= 0 && row[genderIdx] ? String(row[genderIdx]).trim() : 'Male';
    const gender = rawGender.toLowerCase().startsWith('f') ? 'Female' : 'Male';
    
    const family = famIdx >= 0 && row[famIdx] ? String(row[famIdx]).trim() : `F-${parsedList.length + 1}`;
    const idara = idaraIdx >= 0 && row[idaraIdx] ? String(row[idaraIdx]).trim() : '';
    const hofId = hofIdx >= 0 && row[hofIdx] ? String(row[hofIdx]).trim() : '';
    const groupAdmin = groupAdminIdx >= 0 && row[groupAdminIdx] ? String(row[groupAdminIdx]).trim() : '';
    const groupId = groupIdIdx >= 0 && row[groupIdIdx] ? String(row[groupIdIdx]).trim() : '';
    
    // Complete Tour Reference No. (e.g. "NKERP/TOUR/2026/1333")
    const tourRefNo = tourIdx >= 0 && row[tourIdx] ? String(row[tourIdx]).trim() : 'NKERP/TOUR/2026/1333';
    const officeName = officeIdx >= 0 && row[officeIdx] ? String(row[officeIdx]).trim() : 'Fayz E Husayni Trust Mumbai';
    const groupLeadName = leadIdx >= 0 && row[leadIdx] ? String(row[leadIdx]).trim() : (applicantName || 'Group Leader');
    
    const rawArr = arrIdx >= 0 && row[arrIdx] ? String(row[arrIdx]).trim() : '';
    const rawDep = depIdx >= 0 && row[depIdx] ? String(row[depIdx]).trim() : '';
    const arrivalDate = normalizeDate(rawArr) || '2026-10-01';
    const departureDate = normalizeDate(rawDep) || '2026-10-06';

    let moneyGiven: 'Yes' | 'No' = 'No';
    if (moneyIdx >= 0 && row[moneyIdx]) {
      const val = String(row[moneyIdx]).trim().toLowerCase();
      if (val === 'yes' || val === 'y' || val === 'true' || val === '1' || val === 'paid') {
        moneyGiven = 'Yes';
      }
    }

    const rawBuilding = bldgIdx >= 0 && row[bldgIdx] ? String(row[bldgIdx]).trim() : '';
    const building = rawBuilding.toLowerCase().includes('burhani') ? 'Burhani' : 'Saifee';
    const roomNumber = roomIdx >= 0 && row[roomIdx] ? String(row[roomIdx]).trim() : '';

    let isUploadedToPortal = false;
    if (portalIdx >= 0 && row[portalIdx]) {
      const val = String(row[portalIdx]).trim().toLowerCase();
      isUploadedToPortal = val === 'yes' || val === 'true' || val === '1' || val === 'uploaded' || val === 'ticked';
    }

    parsedList.push({
      itsId: itsId || `30${Math.floor(100000 + Math.random() * 900000)}`,
      applicantName: applicantName || 'Zaer Guest',
      age: age || 45,
      jamaat,
      rotationId,
      category,
      gender,
      family,
      idara: idara || 'Fayz E Husayni Trust Mumbai',
      hofId,
      groupAdmin,
      groupId,
      tourRefNo,
      officeName,
      groupLeadName,
      arrivalDate,
      departureDate,
      rawArrivalStr: rawArr,
      rawDepartureStr: rawDep,
      moneyGiven,
      building,
      roomNumber,
      isUploadedToPortal,
    });
  }

  if (parsedList.length === 0) {
    throw new Error('No applicant records could be recognized in the sheet. Please make sure the file contains at least one row with zaereen information.');
  }

  return parsedList;
}

/**
 * Downloads a pre-formatted sample Excel file matching the exact sequence and headers from user's image:
 * ITS Id | Applicant Name | Age | Jamaat | Rotation Id | Category | Gender | Family | Idara | HOF_ID | GroupAdmin | GROUP_ID | Tour Reference No. | Office Name | Group Lead Name | Arrival Date | Departure Date
 */
export function downloadSampleExcelTemplate(): void {
  const headers = [
    'ITS Id',
    'Applicant Name',
    'Age',
    'Jamaat',
    'Rotation Id',
    'Category',
    'Gender',
    'Family',
    'Idara',
    'HOF_ID',
    'GroupAdmin',
    'GROUP_ID',
    'Tour Reference No.',
    'Office Name',
    'Group Lead Name',
    'Arrival Date',
    'Departure Date',
  ];

  const sampleRows = [
    [
      '30318214',
      'Nafisa Abbas Fatehi',
      65,
      'HATEMI MOHALLA (MUMBAI)',
      '',
      'Mumineen',
      'Female',
      'F-1',
      '',
      '20304504',
      '',
      '1766839506',
      'NKERP/TOUR/2026/1333',
      'Fayz E Husayni Trust Mumbai',
      'Husain Shaikh Asgar Arsiwala',
      "'01-10-2026 11:00 AM",
      "'06-10-2026 01:00 AM",
    ],
    [
      '30423690',
      'Munira Mustafa Vohra',
      47,
      'VALSAD (BALSAR)',
      '',
      'Mumineen',
      'Female',
      'F-2',
      '',
      '30423689',
      '',
      '1766839507',
      'NKERP/TOUR/2026/1333',
      'Fayz E Husayni Trust Mumbai',
      'Husain Shaikh Asgar Arsiwala',
      "'01-10-2026 11:00 AM",
      "'06-10-2026 01:00 AM",
    ],
    [
      '20304504',
      'Husain Shaikh Asgar Arsiwala',
      52,
      'HATEMI MOHALLA (MUMBAI)',
      '',
      'Muntasbeen',
      'Male',
      'F-1',
      '',
      '20304504',
      'Yes',
      '1766839506',
      'NKERP/TOUR/2026/1333',
      'Fayz E Husayni Trust Mumbai',
      'Husain Shaikh Asgar Arsiwala',
      "'01-10-2026 11:00 AM",
      "'06-10-2026 01:00 AM",
    ],
    [
      '40912301',
      'Mustafa Bhai Ebrahim',
      47,
      'DUBAI (UAE)',
      '',
      'Qasreali',
      'Male',
      'F-3',
      'Toloba',
      '40912301',
      '',
      '1766839508',
      'NKERP/TOUR/2026/1334',
      'Dubai Jamaat Office',
      'Mustafa Bhai Ebrahim',
      "'02-10-2026 02:00 PM",
      "'08-10-2026 10:00 AM",
    ],
    [
      '60124982',
      'Taher Bhai Hakimuddin',
      34,
      'NAIROBI (KENYA)',
      '',
      'Baitezainy',
      'Male',
      'F-4',
      'Faiz-e-Husaini',
      '60124982',
      '',
      '1766839509',
      'NKERP/TOUR/2026/1335',
      'Nairobi Office',
      'Taher Bhai Hakimuddin',
      "'03-10-2026 12:00 PM",
      "'09-10-2026 08:00 AM",
    ],
  ];

  const wsData = [headers, ...sampleRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = [
    { wch: 12 }, // ITS Id
    { wch: 28 }, // Applicant Name
    { wch: 6 },  // Age
    { wch: 26 }, // Jamaat
    { wch: 12 }, // Rotation Id
    { wch: 14 }, // Category
    { wch: 10 }, // Gender
    { wch: 10 }, // Family
    { wch: 16 }, // Idara
    { wch: 12 }, // HOF_ID
    { wch: 12 }, // GroupAdmin
    { wch: 14 }, // GROUP_ID
    { wch: 24 }, // Tour Reference No.
    { wch: 28 }, // Office Name
    { wch: 28 }, // Group Lead Name
    { wch: 20 }, // Arrival Date
    { wch: 20 }, // Departure Date
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Zaereen_List');

  XLSX.writeFile(wb, 'Faiz_Husaini_Zaereen_Upload_Template.xlsx');
}

/**
 * Returns default sample rows matching the user's image for quick testing.
 */
export function getSampleZaereenRows(): ParsedZaerRow[] {
  return [
    {
      itsId: '30318214',
      applicantName: 'Nafisa Abbas Fatehi',
      age: 65,
      jamaat: 'HATEMI MOHALLA (MUMBAI)',
      rotationId: '',
      category: 'Mumineen',
      gender: 'Female',
      family: 'F-1',
      idara: 'Fayz E Husayni Trust Mumbai',
      hofId: '20304504',
      groupAdmin: '',
      groupId: '1766839506',
      tourRefNo: 'NKERP/TOUR/2026/1333',
      officeName: 'Fayz E Husayni Trust Mumbai',
      groupLeadName: 'Husain Shaikh Asgar Arsiwala',
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-06',
      rawArrivalStr: "'01-10-2026 11:00 AM",
      rawDepartureStr: "'06-10-2026 01:00 AM",
      moneyGiven: 'Yes',
      building: 'Saifee',
      roomNumber: '101',
      isUploadedToPortal: true,
    },
    {
      itsId: '30423690',
      applicantName: 'Munira Mustafa Vohra',
      age: 47,
      jamaat: 'VALSAD (BALSAR)',
      rotationId: '',
      category: 'Mumineen',
      gender: 'Female',
      family: 'F-2',
      idara: 'Fayz E Husayni Trust Mumbai',
      hofId: '30423689',
      groupAdmin: '',
      groupId: '1766839507',
      tourRefNo: 'NKERP/TOUR/2026/1333',
      officeName: 'Fayz E Husayni Trust Mumbai',
      groupLeadName: 'Husain Shaikh Asgar Arsiwala',
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-06',
      rawArrivalStr: "'01-10-2026 11:00 AM",
      rawDepartureStr: "'06-10-2026 01:00 AM",
      moneyGiven: 'No',
      building: 'Saifee',
      roomNumber: '102',
      isUploadedToPortal: true,
    },
    {
      itsId: '20304504',
      applicantName: 'Husain Shaikh Asgar Arsiwala',
      age: 52,
      jamaat: 'HATEMI MOHALLA (MUMBAI)',
      rotationId: '',
      category: 'Muntasbeen',
      gender: 'Male',
      family: 'F-1',
      idara: 'Fayz E Husayni Trust Mumbai',
      hofId: '20304504',
      groupAdmin: 'Yes',
      groupId: '1766839506',
      tourRefNo: 'NKERP/TOUR/2026/1333',
      officeName: 'Fayz E Husayni Trust Mumbai',
      groupLeadName: 'Husain Shaikh Asgar Arsiwala',
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-06',
      rawArrivalStr: "'01-10-2026 11:00 AM",
      rawDepartureStr: "'06-10-2026 01:00 AM",
      moneyGiven: 'Yes',
      building: 'Saifee',
      roomNumber: '101',
      isUploadedToPortal: true,
    },
    {
      itsId: '40912301',
      applicantName: 'Mustafa Bhai Ebrahim',
      age: 47,
      jamaat: 'DUBAI (UAE)',
      rotationId: '',
      category: 'Qasreali',
      idara: 'Faiz-e-Husaini',
      gender: 'Male',
      family: 'F-3',
      hofId: '40912301',
      groupAdmin: '',
      groupId: '1766839508',
      tourRefNo: 'NKERP/TOUR/2026/1334',
      officeName: 'Dubai Jamaat Office',
      groupLeadName: 'Mustafa Bhai Ebrahim',
      arrivalDate: '2026-10-02',
      departureDate: '2026-10-08',
      rawArrivalStr: "'02-10-2026 02:00 PM",
      rawDepartureStr: "'08-10-2026 10:00 AM",
      moneyGiven: 'No',
      building: 'Burhani',
      roomNumber: '101',
      isUploadedToPortal: false,
    },
    {
      itsId: '60124982',
      applicantName: 'Taher Bhai Hakimuddin',
      age: 34,
      jamaat: 'NAIROBI (KENYA)',
      rotationId: '',
      category: 'Baitezainy',
      idara: 'Faiz-e-Husaini',
      gender: 'Male',
      family: 'F-4',
      hofId: '60124982',
      groupAdmin: '',
      groupId: '1766839509',
      tourRefNo: 'NKERP/TOUR/2026/1335',
      officeName: 'Nairobi Office',
      groupLeadName: 'Taher Bhai Hakimuddin',
      arrivalDate: '2026-10-03',
      departureDate: '2026-10-09',
      rawArrivalStr: "'03-10-2026 12:00 PM",
      rawDepartureStr: "'09-10-2026 08:00 AM",
      moneyGiven: 'No',
      building: 'Burhani',
      roomNumber: '',
      isUploadedToPortal: false,
    },
  ];
}

/**
 * Converts a list of ParsedZaerRow into the app's Reservation model.
 */
export function convertRowsToReservations(
  rows: ParsedZaerRow[],
  existingReservations: Reservation[] = []
): Reservation[] {
  const timestamp = new Date().toISOString();

  return rows.map((row, idx) => {
    const reservationId = `zaer-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
    const isShifted = !!row.moneyGiven && row.moneyGiven === 'Yes';
    const slipNo = `REQ-ACT-${row.family}-${Date.now().toString().slice(-4)}`;

    return {
      id: reservationId,
      itsId: row.itsId,
      applicantName: row.applicantName,
      age: row.age,
      jamaat: row.jamaat || '',
      rotationId: row.rotationId || '',
      category: row.category || 'Mumineen',
      gender: row.gender || 'Male',
      family: row.family,
      idara: row.idara || 'Fayz E Husayni Trust Mumbai',
      hofId: row.hofId || '',
      groupAdmin: row.groupAdmin || '',
      groupId: row.groupId || '',
      tourRefNo: row.tourRefNo,
      officeName: row.officeName,
      groupLeadName: row.groupLeadName,
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      rawArrivalStr: row.rawArrivalStr,
      rawDepartureStr: row.rawDepartureStr,

      // Accommodation Category & B to A shift
      shiftToCategoryA: isShifted,
      accommodationCategory: isShifted ? 'Category A (Nizaam)' : 'Category B (Standard)',
      moneyGiven: isShifted ? (row.moneyGiven || 'Yes') : 'No',
      requestSlipNo: isShifted ? slipNo : undefined,
      requestSlipDate: isShifted ? timestamp.slice(0, 10) : undefined,

      building: row.building || 'Saifee',
      roomNumber: row.roomNumber || '',
      isUploadedToPortal: !!row.isUploadedToPortal,

      // Synced helpers
      familyNumber: row.family,
      familyNo: row.family,
      tourId: row.tourRefNo,
      paxCount: 1,
      pax: 1,
      totalGuests: 1,
      arrivalDateTime: `${row.arrivalDate}T14:00`,
      departureDateTime: `${row.departureDate}T10:00`,
      guestLeaderName: row.groupLeadName,
      isUpgradedFromBToA: isShifted,
      assignedCategory: isShifted ? 'Category A (Nizaam)' : 'Category B (Standard)',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}
