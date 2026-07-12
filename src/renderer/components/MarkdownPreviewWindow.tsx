import React, { useState, useEffect } from 'react';
import { getMarkdownModulesPromise, MarkdownModules } from '../../shared/markdown-loader';

const MarkdownPreviewWindow: React.FC = () => {
  const [content, setContent] = useState('');
  const [markdownModules, setMarkdownModules] = useState<MarkdownModules | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [viewMode, setViewMode] = useState<'text' | 'markdown'>('markdown');
  const [zoom, setZoom] = useState<number>(100);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    getMarkdownModulesPromise().then(setMarkdownModules);
  }, []);

  useEffect(() => {
    window.electronAPI.getPreviewSettings().then((settings) => {
      setTheme(settings.theme);
      setViewMode(settings.mode);
      setZoom(settings.zoom ?? 100);
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    const handler = (content: string) => {
      setContent(content);
    };
    window.electronAPI.on('markdown-preview:content', handler);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    window.electronAPI.savePreviewSettings({ theme, mode: viewMode, zoom });
  }, [theme, viewMode, zoom, settingsLoaded]);

  return (
    <div
      className={'file-editor__markdown-modal-content' + (theme === 'light' ? ' file-editor__markdown-modal-content--light' : '')}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5000, overflowY: 'auto' }}
    >
      <div className="file-editor__markdown-modal-header" style={{ position: 'sticky', top: 0 }}>
        <span className="file-editor__markdown-modal-title">Preview</span>
        <div className="file-editor__markdown-modal-header-actions">
          <button
            type="button"
            className="file-editor__markdown-modal-theme-btn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            type="button"
            className={'file-editor__display-format '+ (viewMode === 'text' ? 'file-editor__display-format-selected':'file-editor__display-format-unselected')}
            onClick={() => setViewMode('text')}
            title="Display content as plain text with markdown symbols visible"
          >
            As Text
          </button>
          <button
            type="button"
            className={'file-editor__display-format '+ (viewMode === 'markdown' ? 'file-editor__display-format-selected':'file-editor__display-format-unselected')}
            onClick={() => setViewMode('markdown')}
            title="Display content as rendered markdown"
          >
            As Markdown
          </button>
          <span style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.2)', display: 'inline-block', margin: '0 4px' }} />
          <button
            type="button"
            className={'file-editor__display-format '+ (zoom === 100 ? 'file-editor__display-format-selected':'file-editor__display-format-unselected')}
            onClick={() => setZoom(100)}
            title="Reset zoom to 100%"
          >
            100%
          </button>
          <button
            type="button"
            className={'file-editor__display-format '+ (zoom === 110 ? 'file-editor__display-format-selected':'file-editor__display-format-unselected')}
            onClick={() => setZoom(110)}
            title="Zoom to 110%"
          >
            110%
          </button>
          <button
            type="button"
            className={'file-editor__display-format '+ (zoom === 120 ? 'file-editor__display-format-selected':'file-editor__display-format-unselected')}
            onClick={() => setZoom(120)}
            title="Zoom to 120%"
          >
            120%
          </button>
          <button
            type="button"
            className={'file-editor__display-format '+ (zoom === 150 ? 'file-editor__display-format-selected':'file-editor__display-format-unselected')}
            onClick={() => setZoom(150)}
            title="Zoom to 150%"
          >
            150%
          </button>
        </div>
      </div>
      <div className="file-editor__markdown-modal-body">
        <div className="file-editor__markdown-content" style={{ zoom: zoom / 100 }}>
          {viewMode === 'text' ? (
            <pre className="file-editor__plain-text-view" style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', fontFamily: 'inherit', margin: 0, padding: 0, border: 'none', background: 'transparent', color: 'inherit', fontSize: '15px' }}>{content}</pre>
          ) : markdownModules ? (
            <markdownModules.ReactMarkdown remarkPlugins={[markdownModules.remarkGfm]}>
              {content}
            </markdownModules.ReactMarkdown>
          ) : (
            <div style={{ color: '#888', fontStyle: 'italic', padding: 20 }}>Loading markdown renderer…</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarkdownPreviewWindow;
