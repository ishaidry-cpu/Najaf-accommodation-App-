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
import { User } from 'firebase/auth';
import { DEFAULT_ZAEREEN_CATEGORIES } from '../types';
import { fetchCategoriesFromGoogleSheetUrl } from '../services/googleSheets';

interface GoogleSheetCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: string[];
  onSaveCategories: (newCategories: string[]) => void;
  user: User | null;
  accessToken: string | null;
}

export const GoogleSheetCategoriesModal: React.FC<GoogleSheetCategoriesModalProps> = ({
  isOpen,
  onClose,
  categories,
  onSaveCategories,
  user,
  accessToken,
}) => {
  if (!isOpen) return null;

  const [sheetUrl, setSheetUrl] = useState('');
  const [currentList, setCurrentList] = useState<string[]>(categories && categories.length > 0 ? categories : DEFAULT_ZAEREEN_CATEGORIES);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Fetch categories from Google Sheet URL or ID
  const handleFetchFromSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetUrl.trim()) {
      setErrorMsg('Please enter a Google Sheet URL or Spreadsheet ID.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const fetched = await fetchCategoriesFromGoogleSheetUrl(sheetUrl.trim(), accessToken);
      if (fetched.length === 0) {
        throw new Error('No category names found in the specified Google Sheet. Please check the sheet format.');
      }

      // Merge with existing or replace
      const merged = Array.from(new Set([...currentList, ...fetched]));
      setCurrentList(merged);
      setSuccessMsg(`Successfully fetched ${fetched.length} categories: ${fetched.join(', ')}`);
    } catch (err: any) {
      console.error('Error fetching categories from Google Sheet:', err);
      setErrorMsg(err.message || 'Failed to fetch categories from Google Sheet.');
    } finally {
      setIsLoading(false);
    }
  };

  // Add category manually
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div 
        className="bg-[#FAF7F2] border border-[#E6DFD5] rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#124E39] text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-[#EBD59E] border border-[#C5A059]/40">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>Google Sheet Categories</span>
                <span className="text-[11px] bg-[#EBD59E] text-[#124E39] px-2 py-0.5 rounded-full font-extrabold uppercase">
                  {currentList.length} Active
                </span>
              </h2>
              <p className="text-xs text-emerald-100/80">
                Fetch and configure Zaereen categories (Mumineen, Muntasbeen, Qasreali, Baitezainy)
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

          {/* Section 1: Fetch From Google Sheet */}
          <div className="bg-white border border-[#E6DFD5] rounded-2xl p-4 shadow-2xs space-y-3">
            <div className="flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-[#124E39]" />
              <h3 className="text-sm font-bold text-[#124E39]">Fetch From Your Google Sheet</h3>
            </div>
            <p className="text-xs text-stone-600">
              Paste the link to your Google Sheet below. To allow instant fetching without login, make sure your sheet sharing is set to <strong className="text-stone-800">"Anyone with the link can view"</strong>.
            </p>

            <form onSubmit={handleFetchFromSheet} className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  className="w-full bg-[#FAF7F2] border border-stone-300 rounded-xl px-3.5 py-2.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#124E39] focus:bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2.5 rounded-xl bg-[#124E39] hover:bg-[#0E3C2C] text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Fetching...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-[#EBD59E]" />
                    <span>Fetch Categories</span>
                  </>
                )}
              </button>
            </form>

            {/* Google Sheet Format Helper */}
            <div className="bg-stone-50 border border-stone-200/80 rounded-xl p-3 text-[11px] text-stone-600 space-y-1.5">
              <div className="font-bold text-stone-800 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-stone-500" />
                <span>How to format your Google Sheet:</span>
              </div>
              <p>
                Create a column named <span className="font-mono font-bold text-emerald-800">Category</span> with rows like:
              </p>
              <div className="font-mono text-[11px] bg-white border border-stone-200 rounded p-2 text-stone-800 max-w-xs">
                <div>Category</div>
                <div className="text-emerald-700">Mumineen</div>
                <div className="text-emerald-700">Muntasbeen</div>
                <div className="text-emerald-700">Qasreali</div>
                <div className="text-emerald-700">Baitezainy</div>
              </div>
            </div>
          </div>

          {/* Section 2: Current Active Categories */}
          <div className="bg-white border border-[#E6DFD5] rounded-2xl p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-[#124E39]" />
                <h3 className="text-sm font-bold text-[#124E39]">Active Categories in System</h3>
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
                  className="group flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[#124E39] font-bold text-xs shadow-2xs hover:bg-emerald-100 transition"
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
                className="flex-1 bg-[#FAF7F2] border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#124E39]"
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
        <div className="p-4 bg-stone-100/80 border-t border-[#E6DFD5] flex items-center justify-between">
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
            className="px-5 py-2.5 rounded-xl bg-[#124E39] hover:bg-[#0E3C2C] text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5"
          >
            <Check className="w-4 h-4 text-[#EBD59E]" />
            <span>Save & Apply Categories</span>
          </button>
        </div>
      </div>
    </div>
  );
};
