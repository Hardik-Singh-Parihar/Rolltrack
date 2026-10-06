import React from 'react';
import { FileSpreadsheet, UploadCloud, Eye } from 'lucide-react';

interface NavbarProps {
  onAddListClick: () => void;
  onHomeClick: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onAddListClick,
  onHomeClick,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full bg-[#0b0e14]/95 backdrop-blur-md border-b border-slate-800/80">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        {/* Logo */}
        <button
          onClick={onHomeClick}
          className="flex items-center gap-2.5 group cursor-pointer focus:outline-none"
        >
          <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/50 flex items-center justify-center shadow-[0_0_12px_rgba(59,130,246,0.5)] group-hover:scale-105 transition-transform">
            <Eye className="w-4 h-4 text-blue-400" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white group-hover:text-blue-200 transition-colors">
            RollTrack
          </span>
        </button>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Add List Button (Local PC Storage Excel Roster) */}
          <button
            onClick={onAddListClick}
            className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 active:scale-95 rounded-lg shadow-[0_0_12px_rgba(37,99,235,0.4)] transition-all cursor-pointer"
            title="Manage master rosters and Excel sheets from your PC"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Add List</span>
          </button>
        </div>
      </div>
    </header>
  );
};
