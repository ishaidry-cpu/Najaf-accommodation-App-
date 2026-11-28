import React, { useState } from 'react';
import { CheckCircle2, Eye, KeyRound, ShieldCheck, X } from 'lucide-react';
import { UserRole } from '../types';
import { btn, btnSm, field, fieldLabel, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle } from './ui';

interface RoleManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRole: UserRole;
  adminPin: string;
  onSaveRoleSettings: (newRole: UserRole, newPin: string) => void;
}

const fieldBad = field.replace('border-stone-300', 'border-rose-500');

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
  // Which field the error belongs to, so it can sit right under it.
  const [errorAt, setErrorAt] = useState<'pin' | 'newPin' | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const handleApplyRole = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setErrorAt(null);
    setSuccessMsg('');

    // If currently in receptionist mode and trying to switch to admin, require PIN
    if (currentRole === 'receptionist' && selectedRole === 'admin') {
      if (pinInput.trim() !== adminPin.trim()) {
        setErrorMsg('Incorrect Admin PIN. Please enter the valid Admin PIN to unlock full edit rights.');
        setErrorAt('pin');
        return;
      }
    }

    // Validate new PIN if changing
    if (isChangingPin) {
      if (!newPin || newPin.trim().length < 4) {
        setErrorMsg('Admin PIN must be at least 4 digits or characters.');
        setErrorAt('newPin');
        return;
      }
    }

    onSaveRoleSettings(selectedRole, newPin.trim());
    setSuccessMsg(`Access rights updated to ${selectedRole === 'admin' ? 'Admin (Editable Rights)' : 'Receptionist (View-Only Rights)'}!`);
    setTimeout(() => {
      onClose();
    }, 900);
  };

  const showPin = currentRole === 'receptionist' && selectedRole === 'admin';
  const showNewPin = currentRole === 'admin' && isChangingPin;
  const pinError = errorMsg && errorAt === 'pin' && showPin;
  const newPinError = errorMsg && errorAt === 'newPin' && showNewPin;
  const looseError = errorMsg && !pinError && !newPinError;

  const roles: { role: UserRole; icon: React.ElementType; name: string; summary: string; detail: string }[] = [
    {
      role: 'admin',
      icon: ShieldCheck,
      name: 'Admin',
      summary: 'Can edit',
      detail: 'Full control: allot and unallot rooms, edit and delete zair records, shift B to A, upload Excel, and configure the sync.',
    },
    {
      role: 'receptionist',
      icon: Eye,
      name: 'Receptionist',
      summary: 'View only',
      detail: 'Safe desk mode: view the zaereen list, search rooms, inspect occupancy, and view and print Reception daily slips and Housekeeping slips. Cannot edit, allot or delete.',
    },
  ];

  return (
    <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="role-modal-title">
      <form onSubmit={handleApplyRole} className={`${modalCard} max-w-lg`}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h2 id="role-modal-title" className={modalTitle}>Access rights</h2>
            <p className="mt-1 text-sm text-stone-600">Choose who is using this device. Receptionist is view only; Admin can edit.</p>
          </div>
          <button type="button" onClick={onClose} className={modalClose} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-5 overflow-y-auto">
          <fieldset>
            <legend className={fieldLabel}>Working as</legend>
            <div className="space-y-2">
              {roles.map(({ role, icon: Icon, name, summary, detail }) => {
                const on = selectedRole === role;
                return (
                  <label key={role}
                    className={`flex items-start gap-3 rounded-xl px-3.5 py-3 cursor-pointer transition ring-inset ${
                      on ? 'bg-brand-50 ring-2 ring-brand-600' : 'bg-white ring-1 ring-stone-300 hover:ring-stone-400'}`}>
                    <input
                      type="radio"
                      name="roleOption"
                      checked={on}
                      onChange={() => setSelectedRole(role)}
                      className="mt-1 w-4 h-4 accent-brand-700"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Icon className={`w-4 h-4 ${on ? 'text-brand-700' : 'text-stone-500'}`} />
                        <span className="text-[15px] font-semibold text-stone-950">{name}</span>
                        <span className="text-[13px] text-stone-600">{summary}</span>
                        {currentRole === role && <span className="text-[13px] text-stone-500">· current</span>}
                      </span>
                      <span className="mt-1 block text-[13px] leading-relaxed text-stone-600">{detail}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* PIN check when switching from Receptionist to Admin */}
          {showPin && (
            <div>
              <label htmlFor="role-admin-pin" className={fieldLabel}>Admin PIN</label>
              <input
                id="role-admin-pin"
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Enter 4-digit PIN (Default: 1234)"
                aria-invalid={pinError ? true : undefined}
                className={pinError ? fieldBad : field}
                autoFocus
              />
              {pinError && <p role="alert" className="mt-1.5 text-[13px] font-medium text-rose-700">{errorMsg}</p>}
              <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500">
                Default PIN is <strong className="font-semibold text-stone-700">1234</strong>. This prevents unauthorized editing by desk staff.
              </p>
            </div>
          )}

          {/* Admin PIN settings */}
          {currentRole === 'admin' && (
            <div className="border-t border-stone-200 pt-4">
              <button type="button" onClick={() => setIsChangingPin(!isChangingPin)} aria-expanded={isChangingPin}
                className={`${btnSm.secondary} max-sm:h-10 max-sm:px-3.5`}>
                <KeyRound className="w-3.5 h-3.5 text-stone-500" />
                {isChangingPin ? 'Hide PIN settings' : 'Change admin security PIN'}
              </button>

              {isChangingPin && (
                <div className="mt-4">
                  <label htmlFor="role-new-pin" className={fieldLabel}>New admin security PIN</label>
                  <input
                    id="role-new-pin"
                    type="text"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    placeholder="Enter new 4+ digit PIN"
                    aria-invalid={newPinError ? true : undefined}
                    className={`${newPinError ? fieldBad : field} tabular-nums`}
                  />
                  {newPinError && <p role="alert" className="mt-1.5 text-[13px] font-medium text-rose-700">{errorMsg}</p>}
                  <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500">
                    Keep this PIN secure. You will need it whenever switching back from Receptionist mode.
                  </p>
                </div>
              )}
            </div>
          )}

          {looseError && <p role="alert" className="text-[13px] font-medium text-rose-700">{errorMsg}</p>}

          {successMsg && (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-[13px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </p>
          )}
        </div>

        <div className={modalFooter}>
          <button type="button" onClick={onClose} className={btn.secondary}>Cancel</button>
          <button type="submit" className={btn.primary}>Apply rights</button>
        </div>
      </form>
    </div>
  );
};
