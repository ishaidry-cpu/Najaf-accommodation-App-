import React, { useState } from 'react';
import { 
  FileSpreadsheet, 
  ExternalLink, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  Trash2, 
  X, 
  Tag, 
  Link as LinkIcon,
  Sparkles,
  Info,
  Check
} from 'lucide-react';
import { DEFAULT_ZAEREEN_CATEGORIES } from '../types';

interface CategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: string[];
  onSaveCategories: (newCategories: string[]) => void;
}

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
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleAddManualCategory = () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    if (currentList.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setErrorMsg(`"${trimmed}" is already in the categories list.`);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/45 backdrop-blur-[2px]">
      <div 
        className="bg-stone-50 border border-stone-200 rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-brand-700 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-gold-200 border border-gold-400/40">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>Zaereen categories</span>
                <span className="text-[11px] bg-gold-200 text-brand-700 px-2 py-0.5 rounded-full font-extrabold uppercase">
                  {currentList.length} Active
                </span>
              </h2>
              <p className="text-xs text-emerald-100/80">
                Configure Zaereen categories (Mumineen, Muntasbeen, Qasreali, Baitezainy)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          
          {/* Feedback Alerts */}
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3.5 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">{errorMsg}</div>
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl p-3.5 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{successMsg}</div>
            </div>
          )}

          {/* Section 2: Current Active Categories */}
          <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-brand-700" />
                <h3 className="text-sm font-bold text-brand-700">Active Categories in System</h3>
              </div>
              <button
                type="button"
                onClick={handleResetToDefault}
                className="text-[11px] font-bold text-stone-500 hover:text-stone-800 underline"
              >
                Reset to Standard Defaults
              </button>
            </div>

            {/* Categories Pills */}
            <div className="flex flex-wrap gap-2 pt-1">
              {currentList.map((cat) => (
                <div
                  key={cat}
                  className="group flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-brand-700 font-bold text-xs shadow-2xs hover:bg-emerald-100 transition"
                >
                  <span>{cat}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCategory(cat)}
                    className="text-stone-400 group-hover:text-red-600 hover:bg-white/60 p-0.5 rounded transition"
                    title={`Remove ${cat}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Quick Add Manual Category */}
            <div className="pt-2 flex items-center gap-2">
              <input
                type="text"
                placeholder="Add custom category name (e.g. Mahad, Staff)..."
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddManualCategory();
                  }
                }}
                className="flex-1 bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-700"
              />
              <button
                type="button"
                onClick={handleAddManualCategory}
                className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold transition flex items-center gap-1 border border-stone-300 shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-stone-100/80 border-t border-stone-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-stone-300 hover:bg-white text-stone-700 text-xs font-bold transition"
          >
            Cancel
          </button>
          
          <button
            type="button"
            onClick={handleSaveAndApply}
            className="px-5 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5"
          >
            <Check className="w-4 h-4 text-gold-200" />
            <span>Save & Apply Categories</span>
          </button>
        </div>
      </div>
    </div>
  );
};
