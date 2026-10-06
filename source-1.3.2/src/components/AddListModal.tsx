import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle,
  Database,
  Trash2,
  AlertCircle,
  Users,
  HardDrive,
  FileCheck,
} from 'lucide-react';
import { MasterListSheet } from '../types';
import {
  getStoredRosters,
  getActiveRosterIds,
  toggleActiveRoster,
  addRosterSheet,
  deleteRosterSheet,
  parseExcelOrCsvFile,
  downloadExcelTemplate,
} from '../utils/rosterStorage';

interface AddListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRosterUpdated?: () => void;
}

export const AddListModal: React.FC<AddListModalProps> = ({
  isOpen,
  onClose,
  onRosterUpdated,
}) => {
  const [rosters, setRosters] = useState<MasterListSheet[]>([]);
  // Every file currently selected as a roster (several can be active at once).
  const [activeIds, setActiveIds] = useState<string[]>([]);
  // "Set as roster file" choice for the file being added.
  const [setAsRoster, setSetAsRoster] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [previewRoster, setPreviewRoster] = useState<MasterListSheet | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const stored = getStoredRosters();
      setRosters(stored);
      setActiveIds(getActiveRosterIds());
      setUploadError(null);
      setSuccessMessage(null);
      setPreviewRoster(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setSuccessMessage(null);

    try {
      const parsedSheet = await parseExcelOrCsvFile(file);
      setPreviewRoster(parsedSheet);
      // Default: select it only if it is the first file. Otherwise the current
      // selection stays exactly as it is unless the user ticks the box.
      setSetAsRoster(getStoredRosters().length === 0);
      setSuccessMessage(`✓ Successfully read "${file.name}": found ${parsedSheet.totalRecords} students across ${parsedSheet.divisions.length} divisions.`);
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to read file. Please ensure it is a valid Excel spreadsheet (.xlsx or .xls).');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSavePreview = () => {
    if (!previewRoster) return;

    const isFirstFile = rosters.length === 0;
    const updated = addRosterSheet(previewRoster, setAsRoster);
    setRosters(updated);
    setActiveIds(getActiveRosterIds());
    setPreviewRoster(null);
    const nowActive = getActiveRosterIds().includes(previewRoster.id);
    setSuccessMessage(
      isFirstFile
        ? `✓ "${previewRoster.name}" is stored and is your roster file.`
        : nowActive
        ? `✓ "${previewRoster.name}" is stored and added to your roster files. Your other selections are unchanged.`
        : `✓ "${previewRoster.name}" is stored. Your roster selection was not changed. Tick its box to use it.`
    );

    if (onRosterUpdated) {
      onRosterUpdated();
    }
  };

  // Tick / untick a stored file as a roster file. Several can be on at once.
  const handleToggleActive = (id: string) => {
    if (rosters.length <= 1) return; // a single file is the roster automatically
    toggleActiveRoster(id);
    const ids = getActiveRosterIds();
    setActiveIds(ids);
    setSuccessMessage(
      ids.length === 0
        ? 'No roster file is selected. Tick at least one to match attendance.'
        : `✓ ${ids.length} roster file${ids.length > 1 ? 's' : ''} selected for matching.`
    );
    if (onRosterUpdated) {
      onRosterUpdated();
    }
  };

  const handleDeleteRoster = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const remaining = deleteRosterSheet(id);
    setRosters(remaining);
    setActiveIds(getActiveRosterIds());
    if (onRosterUpdated) {
      onRosterUpdated();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-3xl bg-[#111722] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0d121c] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white">Add Master Roster (Local PC Storage)</h3>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 rounded">
                  Chrome Extension Store Ready
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Keep your Excel sheet stored locally. RollTrack matches attendee names against their Roll No and Division.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Top Instructions / Column requirements */}
          <div className="bg-[#0b0e14] border border-slate-800/90 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <HardDrive className="w-4 h-4 text-blue-400" />
                <span>Required Columns in your Excel Sheet:</span>
              </div>
              <p className="text-xs text-slate-400">
                <strong className="text-blue-300">Name</strong> (joining name) ·{' '}
                <strong className="text-emerald-300">Roll No</strong> (e.g. 101, 201) ·{' '}
                <strong className="text-amber-300">Division</strong> (e.g. Division A, Div B, Sec C)
              </p>
            </div>

            <button
              onClick={downloadExcelTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-800/60 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Download formatted Excel template (.xlsx)"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Download Excel Template</span>
            </button>
          </div>

          {/* Upload Drop Zone - STRICTLY EXCEL ONLY */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-blue-500/50 hover:border-blue-400 bg-[#0d121c]/70 hover:bg-[#121927]/80 rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all group"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
            />
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 mx-auto mb-3 group-hover:scale-105 transition-transform">
              <Upload className="w-6 h-6" />
            </div>

            <h4 className="text-sm font-semibold text-white">
              {isUploading ? 'Reading Excel file from your PC...' : 'Click to Upload Excel File (.xlsx only)'}
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Select your local <span className="text-emerald-300 font-mono font-bold">.xlsx</span> or{' '}
              <span className="text-emerald-300 font-mono font-bold">.xls</span> spreadsheet containing Name, Roll No, and Division columns.
            </p>
            <span className="inline-block mt-2 px-2.5 py-0.5 text-[10px] font-semibold text-blue-300 bg-blue-950/70 border border-blue-800/60 rounded-full">
              Excel Files Only (.xlsx / .xls)
            </span>
          </div>

          {/* Error / Success Banners */}
          {uploadError && (
            <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-800/60 text-red-300 rounded-xl text-xs animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-center gap-2 p-3 bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 rounded-xl text-xs animate-fadeIn">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Preview of newly parsed sheet before saving */}
          {previewRoster && (
            <div className="bg-[#0b0e14] border border-blue-900/50 rounded-xl p-4 space-y-3 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-blue-400" />
                    <span>Preview: {previewRoster.name}</span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    {previewRoster.totalRecords} students parsed · Divisions found:{' '}
                    <strong className="text-slate-200">{previewRoster.divisions.join(', ')}</strong>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {rosters.length > 0 && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={setAsRoster}
                        onChange={(e) => setSetAsRoster(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-slate-700 bg-[#0b0e14]"
                      />
                      <span>Set as roster file</span>
                    </label>
                  )}
                  <button
                    onClick={() => setPreviewRoster(null)}
                    className="px-3 py-1 text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    Discard
                  </button>
                  <button
                    onClick={handleSavePreview}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-all"
                  >
                    {rosters.length === 0 ? 'Save as Roster File' : setAsRoster ? 'Save & Add to Roster Files' : 'Save (keep current selection)'}
                  </button>
                </div>
              </div>

              {/* Sample parsed table */}
              <div className="max-h-44 overflow-y-auto pr-1 custom-scrollbar text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                      <th className="py-1 px-2">ROLL NO</th>
                      <th className="py-1 px-2">JOINING NAME</th>
                      <th className="py-1 px-2">DIVISION</th>
                      <th className="py-1 px-2">EMAIL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40 font-mono">
                    {previewRoster.students.slice(0, 10).map((std) => (
                      <tr key={std.id} className="hover:bg-slate-800/30">
                        <td className="py-1.5 px-2 text-blue-300 font-bold">#{std.rollNo}</td>
                        <td className="py-1.5 px-2 text-slate-200 font-sans font-medium">{std.name}</td>
                        <td className="py-1.5 px-2 text-amber-300">{std.division}</td>
                        <td className="py-1.5 px-2 text-slate-400 text-[11px]">{std.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewRoster.students.length > 10 && (
                  <p className="text-center text-[11px] text-slate-500 py-1 font-sans">
                    + {previewRoster.students.length - 10} more student records ready for storage.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Currently Stored Rosters in Local Storage */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-blue-400" />
                <span>Stored Master Rosters in Local PC Storage ({rosters.length})</span>
              </h4>
              <span className="text-[11px] text-slate-500">
                Tick one or more files to use them as roster files
              </span>
            </div>

            {rosters.length > 1 && activeIds.length === 0 && (
              <div className="flex items-center gap-2 p-2.5 bg-amber-950/30 border border-amber-800/50 text-amber-300 rounded-lg text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>No roster file is selected. Tick at least one file to match attendance.</span>
              </div>
            )}
            {activeIds.length > 1 && (
              <p className="text-[11px] text-slate-500">
                Several files are selected. If a student is in more than one, RollTrack warns you before matching. The file marked
                #1 takes priority.
              </p>
            )}

            <div className="space-y-2">
              {rosters.length === 0 ? (
                <div className="p-5 text-center bg-[#0d121c] border border-slate-800 rounded-xl text-slate-400 text-xs">
                  No master roster uploaded yet. Upload your class/division Excel sheet above (.xlsx) to match attendee roll numbers.
                </div>
              ) : (
                rosters.map((roster) => {
                  const isActive = activeIds.includes(roster.id);
                  const isOnly = rosters.length === 1;
                  const priority = isActive ? activeIds.indexOf(roster.id) + 1 : 0;
                  return (
                    <div
                      key={roster.id}
                      onClick={() => handleToggleActive(roster.id)}
                      className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${
                        isOnly ? 'cursor-default' : 'cursor-pointer'
                      } ${
                        isActive
                          ? 'bg-blue-950/40 border-blue-500/80 shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                          : 'bg-[#0d121c] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isActive}
                          disabled={isOnly}
                          onChange={() => handleToggleActive(roster.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 rounded border-slate-700 bg-[#0b0e14] shrink-0"
                          aria-label={`Use ${roster.name} as a roster file`}
                        />
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h5 className="text-xs sm:text-sm font-semibold text-white">
                              {roster.name}
                            </h5>
                            {isActive && (
                              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-blue-600 text-white rounded">
                                Roster file{activeIds.length > 1 ? ` #${priority}` : ''}
                              </span>
                            )}
                            {isOnly && (
                              <span className="text-[10px] text-slate-500">only file, used automatically</span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                            <span className="text-slate-300 font-medium">
                              {roster.totalRecords} students
                            </span>
                            <span>·</span>
                            <span className="text-amber-300">
                              Divisions: {roster.divisions.join(', ')}
                            </span>
                            <span>·</span>
                            <span>Uploaded {roster.uploadedAt}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <button
                          onClick={(e) => handleDeleteRoster(roster.id, e)}
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                          title="Delete roster from storage"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-[#0d121c] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 text-xs">
          <div className="text-slate-400 flex items-center gap-1.5 self-start sm:self-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Local PC Storage synced with Chrome Extension</span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg shadow-sm cursor-pointer transition-all"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
