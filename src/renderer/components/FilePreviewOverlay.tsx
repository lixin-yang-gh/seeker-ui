import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/file_preview_overlay.css';
import { FileContent } from '../../shared/types';

interface FilePreviewOverlayProps {
  filePath: string | null;
  rootFolder?: string | null;
  content: FileContent;
  onClose: () => void;
  onSave?: (content: string) => void | Promise<void>;
}

const FilePreviewOverlay: React.FC<FilePreviewOverlayProps> = ({
  filePath,
  rootFolder,
  content,
  onClose,
  onSave,
}) => {
  const initialContent = content?.content ?? '';
  const [editedContent, setEditedContent] = useState<string>(initialContent);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isEditable, setIsEditable] = useState<boolean>(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [wordWrap, setWordWrap] = useState<boolean>(false);
  const DEFAULT_FONT_SIZE = 13;
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const originalContentRef = useRef<string>(initialContent);
  // Track whether the initial font size has been loaded from the store so we
  // do not immediately overwrite a freshly-loaded value on the first render.
  const fontSizeLoadedRef = useRef<boolean>(false);

  // Load persisted font size for this root folder on mount (or when rootFolder changes).
  useEffect(() => {
    if (!rootFolder) return;
    let cancelled = false;
    const load = async () => {
      try {
        const folderState = await window.electronAPI.getFolderState(rootFolder);
        if (cancelled) return;
        if (folderState?.previewFontSize && typeof folderState.previewFontSize === 'number') {
          setFontSize(folderState.previewFontSize);
        }
      } catch (err) {
        console.error('FilePreviewOverlay: failed to load font size', err);
      } finally {
        if (!cancelled) fontSizeLoadedRef.current = true;
      }
    };
    load();
    return () => { cancelled = true; };
  }, [rootFolder]);

  // Debounce-persist font size changes to the folder-specific store.
  useEffect(() => {
    if (!rootFolder || !fontSizeLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const currentState = (await window.electronAPI.getFolderState(rootFolder)) || {};
        await window.electronAPI.saveFolderState(rootFolder, {
          ...currentState,
          previewFontSize: fontSize,
        });
      } catch (err) {
        console.error('FilePreviewOverlay: failed to persist font size', err);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [fontSize, rootFolder]);

  // Reset state whenever the overlay is (re)opened with new content/file
  useEffect(() => {
    setEditedContent(initialContent);
    originalContentRef.current = initialContent;
    setIsDirty(false);
    setIsEditable(false);
    setShowUnsavedModal(false);
    setSaveStatus('idle');
    setSaveError(null);
  }, [initialContent, filePath]);

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setEditedContent(newValue);
      setIsDirty(newValue !== originalContentRef.current);
    },
    []
  );

  const performSave = useCallback(
    async (newContent: string) => {
      if (onSave) {
        await onSave(newContent);
      } else if (filePath) {
        // Default behavior: write directly through the electron bridge
        await window.electronAPI.writeFile(filePath, newContent);
      }
    },
    [onSave, filePath]
  );

  // Intercept close attempts to warn about unsaved changes
  const attemptClose = useCallback(() => {
    if (isDirty) {
      setShowUnsavedModal(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const handleKeepChanges = useCallback(async () => {
    try {
      await performSave(editedContent);
    } catch (err) {
      console.error('Failed to save file:', err);
      // Do not close on save failure — leave the modal open so the user knows
      return;
    }
    originalContentRef.current = editedContent;
    setIsDirty(false);
    setShowUnsavedModal(false);
    onClose();
  }, [editedContent, performSave, onClose]);

  const handleAbandonChanges = useCallback(() => {
    setEditedContent(originalContentRef.current);
    setIsDirty(false);
    setShowUnsavedModal(false);
    onClose();
  }, [onClose]);

  const handleCancelClose = useCallback(() => {
    setShowUnsavedModal(false);
  }, []);

  // Toolbar: Enter edit mode
  const handleEdit = useCallback(() => {
    setIsEditable(true);
  }, []);

  // Toolbar: Save current changes AND close the overlay
  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await performSave(editedContent);
      originalContentRef.current = editedContent;
      setIsDirty(false);
      setSaveStatus('success');
      // Close the overlay after successful save
      onClose();
    } catch (err) {
      console.error('Failed to save file:', err);
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [isDirty, editedContent, performSave, onClose]);

  // Toolbar: Revert edits back to the original file content, exit edit mode,
  // and re-hide Save/Revert All while showing Edit again.
  const handleRevert = useCallback(async () => {
    let originalFromDisk = originalContentRef.current;
    if (filePath) {
      try {
        const fileData = await window.electronAPI.readFile(filePath);
        originalFromDisk = fileData?.content ?? originalContentRef.current;
        originalContentRef.current = originalFromDisk;
      } catch (err) {
        console.error('Failed to reload file for revert:', err);
      }
    }
    setEditedContent(originalFromDisk);
    setIsDirty(false);
    setIsEditable(false);
    setSaveStatus('idle');
    setSaveError(null);
  }, [filePath]);

  // Handle ESC key to close (also routed through attemptClose) and Ctrl/Cmd+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showUnsavedModal) {
          handleCancelClose();
        } else {
          attemptClose();
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (isEditable && isDirty && saveStatus !== 'saving') {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showUnsavedModal, attemptClose, handleCancelClose, isEditable, isDirty, saveStatus, handleSave]);

  return (
    <div className="file-preview-overlay" onClick={attemptClose}>
      <div
        className="file-preview-overlay__content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="file-preview-overlay__header">
          <span className="file-preview-overlay__path" title={filePath ?? ''}>
            {filePath ?? '(untitled)'}
            {isDirty && <span className="file-preview-overlay__dirty"> • Modified</span>}
          </span>
          <button
            type="button"
            className="file-preview-overlay__close"
            onClick={attemptClose}
            aria-label="Close preview"
          >
            ×
          </button>
        </div>

        <div className="file-preview-overlay__toolbar">
          <div className="file-preview-overlay__toolbar-status">
            {saveError && (
              <span className="file-preview-overlay__toolbar-error" title={saveError}>
                {saveError}
              </span>
            )}
            {!saveError && isEditable && isDirty && (
              <span className="file-preview-overlay__toolbar-hint">Unsaved changes</span>
            )}
            {!saveError && isEditable && !isDirty && (
              <span className="file-preview-overlay__toolbar-hint" style={{ color: '#4ec9b0', fontStyle: 'normal' }}>
                Editing enabled
              </span>
            )}
          </div>
          <div className="file-preview-overlay__toolbar-group">
            <button
              type="button"
              className={
                'file-preview-overlay__toolbar-btn' +
                (wordWrap ? ' file-preview-overlay__toolbar-btn--primary' : ' file-preview-overlay__toolbar-btn--secondary')
              }
              onClick={() => setWordWrap((w) => !w)}
              title={wordWrap ? 'Disable word wrap (show long lines on a single line with horizontal scrolling)' : 'Enable word wrap (wrap long lines to fit the editor width)'}
              aria-pressed={wordWrap}
            >
              Word {wordWrap ? 'Wrap: On' : 'Wrap: Off'}
            </button>
            <button
              type="button"
              className="file-preview-overlay__toolbar-btn file-preview-overlay__toolbar-btn--secondary"
              onClick={() => setFontSize(DEFAULT_FONT_SIZE)}
              title={`Revert font size to the default (${DEFAULT_FONT_SIZE}px)`}
              disabled={fontSize === DEFAULT_FONT_SIZE}
            >
              Font: Reset
            </button>
            <button
              type="button"
              className="file-preview-overlay__toolbar-btn file-preview-overlay__toolbar-btn--secondary"
              onClick={() => setFontSize((s) => s + 2)}
              title="Increase font size by 2 pixels"
            >
              Font: +2 ({fontSize}px)
            </button>
            {!isEditable && (
              <button
                type="button"
                className="file-preview-overlay__toolbar-btn file-preview-overlay__toolbar-btn--primary"
                onClick={handleEdit}
                title="Enable editing of this file"
              >
                Edit
              </button>
            )}
            {isEditable && (
              <>
                <button
                  type="button"
                  className={
                    'file-preview-overlay__toolbar-btn file-preview-overlay__toolbar-btn--primary' +
                    (saveStatus === 'success' ? ' file-preview-overlay__toolbar-btn--success' : '') +
                    (saveStatus === 'error' ? ' file-preview-overlay__toolbar-btn--error' : '')
                  }
                  onClick={handleSave}
                  disabled={!isDirty || saveStatus === 'saving'}
                  title="Save changes and close preview (Ctrl/Cmd+S)"
                >
                  {saveStatus === 'saving'
                    ? 'Saving…'
                    : saveStatus === 'success'
                      ? '✓ Saved'
                      : saveStatus === 'error'
                        ? '✗ Save failed'
                        : 'Save'}
                </button>
                <button
                  type="button"
                  className="file-preview-overlay__toolbar-btn file-preview-overlay__toolbar-btn--secondary"
                  onClick={handleRevert}
                  disabled={saveStatus === 'saving'}
                  title="Reload the original file content and exit edit mode"
                >
                  Revert All
                </button>
              </>
            )}
          </div>
        </div>

        <div className="file-preview-overlay__body">
          <textarea
            className="file-preview-overlay__editor"
            value={editedContent}
            onChange={handleContentChange}
            readOnly={!isEditable}
            spellCheck={false}
            style={{
              whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
              wordBreak: wordWrap ? 'break-word' : 'normal',
              overflowWrap: wordWrap ? 'break-word' : 'normal',
              fontSize: `${fontSize}px`,
            }}
          />
        </div>

        {showUnsavedModal && (
          <div
            className="file-preview-overlay__modal-backdrop"
            onClick={handleCancelClose}
          >
            <div
              className="file-preview-overlay__modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="unsaved-changes-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                id="unsaved-changes-title"
                className="file-preview-overlay__modal-title"
              >
                Unsaved Changes
              </h3>
              <p className="file-preview-overlay__modal-message">
                You have unsaved changes to this file. Do you want to save them
                before closing, or abandon them?
              </p>
              <div className="file-preview-overlay__modal-actions">
                <button
                  type="button"
                  className="file-preview-overlay__modal-btn file-preview-overlay__modal-btn--secondary"
                  onClick={handleCancelClose}
                  title="Cancel and return to editing"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="file-preview-overlay__modal-btn file-preview-overlay__modal-btn--danger"
                  onClick={handleAbandonChanges}
                  title="Discard all unsaved changes and close"
                >
                  Abandon Changes
                </button>
                <button
                  type="button"
                  className="file-preview-overlay__modal-btn file-preview-overlay__modal-btn--primary"
                  onClick={handleKeepChanges}
                  title="Save changes and close"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FilePreviewOverlay;
