import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Eye, 
  Lock, 
  Unlock, 
  KeyRound, 
  CheckCircle2, 
  AlertCircle, 
  X,
  UserCheck,
  Printer,
  FileSpreadsheet,
  Trash2,
  Edit3
} from 'lucide-react';
import { UserRole } from '../types';

interface RoleManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRole: UserRole;
  adminPin: string;
  onSaveRoleSettings: (newRole: UserRole, newPin: string) => void;
}

export const RoleManagementModal: React.FC<RoleManagementModalProps> = ({
  isOpen,
  onClose,
  currentRole,
  adminPin,
  onSaveRoleSettings,
}) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>(currentRole);
  const [pinInput, setPinInput] = useState('');
  const [newPin, setNewPin] = useState(adminPin);
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const handleApplyRole = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    // If currently in receptionist mode and trying to switch to admin, require PIN
    if (currentRole === 'receptionist' && selectedRole === 'admin') {
      if (pinInput.trim() !== adminPin.trim()) {
        setErrorMsg('Incorrect Admin PIN. Please enter the valid Admin PIN to unlock full edit rights.');
        return;
      }
    }

    // Validate new PIN if changing
    if (isChangingPin) {
      if (!newPin || newPin.trim().length < 4) {
        setErrorMsg('Admin PIN must be at least 4 digits or characters.');
        return;
      }
    }

    onSaveRoleSettings(selectedRole, newPin.trim());
    setSuccessMsg(`Access rights updated to ${selectedRole === 'admin' ? 'Admin (Editable Rights)' : 'Receptionist (View-Only Rights)'}!`);
    setTimeout(() => {
      onClose();
    }, 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden text-stone-800">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-[#124E39] to-[#0E3C2C] text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white/10 text-[#EBD59E]">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold font-serif">
                Access Rights & Role Management
              </h2>
              <p className="text-xs text-stone-300">
                Configure View-Only for Receptionist & Editable Rights for Admin
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-300 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleApplyRole} className="p-5 space-y-4">
          
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs flex items-center gap-2 font-bold">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Role Cards */}
          <div className="space-y-3">
            <span className="text-xs font-bold text-stone-700 block">
              Select Active Working Mode:
            </span>

            {/* Admin (Myself) Card */}
            <div
              onClick={() => setSelectedRole('admin')}
              className={`p-3.5 rounded-xl border-2 transition cursor-pointer flex items-start gap-3 ${
                selectedRole === 'admin'
                  ? 'border-[#124E39] bg-emerald-50/80 shadow-xs'
                  : 'border-stone-200 bg-white hover:border-stone-300'
              }`}
            >
              <input
                type="radio"
                name="roleOption"
                checked={selectedRole === 'admin'}
                onChange={() => setSelectedRole('admin')}
                className="mt-1 text-[#124E39] focus:ring-[#124E39]"
              />
              <div className="space-y-1 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[#124E39] flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    Admin / Myself (Full Editable Rights)
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900">
                    Full Access
                  </span>
                </div>
                <p className="text-[11px] text-stone-600">
                  Full control: Allot rooms, unallot, edit zaer records, delete zaer records, shift B to A, upload Excel, and configure sync.
                </p>
                <div className="flex flex-wrap gap-2 text-[10px] text-emerald-900 font-semibold pt-1">
                  <span className="flex items-center gap-0.5"><Edit3 className="w-3 h-3" /> Edit</span>
                  <span className="flex items-center gap-0.5"><Trash2 className="w-3 h-3" /> Delete</span>
                  <span className="flex items-center gap-0.5"><FileSpreadsheet className="w-3 h-3" /> Upload</span>
                </div>
              </div>
            </div>

            {/* Receptionist Card */}
            <div
              onClick={() => setSelectedRole('receptionist')}
              className={`p-3.5 rounded-xl border-2 transition cursor-pointer flex items-start gap-3 ${
                selectedRole === 'receptionist'
                  ? 'border-[#124E39] bg-amber-50/80 shadow-xs'
                  : 'border-stone-200 bg-white hover:border-stone-300'
              }`}
            >
              <input
                type="radio"
                name="roleOption"
                checked={selectedRole === 'receptionist'}
                onChange={() => setSelectedRole('receptionist')}
                className="mt-1 text-[#124E39] focus:ring-[#124E39]"
              />
              <div className="space-y-1 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-amber-950 flex items-center gap-1.5">
                    <Eye className="w-4 h-4 text-amber-700" />
                    Receptionist (View-Only Rights)
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                    View Only
                  </span>
                </div>
                <p className="text-[11px] text-stone-600">
                  Safe desk mode: View zaereen list, search rooms, inspect occupancy, view & print Reception Daily Slips and Housekeeping Slips. Cannot edit, allot, or delete.
                </p>
                <div className="flex flex-wrap gap-2 text-[10px] text-amber-900 font-semibold pt-1">
                  <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" /> Read Only</span>
                  <span className="flex items-center gap-0.5"><Printer className="w-3 h-3" /> Print Slips</span>
                  <span className="flex items-center gap-0.5 text-stone-500">🔒 Editing Locked</span>
                </div>
              </div>
            </div>
          </div>

          {/* PIN Verification when switching from Receptionist to Admin */}
          {currentRole === 'receptionist' && selectedRole === 'admin' && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 space-y-2">
              <label className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-amber-800" />
                Enter Admin PIN to Unlock Edit Rights:
              </label>
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Enter 4-digit PIN (Default: 1234)"
                className="w-full px-3 py-1.5 text-sm bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#124E39]"
                autoFocus
              />
              <p className="text-[10px] text-amber-800">
                Default PIN is <strong>1234</strong>. This prevents unauthorized editing by desk staff.
              </p>
            </div>
          )}

          {/* Admin PIN Settings Accordion */}
          {currentRole === 'admin' && (
            <div className="pt-2 border-t border-stone-200 text-xs">
              <button
                type="button"
                onClick={() => setIsChangingPin(!isChangingPin)}
                className="text-[#124E39] font-bold underline hover:text-[#0E3C2C] flex items-center gap-1 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{isChangingPin ? 'Hide PIN Settings' : 'Change Admin Security PIN'}</span>
              </button>

              {isChangingPin && (
                <div className="mt-2.5 p-3 rounded-xl bg-white border border-[#D5CDBD] space-y-2">
                  <label className="block text-[11px] font-bold text-stone-700">
                    New Admin Security PIN:
                  </label>
                  <input
                    type="text"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    placeholder="Enter new 4+ digit PIN"
                    className="w-full px-3 py-1.5 text-xs bg-stone-50 border border-stone-300 rounded-lg font-mono font-bold"
                  />
                  <p className="text-[10px] text-stone-500">
                    Keep this PIN secure. You will need it whenever switching back from Receptionist mode.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-3 border-t border-stone-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-stone-600 hover:bg-stone-200 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-extrabold bg-[#124E39] hover:bg-[#0E3C2C] text-white shadow-sm transition"
            >
              Apply Rights
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
