import React, { useState } from 'react';
import {
  FileText,
  X,
  Image as ImageIcon,
  Type,
  User,
  Users,
  Calendar,
  List,
  Layers,
  Lock,
  Download,
  Trash2,
  Check
} from 'lucide-react';
import {
  FontFamily,
  FontSize,
  PageWidth,
  HeaderToggles
} from '../types/documentTheme';
import { useDocumentUI } from '../context/DocumentUIContext';

export interface DocumentInspectorProps {
  isOpen?: boolean;
  onClose?: () => void;
  fontFamily?: FontFamily;
  onChangeFontFamily?: (font: FontFamily) => void;
  fontSize?: FontSize;
  onChangeFontSize?: (size: FontSize) => void;
  pageWidth?: PageWidth;
  onChangePageWidth?: (width: PageWidth) => void;
  headerToggles?: HeaderToggles;
  onToggleHeaderItem?: (key: keyof HeaderToggles) => void;
  isLocked?: boolean;
  onToggleLock?: () => void;
}

export function DocumentInspector(props: DocumentInspectorProps) {
  const docUI = useDocumentUI();
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic');
  const [savedSettingsFeedback, setSavedSettingsFeedback] = useState(false);

  const isOpen = props.isOpen ?? docUI.isInspectorOpen;
  const onClose = props.onClose ?? (() => docUI.setIsInspectorOpen(false));
  const fontFamily = props.fontFamily ?? docUI.fontFamily;
  const onChangeFontFamily = props.onChangeFontFamily ?? docUI.setFontFamily;
  const fontSize = props.fontSize ?? docUI.fontSize;
  const onChangeFontSize = props.onChangeFontSize ?? docUI.setFontSize;
  const pageWidth = props.pageWidth ?? docUI.pageWidth;
  const onChangePageWidth = props.onChangePageWidth ?? docUI.setPageWidth;
  const headerToggles = props.headerToggles ?? docUI.headerToggles;
  const onToggleHeaderItem = props.onToggleHeaderItem ?? docUI.toggleHeaderItem;

  const handleApplyToAll = () => {
    localStorage.setItem(
      'syncspace_doc_theme',
      JSON.stringify({ fontFamily, fontSize, pageWidth })
    );
    setSavedSettingsFeedback(true);
    setTimeout(() => setSavedSettingsFeedback(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(320px,88vw)] flex-col border-l border-workspace-200 bg-white h-full overflow-y-auto custom-scrollbar select-none shadow-[-2px_0_12px_rgba(0,0,0,0.04)] animate-slide-in font-sans sm:relative sm:inset-auto sm:z-20 sm:w-[min(320px,42vw)] sm:min-w-[240px] sm:shrink-0 sm:shadow-none">
      
      {/* Top Header with Icon, Title and Close */}
      <div className="h-14 min-h-14 px-5 flex items-center justify-between border-b border-workspace-200">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-primary-50 border border-primary-100 flex items-center justify-center text-primary-600">
            <FileText size={14} />
          </div>
          <span className="text-sm font-bold text-workspace-900 tracking-tight">Page Details</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="p-1 rounded-md text-workspace-400 hover:text-workspace-600 hover:bg-workspace-100 transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs: Basic / Advanced */}
      <div className="px-5 border-b border-workspace-200 flex items-center gap-6 mt-1">
        <button
          type="button"
          onClick={() => setActiveTab('basic')}
          className={`text-xs pb-2 transition-all relative font-medium cursor-pointer ${
            activeTab === 'basic'
              ? 'text-primary-700 font-bold border-b-2 border-primary-600'
              : 'text-workspace-500 hover:text-workspace-800'
          }`}
        >
          Basic
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('advanced')}
          className={`text-xs pb-2 transition-all relative font-medium cursor-pointer ${
            activeTab === 'advanced'
              ? 'text-primary-700 font-bold border-b-2 border-primary-600'
              : 'text-workspace-500 hover:text-workspace-800'
          }`}
        >
          Advanced
        </button>
      </div>

      {activeTab === 'basic' ? (
        /* Basic Tab Content */
        <div className="p-5 space-y-5 text-workspace-800 text-xs">
          
          {/* 1. Font Section */}
          <div>
            <div className="text-xs font-semibold text-workspace-800 mb-2">Font</div>
            <div className="grid grid-cols-3 gap-2">
              
              {/* Sans */}
              <button
                type="button"
                onClick={() => onChangeFontFamily('sans')}
                className={`py-3 px-2 rounded-xl text-center transition-all cursor-pointer ${
                  fontFamily === 'sans'
                    ? 'border-2 border-primary-500 bg-primary-50 text-primary-700 shadow-xs'
                    : 'border border-workspace-200 bg-white hover:bg-workspace-50 text-workspace-700'
                }`}
              >
                <div className="text-xl font-bold font-sans leading-none">Aa</div>
                <div className="text-[11px] mt-2 font-medium">Sans</div>
              </button>

              {/* Serif */}
              <button
                type="button"
                onClick={() => onChangeFontFamily('serif')}
                className={`py-3 px-2 rounded-xl text-center transition-all cursor-pointer ${
                  fontFamily === 'serif'
                    ? 'border-2 border-primary-500 bg-primary-50 text-primary-700 shadow-xs'
                    : 'border border-workspace-200 bg-white hover:bg-workspace-50 text-workspace-700'
                }`}
              >
                <div className="text-xl font-bold font-serif leading-none">Aa</div>
                <div className="text-[11px] mt-2 font-medium">Serif</div>
              </button>

              {/* Mono */}
              <button
                type="button"
                onClick={() => onChangeFontFamily('mono')}
                className={`py-3 px-2 rounded-xl text-center transition-all cursor-pointer ${
                  fontFamily === 'mono'
                    ? 'border-2 border-primary-500 bg-primary-50 text-primary-700 shadow-xs'
                    : 'border border-workspace-200 bg-white hover:bg-workspace-50 text-workspace-700'
                }`}
              >
                <div className="text-xl font-bold font-mono leading-none">Aa</div>
                <div className="text-[11px] mt-2 font-medium">Mono</div>
              </button>

            </div>
          </div>

          {/* 2. Font Size Section */}
          <div>
            <div className="text-xs font-semibold text-workspace-800 mb-2">Font Size</div>
            <div className="grid grid-cols-3 p-1 bg-workspace-100 rounded-xl text-center font-medium">
              {(['small', 'normal', 'large'] as FontSize[]).map(size => {
                const isSelected = fontSize === size;
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => onChangeFontSize(size)}
                    className={`py-1.5 rounded-lg text-xs capitalize transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-primary-50 text-primary-700 font-semibold shadow-xs'
                        : 'text-workspace-600 hover:text-workspace-900'
                    }`}
                  >
                    {size}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Page Width Section */}
          <div>
            <div className="text-xs font-semibold text-workspace-800 mb-2">Page Width</div>
            <div className="grid grid-cols-2 p-1 bg-workspace-100 rounded-xl text-center font-medium">
              <button
                type="button"
                onClick={() => onChangePageWidth('normal')}
                className={`py-1.5 rounded-lg text-xs capitalize transition-all cursor-pointer ${
                  pageWidth === 'normal'
                    ? 'bg-primary-50 text-primary-700 font-semibold shadow-xs'
                    : 'text-workspace-600 hover:text-workspace-900'
                }`}
              >
                Normal
              </button>
              <button
                type="button"
                onClick={() => onChangePageWidth('large')}
                className={`py-1.5 rounded-lg text-xs capitalize transition-all cursor-pointer ${
                  pageWidth === 'large'
                    ? 'bg-primary-50 text-primary-700 font-semibold shadow-xs'
                    : 'text-workspace-600 hover:text-workspace-900'
                }`}
              >
                Large
              </button>
            </div>
            <button
              type="button"
              onClick={handleApplyToAll}
              className="text-xs text-primary-600 hover:text-primary-700 mt-2.5 text-center w-full block font-medium cursor-pointer transition-colors"
            >
              {savedSettingsFeedback ? (
                <span className="text-emerald-600 font-semibold flex items-center justify-center gap-1">
                  <Check size={12} strokeWidth={3} /> Changes applied to all pages!
                </span>
              ) : (
                'Apply changes to all pages'
              )}
            </button>
          </div>

          {/* 4. Header Section */}
          <div className="pt-1 border-t border-workspace-100">
            <div className="text-xs font-semibold text-workspace-800 mb-3 pt-2">Header</div>

            <div className="space-y-3">
              
              {/* Cover image */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-workspace-700 text-xs font-medium">
                  <ImageIcon size={15} className="text-workspace-400" />
                  <span>Cover image</span>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleHeaderItem('coverImage')}
                  className={`w-9 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                    headerToggles.coverImage ? 'bg-primary-600' : 'bg-workspace-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform shadow-xs ${
                      headerToggles.coverImage ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Page title & icon */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-workspace-700 text-xs font-medium">
                  <FileText size={15} className="text-workspace-400" />
                  <span>Page title & icon</span>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleHeaderItem('pageTitleIcon')}
                  className={`w-9 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                    headerToggles.pageTitleIcon ? 'bg-primary-600' : 'bg-workspace-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform shadow-xs ${
                      headerToggles.pageTitleIcon ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Subtitle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-workspace-700 text-xs font-medium">
                  <Type size={15} className="text-workspace-400" />
                  <span>Subtitle</span>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleHeaderItem('subtitle')}
                  className={`w-9 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                    headerToggles.subtitle ? 'bg-primary-600' : 'bg-workspace-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform shadow-xs ${
                      headerToggles.subtitle ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Author */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-workspace-700 text-xs font-medium">
                  <User size={15} className="text-workspace-400" />
                  <span>Author</span>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleHeaderItem('author')}
                  className={`w-9 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                    headerToggles.author ? 'bg-primary-600' : 'bg-workspace-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform shadow-xs ${
                      headerToggles.author ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Contributors */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-workspace-700 text-xs font-medium">
                  <Users size={15} className="text-workspace-400" />
                  <span>Contributors</span>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleHeaderItem('contributors')}
                  className={`w-9 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                    headerToggles.contributors ? 'bg-primary-600' : 'bg-workspace-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform shadow-xs ${
                      headerToggles.contributors ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Date */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-workspace-700 text-xs font-medium">
                  <Calendar size={15} className="text-workspace-400" />
                  <span>Date</span>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleHeaderItem('date')}
                  className={`w-9 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                    headerToggles.date ? 'bg-primary-600' : 'bg-workspace-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform shadow-xs ${
                      headerToggles.date ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Page outline */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-workspace-700 text-xs font-medium">
                  <List size={15} className="text-workspace-400" />
                  <span>Page outline</span>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleHeaderItem('pageOutline')}
                  className={`w-9 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                    headerToggles.pageOutline ? 'bg-primary-600' : 'bg-workspace-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform shadow-xs ${
                      headerToggles.pageOutline ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Subpages */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-workspace-700 text-xs font-medium">
                  <Layers size={15} className="text-workspace-400" />
                  <span>Subpages</span>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleHeaderItem('subpages')}
                  className={`w-9 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                    headerToggles.subpages ? 'bg-primary-600' : 'bg-workspace-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform shadow-xs ${
                      headerToggles.subpages ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

            </div>
          </div>

        </div>
      ) : (
        /* Advanced Tab Content */
        <div className="p-5 space-y-4 text-xs text-workspace-700">
          <div className="p-3 bg-workspace-50 rounded-xl border border-workspace-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock size={15} className="text-workspace-500" />
              <div>
                <div className="font-semibold text-workspace-800">Lock page</div>
                <div className="text-[11px] text-workspace-500">Prevent accidental edits</div>
              </div>
            </div>
            <button
              type="button"
              onClick={props.onToggleLock || (() => {})}
              className={`w-9 h-5 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                props.isLocked ? 'bg-primary-600' : 'bg-workspace-200'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform shadow-xs ${
                  props.isLocked ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="w-full py-2.5 px-3 rounded-xl border border-workspace-200 hover:bg-workspace-50 flex items-center gap-2 text-workspace-700 font-medium transition-colors cursor-pointer"
          >
            <Download size={15} className="text-workspace-500" />
            <span>Export as PDF / Print</span>
          </button>

          <button
            type="button"
            onClick={() => alert('Document duplicated.')}
            className="w-full py-2.5 px-3 rounded-xl border border-workspace-200 hover:bg-workspace-50 flex items-center gap-2 text-workspace-700 font-medium transition-colors cursor-pointer"
          >
            <Layers size={15} className="text-workspace-500" />
            <span>Duplicate Page</span>
          </button>

          <div className="pt-3 border-t border-workspace-100">
            <button
              type="button"
              onClick={() => alert('To delete this document, use the trash option in dashboard.')}
              className="w-full py-2.5 px-3 rounded-xl hover:bg-rose-50 text-rose-600 font-medium flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Trash2 size={15} />
              <span>Delete Page</span>
            </button>
          </div>
        </div>
      )}

    </aside>
  );
}

export default DocumentInspector;
