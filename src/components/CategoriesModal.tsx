import React, { useState } from 'react';
import { Check, CheckCircle2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { DEFAULT_ZAEREEN_CATEGORIES } from '../types';
import { btn, btnSm, field, fieldLabel, modalCard, modalClose, modalFooter, modalHeader, modalScrim, modalTitle } from './ui';

interface CategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: string[];
  onSaveCategories: (newCategories: string[]) => void;
}

/** Compact buttons grow to the 40px touch size on phones. */
const tap = (cls: string) => `${cls} max-sm:h-10 max-sm:px-3.5`;

export const CategoriesModal: React.FC<CategoriesModalProps> = ({
  isOpen,
  onClose,
  categories,
  onSaveCategories,
}) => {
  if (!isOpen) return null;

  const [currentList, setCurrentList] = useState<string[]>(categories && categories.length > 0 ? categories : DEFAULT_ZAEREEN_CATEGORIES);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Which part of the dialog the error belongs to, so it can sit right under it.
  const [errorAt, setErrorAt] = useState<'add' | 'list'>('list');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleAddManualCategory = () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    if (currentList.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setErrorMsg(`"${trimmed}" is already in the categories list.`);
      setErrorAt('add');
      return;
    }
    setCurrentList([...currentList, trimmed]);
    setNewCategoryInput('');
    setErrorMsg(null);
  };

  // Remove category
  const handleRemoveCategory = (catToRemove: string) => {
    if (currentList.length <= 1) {
      setErrorMsg('You must have at least one category.');
      setErrorAt('list');
      return;
    }
    setCurrentList(currentList.filter((c) => c !== catToRemove));
    setErrorMsg(null);
  };

  // Reset to default
  const handleResetToDefault = () => {
    setCurrentList(DEFAULT_ZAEREEN_CATEGORIES);
    setSuccessMsg('Reset to standard categories: Mumineen, Muntasbeen, Qasreali, Baitezainy.');
    setErrorMsg(null);
  };

  // Save changes
  const handleSaveAndApply = () => {
    onSaveCategories(currentList);
    onClose();
  };

  const addError = errorMsg && errorAt === 'add';
  const listError = errorMsg && errorAt === 'list';

  return (
    <div className={modalScrim} role="dialog" aria-modal="true" aria-labelledby="categories-modal-title">
      <div className={`${modalCard} max-w-lg`} onClick={(e) => e.stopPropagation()}>
        <div className={modalHeader}>
          <div className="min-w-0">
            <h2 id="categories-modal-title" className={modalTitle}>Zaereen categories</h2>
            <p className="mt-1 text-sm text-stone-600">
              The categories a zair can be given, such as Mumineen, Muntasbeen, Qasreali and Baitezainy.
            </p>
          </div>
          <button type="button" onClick={onClose} className={modalClose} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-5 overflow-y-auto">
          <div>
            <div className="flex items-end justify-between gap-3 mb-1.5">
              <h3 className="text-[13px] font-medium text-stone-700">
                Active categories <span className="font-normal text-stone-500 tabular-nums">({currentList.length})</span>
              </h3>
              <button type="button" onClick={handleResetToDefault} className={tap(btnSm.ghost)}>
                <RotateCcw className="w-3.5 h-3.5" />
                Reset to standard
              </button>
            </div>
            <ul className="divide-y divide-stone-200 rounded-xl ring-1 ring-inset ring-stone-200">
              {currentList.map((cat) => (
                <li key={cat} className="flex items-center justify-between gap-3 min-h-11 pl-3.5 pr-1.5 py-1">
                  <span className="min-w-0 break-words text-sm font-medium text-stone-900">{cat}</span>
                  <button type="button" onClick={() => handleRemoveCategory(cat)} title={`Remove ${cat}`} className={tap(btnSm.danger)}>
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {listError && <p role="alert" className="mt-1.5 text-[13px] font-medium text-rose-700">{errorMsg}</p>}
            {successMsg && (
              <p role="status" className="mt-2 flex items-start gap-2 text-[13px] font-medium text-emerald-800">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                <span>{successMsg}</span>
              </p>
            )}
          </div>

          <div>
            <label htmlFor="categories-add-input" className={fieldLabel}>Add a category</label>
            <div className="flex items-center gap-2">
              <input
                id="categories-add-input"
                type="text"
                placeholder="For example Mahad or Staff"
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddManualCategory();
                  }
                }}
                aria-invalid={addError ? true : undefined}
                className={addError ? field.replace('border-stone-300', 'border-rose-500') : field}
              />
              <button type="button" onClick={handleAddManualCategory} className={`${btn.secondary} shrink-0`}>
                <Plus className="w-4 h-4 text-stone-500" />
                Add
              </button>
            </div>
            {addError
              ? <p role="alert" className="mt-1.5 text-[13px] font-medium text-rose-700">{errorMsg}</p>
              : <p className="mt-1.5 text-[13px] text-stone-500">Changes apply when you save.</p>}
          </div>
        </div>

        <div className={modalFooter}>
          <button type="button" onClick={onClose} className={btn.secondary}>Cancel</button>
          <button type="button" onClick={handleSaveAndApply} className={btn.primary}>
            <Check className="w-4 h-4" />
            Save categories
          </button>
        </div>
      </div>
    </div>
  );
};
