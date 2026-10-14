import React, { useState } from 'react';
import {
  Type,
  ChevronDown,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  CheckSquare,
  Link as LinkIcon,
  Image as ImageIcon,
  Quote,
  MessageSquare,
  Plus
} from 'lucide-react';
import { useDocumentUI } from '../context/DocumentUIContext';
import { CommentsDrawer } from './document/CommentsDrawer';

export interface DocumentFormattingBarProps {
  currentHeading?: string;
  onSelectHeading?: (heading: string) => void;
  onFormatText?: (format: 'bold' | 'italic' | 'underline' | 'strike') => void;
  onAlignText?: (align: 'left' | 'center' | 'right') => void;
  onAddList?: (type: 'bullet' | 'numbered' | 'checklist') => void;
  onInsertMedia?: (type: 'link' | 'image' | 'quote') => void;
  onAddComment?: () => void;
  onAddTask?: () => void;
  onShare?: () => void;
  isInspectorOpen?: boolean;
  onToggleInspector?: () => void;
  documentTitle?: string;
  documentId?: string;
  isOwner?: boolean;
  permission?: 'OWNER' | 'VIEWER' | 'EDITOR';
}

export function DocumentFormattingBar(props: DocumentFormattingBarProps) {

  const docUI = useDocumentUI();

  const currentHeading = props.currentHeading ?? docUI.currentHeading;
  const onSelectHeading = props.onSelectHeading ?? docUI.setCurrentHeading;
  const onAlignText = props.onAlignText ?? docUI.setActiveAlign;
  const onAddList = props.onAddList ?? ((type) => docUI.triggerAddBlock(type));
  const onInsertMedia = props.onInsertMedia ?? ((type) => {
    if (type === 'quote') docUI.triggerAddBlock('quote');
    else if (type === 'image') docUI.toggleHeaderItem('coverImage');
  });
  const onAddTask = props.onAddTask ?? (() => docUI.triggerAddBlock('checklist'));
  const [headingDropdownOpen, setHeadingDropdownOpen] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);

  const headings = ['Normal Text', 'Heading 1', 'Heading 2', 'Heading 3'];

  const handleFormat = (format: 'bold' | 'italic' | 'underline' | 'strike') => {
    docUI.toggleFormat(format);
    if (format === 'bold') document.execCommand('bold');
    else if (format === 'italic') document.execCommand('italic');
    else if (format === 'underline') document.execCommand('underline');
    else if (format === 'strike') document.execCommand('strikeThrough');
    props.onFormatText?.(format);
  };

  const handleInsertLink = () => {
    const url = prompt('Enter hyperlink URL (e.g. https://example.com):');
    if (url) {
      document.execCommand('createLink', false, url);
    }
  };

  return (
    <>
      <div className="h-12 w-full bg-white border-b border-workspace-200 px-4 flex items-center select-none shrink-0 z-20 font-sans overflow-x-auto">
        
        {/* Left Formatting Group */}
        <div className="flex min-w-max items-center gap-1.5">
          
          {/* Vertical Separator */}
          <div className="h-4 w-[1px] bg-workspace-200 mr-1" />

          {/* Heading Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setHeadingDropdownOpen(!headingDropdownOpen)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-workspace-200 hover:border-workspace-300 hover:bg-workspace-50 text-xs font-medium text-workspace-700 transition-colors bg-white cursor-pointer"
            >
              <Type size={13} className="text-workspace-500" />
              <ChevronDown size={11} className="text-workspace-400" />
              <span className="h-3 w-[1px] bg-workspace-200 mx-1" />
              <span className="font-semibold text-workspace-800">{currentHeading}</span>
              <ChevronDown size={11} className="text-workspace-400 ml-0.5" />
            </button>

            {headingDropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setHeadingDropdownOpen(false)} />
                <div className="absolute left-0 top-full mt-1.5 z-40 w-36 bg-white border border-workspace-200 rounded-xl shadow-xl p-1 text-xs animate-fade-in font-sans">
                  {headings.map(h => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => {
                        onSelectHeading(h);
                        setHeadingDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 rounded-lg hover:bg-workspace-100 transition-colors cursor-pointer ${
                        currentHeading === h ? 'text-primary-700 font-semibold bg-primary-50' : 'text-workspace-700'
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="h-4 w-[1px] bg-workspace-200 mx-1" />

          {/* Text Styles: B, I, U, S */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => handleFormat('bold')}
              title="Bold"
              className={`w-7 h-7 flex items-center justify-center rounded-md font-bold text-xs transition-colors cursor-pointer ${
                docUI.activeFormats.bold ? 'bg-primary-50 text-primary-700 font-extrabold' : 'hover:bg-workspace-100 text-workspace-700'
              }`}
            >
              B
            </button>

            <button
              type="button"
              onClick={() => handleFormat('italic')}
              title="Italic"
              className={`w-7 h-7 flex items-center justify-center rounded-md italic font-serif text-xs transition-colors cursor-pointer ${
                docUI.activeFormats.italic ? 'bg-primary-50 text-primary-700 font-bold' : 'hover:bg-workspace-100 text-workspace-700'
              }`}
            >
              I
            </button>

            <button
              type="button"
              onClick={() => handleFormat('underline')}
              title="Underline"
              className={`w-7 h-7 flex items-center justify-center rounded-md underline text-xs transition-colors cursor-pointer ${
                docUI.activeFormats.underline ? 'bg-primary-50 text-primary-700 font-bold' : 'hover:bg-workspace-100 text-workspace-700'
              }`}
            >
              U
            </button>

            <button
              type="button"
              onClick={() => handleFormat('strike')}
              title="Strikethrough"
              className={`w-7 h-7 flex items-center justify-center rounded-md line-through text-xs transition-colors cursor-pointer ${
                docUI.activeFormats.strike ? 'bg-primary-50 text-primary-700 font-bold' : 'hover:bg-workspace-100 text-workspace-700'
              }`}
            >
              S
            </button>
          </div>

          <div className="h-4 w-[1px] bg-workspace-200 mx-1" />

          {/* Alignments */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => onAlignText('left')}
              title="Align Left"
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                docUI.activeAlign === 'left' ? 'bg-primary-50 text-primary-700' : 'text-workspace-600 hover:bg-workspace-100'
              }`}
            >
              <AlignLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => onAlignText('center')}
              title="Align Center"
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                docUI.activeAlign === 'center' ? 'bg-primary-50 text-primary-700' : 'text-workspace-600 hover:bg-workspace-100'
              }`}
            >
              <AlignCenter size={15} />
            </button>
            <button
              type="button"
              onClick={() => onAlignText('right')}
              title="Align Right"
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                docUI.activeAlign === 'right' ? 'bg-primary-50 text-primary-700' : 'text-workspace-600 hover:bg-workspace-100'
              }`}
            >
              <AlignRight size={15} />
            </button>
          </div>

          <div className="h-4 w-[1px] bg-workspace-200 mx-1" />

          {/* Lists */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => onAddList('bullet')}
              title="Bullet List"
              className="p-1.5 rounded-md text-workspace-600 hover:bg-workspace-100 hover:text-workspace-900 transition-colors cursor-pointer"
            >
              <List size={15} />
            </button>
            <button
              type="button"
              onClick={() => onAddList('numbered')}
              title="Numbered List"
              className="p-1.5 rounded-md text-workspace-600 hover:bg-workspace-100 hover:text-workspace-900 transition-colors cursor-pointer"
            >
              <ListOrdered size={15} />
            </button>
            <button
              type="button"
              onClick={() => onAddList('checklist')}
              title="Checkbox List"
              className="p-1.5 rounded-md text-workspace-600 hover:bg-workspace-100 hover:text-workspace-900 transition-colors cursor-pointer"
            >
              <CheckSquare size={15} />
            </button>
          </div>

          <div className="h-4 w-[1px] bg-workspace-200 mx-1" />

          {/* Media Inserts */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={handleInsertLink}
              title="Insert Link"
              className="p-1.5 rounded-md text-workspace-600 hover:bg-workspace-100 hover:text-workspace-900 transition-colors cursor-pointer"
            >
              <LinkIcon size={15} />
            </button>
            <button
              type="button"
              onClick={() => onInsertMedia('image')}
              title="Insert Image / Cover"
              className="p-1.5 rounded-md text-workspace-600 hover:bg-workspace-100 hover:text-workspace-900 transition-colors cursor-pointer"
            >
              <ImageIcon size={15} />
            </button>
            <button
              type="button"
              onClick={() => onInsertMedia('quote')}
              title="Quote"
              className="p-1.5 rounded-md text-workspace-600 hover:bg-workspace-100 hover:text-workspace-900 transition-colors cursor-pointer"
            >
              <Quote size={15} />
            </button>
          </div>

          <div className="h-4 w-[1px] bg-workspace-200 mx-1" />

          {/* Comment & Task Buttons */}
          <button
            type="button"
            onClick={() => setIsCommentsOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-workspace-600 hover:bg-workspace-100 hover:text-workspace-900 transition-colors cursor-pointer"
          >
            <MessageSquare size={14} />
            <span>Comment</span>
          </button>

          <button
            type="button"
            onClick={onAddTask}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-workspace-600 hover:bg-workspace-100 hover:text-workspace-900 transition-colors cursor-pointer"
          >
            <Plus size={14} />
            <span>Task</span>
          </button>

        </div>

      </div>

      {/* Comments Drawer */}
      <CommentsDrawer
        isOpen={isCommentsOpen}
        onClose={() => setIsCommentsOpen(false)}
      />
    </>
  );
}

export default DocumentFormattingBar;
