import React from 'react';
import { 
  FileText, 
  Printer, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Building2, 
  Calendar, 
  Users, 
  MapPin, 
  Receipt,
  Stamp,
  ArrowRight
} from 'lucide-react';
import jsPDF from 'jspdf';
import { Reservation, MoneyGivenStatus } from '../types';
import { FaizHusainiLogo } from './FaizHusainiLogo';

interface AccountsRequestSlipModalProps {
  reservation: Reservation | null;
  onClose: () => void;
  onToggleMoneyGiven: (id: string, newStatus: MoneyGivenStatus) => void;
}

export const AccountsRequestSlipModal: React.FC<AccountsRequestSlipModalProps> = ({
  reservation,
  onClose,
  onToggleMoneyGiven,
}) => {
  if (!reservation) return null;

  const isPaid = reservation.moneyGiven === 'Yes';
  const slipNo = reservation.requestSlipNo || `SLIP-${reservation.family || reservation.familyNumber || 'FAM'}-${Date.now().toString().slice(-4)}`;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdfSlip = () => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a5',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Border
    doc.setDrawColor(18, 78, 57);
    doc.setLineWidth(2);
    doc.rect(15, 15, pageWidth - 30, pageHeight - 30);

    // Header Background
    doc.setFillColor(18, 78, 57);
    doc.rect(17, 17, pageWidth - 34, 55, 'F');

    // Title
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('FAIZ HUSAINI — ACCOMMODATION OFFICE', pageWidth / 2, 38, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(235, 213, 158);
    doc.text('ACCOUNTS DEPARTMENT • CATEGORY B TO A SHIFT REQUEST SLIP', pageWidth / 2, 54, { align: 'center' });

    // Slip Number & Date
    doc.setFontSize(9);
    doc.setTextColor(18, 78, 57);
    doc.setFont('helvetica', 'bold');
    doc.text(`Slip No: ${slipNo}`, 30, 95);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth - 30, 95, { align: 'right' });

    // Divider
    doc.setDrawColor(203, 213, 225);
    doc.line(30, 105, pageWidth - 30, 105);

    // Details Grid
    let y = 125;
    const items = [
      ['ITS Id', reservation.itsId || '—'],
      ['Applicant Name', reservation.applicantName || reservation.guestLeaderName || '—'],
      ['Age / Gender', `${reservation.age || '—'} Yrs / ${reservation.gender || '—'}`],
      ['Category Request', 'Category B (Standard) ➔ Category A (Nizaam)'],
      ['Idara', reservation.idara || 'Faiz-e-Husaini'],
      ['Family Number', reservation.family || reservation.familyNumber || '—'],
      ['Tour Reference No.', reservation.tourRefNo || reservation.tourId || '—'],
      ['Office Name', reservation.officeName || '—'],
      ['Group Lead Name', reservation.groupLeadName || reservation.applicantName || '—'],
      ['Arrival Date', reservation.arrivalDate || '—'],
      ['Departure Date', reservation.departureDate || '—'],
      ['Assigned Hotel & Room', `${reservation.building || 'Saifee'} (Room ${reservation.roomNumber || 'Pending'})`],
      ['Money Given Status', isPaid ? 'YES (FEE RECEIVED)' : 'NO (PAYMENT PENDING)'],
    ];

    items.forEach(([label, val]) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(label, 30, y);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      if (label === 'Money Given Status') {
        if (isPaid) {
          doc.setTextColor(22, 101, 52); // green
        } else {
          doc.setTextColor(180, 83, 9); // amber
        }
      } else {
        doc.setTextColor(15, 23, 42);
      }
      doc.text(String(val), 160, y);

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(30, y + 4, pageWidth - 30, y + 4);

      y += 18;
    });

    // Accounts instructions box
    doc.setFillColor(245, 242, 235); // Beige
    doc.rect(30, y + 8, pageWidth - 60, 40, 'F');
    doc.setDrawColor(18, 78, 57);
    doc.rect(30, y + 8, pageWidth - 60, 40, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(18, 78, 57);
    doc.text('ACCOUNTS DEPARTMENT INSTRUCTION:', 38, y + 22);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      'Please collect category B to A differential tariff and mark "Money Given" in the accommodation portal.',
      38,
      y + 35
    );

    // Signatures
    const sigY = pageHeight - 65;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('_____________________________', 30, sigY);
    doc.text('Prepared by: Accommodation Desk', 30, sigY + 12);

    doc.text('_____________________________', pageWidth - 160, sigY);
    doc.text('Received by: Accounts Cashier', pageWidth - 160, sigY + 12);

    doc.save(`Faiz_Husaini_Accounts_Slip_${reservation.family || 'FAM'}_${slipNo}.pdf`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-xl w-full p-6 shadow-2xl relative text-stone-800 flex flex-col max-h-[92vh]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="print:hidden absolute top-4 right-4 text-stone-500 hover:text-stone-800 p-1.5 rounded-lg hover:bg-stone-200/60 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="print:hidden flex items-center justify-between pb-3 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <FaizHusainiLogo size="sm" showSubtitle={false} />
            <span className="text-xs font-bold text-[#124E39]">
              Accounts Shift Slip
            </span>
          </div>
          <div className="flex items-center gap-2 mr-8">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-stone-800 hover:bg-stone-900 text-white shadow transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Slip</span>
            </button>
            <button
              onClick={handleDownloadPdfSlip}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow transition"
            >
              <Download className="w-3.5 h-3.5 text-[#EBD59E]" />
              <span>PDF Slip</span>
            </button>
          </div>
        </div>

        {/* Slip Paper View */}
        <div className="flex-1 overflow-y-auto mt-3 p-5 sm:p-6 bg-white border border-[#E6DFD5] rounded-xl shadow-sm text-xs space-y-4 print:m-0 print:p-0 print:border-none print:shadow-none">
          {/* Slip Top Header */}
          <div className="text-center pb-3 border-b-2 border-[#124E39]">
            <div className="flex justify-center mb-1">
              <FaizHusainiLogo size="md" />
            </div>
            <div className="inline-block bg-[#124E39] text-[#EBD59E] font-bold text-[10px] uppercase px-3 py-0.5 rounded tracking-wider mt-1">
              ACCOUNTS DEPARTMENT REQUEST SLIP
            </div>
            <div className="text-[11px] font-semibold text-stone-600 mt-1">
              Category Shift: <strong className="text-stone-900">B to A (Nizaam)</strong>
            </div>
          </div>

          {/* Slip Meta */}
          <div className="flex justify-between items-center text-[11px] bg-stone-50 p-2.5 rounded-lg border border-stone-200">
            <div>
              <span className="text-stone-500">Slip No: </span>
              <span className="font-mono font-bold text-[#124E39]">{slipNo}</span>
            </div>
            <div>
              <span className="text-stone-500">Date: </span>
              <span className="font-medium text-stone-800">{new Date().toLocaleDateString()}</span>
            </div>
          </div>

          {/* Data Table */}
          <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-[11px] pt-1">
            <div className="border-b border-stone-100 pb-1.5">
              <div className="text-stone-500 text-[10px]">ITS ID:</div>
              <div className="font-mono font-bold text-stone-900">{reservation.itsId || '—'}</div>
            </div>

            <div className="border-b border-stone-100 pb-1.5">
              <div className="text-stone-500 text-[10px]">Applicant Name:</div>
              <div className="font-semibold text-stone-900">{reservation.applicantName || reservation.guestLeaderName || '—'}</div>
            </div>

            <div className="border-b border-stone-100 pb-1.5">
              <div className="text-stone-500 text-[10px]">Age / Gender:</div>
              <div className="text-stone-800">{reservation.age || '—'} Yrs / {reservation.gender || '—'}</div>
            </div>

            <div className="border-b border-stone-100 pb-1.5">
              <div className="text-stone-500 text-[10px]">Idara:</div>
              <div className="text-stone-800 font-medium">{reservation.idara || 'Faiz-e-Husaini'}</div>
            </div>

            <div className="border-b border-stone-100 pb-1.5">
              <div className="text-stone-500 text-[10px]">Family Number:</div>
              <div className="font-mono font-bold text-emerald-800">{reservation.family || reservation.familyNumber || '—'}</div>
            </div>

            <div className="border-b border-stone-100 pb-1.5">
              <div className="text-stone-500 text-[10px]">Tour Reference No:</div>
              <div className="font-mono font-semibold text-stone-900">{reservation.tourRefNo || reservation.tourId || '—'}</div>
            </div>

            <div className="border-b border-stone-100 pb-1.5">
              <div className="text-stone-500 text-[10px]">Office Name:</div>
              <div className="text-stone-800">{reservation.officeName || '—'}</div>
            </div>

            <div className="border-b border-stone-100 pb-1.5">
              <div className="text-stone-500 text-[10px]">Group Lead Name:</div>
              <div className="text-stone-800">{reservation.groupLeadName || reservation.applicantName || '—'}</div>
            </div>

            <div className="border-b border-stone-100 pb-1.5">
              <div className="text-stone-500 text-[10px]">Arrival Date:</div>
              <div className="text-stone-800">{reservation.arrivalDate || '—'}</div>
            </div>

            <div className="border-b border-stone-100 pb-1.5">
              <div className="text-stone-500 text-[10px]">Departure Date:</div>
              <div className="text-stone-800">{reservation.departureDate || '—'}</div>
            </div>

            <div className="col-span-2 bg-[#FAF7F2] p-2.5 rounded-lg border border-[#E6DFD5] flex items-center justify-between">
              <div>
                <div className="text-stone-500 text-[10px]">Assigned Hotel & Room:</div>
                <div className="font-bold text-[#124E39] text-xs">
                  {reservation.building || 'Saifee'} Hotel — Room {reservation.roomNumber || 'Pending Allotment'}
                </div>
              </div>

              {/* Money Given Toggle */}
              <div className="text-right">
                <div className="text-[10px] text-stone-500 mb-0.5">Money Given Option:</div>
                <button
                  type="button"
                  onClick={() => onToggleMoneyGiven(reservation.id, isPaid ? 'No' : 'Yes')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition shadow-sm ${
                    isPaid
                      ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                      : 'bg-amber-600 text-white hover:bg-amber-700'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Money Given: {reservation.moneyGiven}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Accounts Notice */}
          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900">
            <strong>Accounts Procedure:</strong> The Zair has requested to shift category from B to A. Please collect payment and update the record status.
          </div>

          {/* Signatures */}
          <div className="pt-4 border-t border-stone-200 grid grid-cols-2 gap-4 text-[10px] text-stone-500">
            <div>
              <div className="border-b border-stone-300 w-32 mb-1" />
              <div>Prepared By: Accommodation Officer</div>
            </div>
            <div className="text-right">
              <div className="border-b border-stone-300 w-32 mb-1 ml-auto" />
              <div>Accounts Department Cashier Stamp</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
