import React, { useState, useEffect, useRef, useCallback } from 'react';

const SettingsTab: React.FC = () => {
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [inferenceModels, setInferenceModels] = useState('');
  const [validationModels, setValidationModels] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isApiKeyFocused, setIsApiKeyFocused] = useState(false);
  const isInitialLoad = useRef(true);
  const lastSavedSettingsRef = useRef<{ openRouterApiKey: string; inferenceModels: string; validationModels: string } | null>(null);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await window.electronAPI.getApiSettings();
        setOpenRouterApiKey(settings.openRouterApiKey || '');
        setInferenceModels(settings.inferenceModels || '');
        setValidationModels(settings.validationModels || '');
        // Store loaded values as the baseline for change detection
        lastSavedSettingsRef.current = {
          openRouterApiKey: settings.openRouterApiKey || '',
          inferenceModels: settings.inferenceModels || '',
          validationModels: settings.validationModels || '',
        };
      } catch (err) {
        console.error('Failed to load API settings:', err);
      } finally {
        isInitialLoad.current = false;
      }
    };
    loadSettings();
  }, []);

  const doSave = useCallback(async (key: string, inference: string, validation: string) => {
    try {
      await window.electronAPI.saveApiSettings({
        openRouterApiKey: key,
        inferenceModels: inference,
        validationModels: validation,
      });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
      return; // keep promise resolution
    } catch (err) {
      console.error('Failed to save settings:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
      throw err; // re-throw to allow .catch in the effect
    }
  }, []);

  // Debounced auto-save only when any field has changed from the last saved state
  useEffect(() => {
    if (isInitialLoad.current) return;

    const current = { openRouterApiKey, inferenceModels, validationModels };
    // Skip save if no changes since last successful save
    if (lastSavedSettingsRef.current &&
        current.openRouterApiKey === lastSavedSettingsRef.current.openRouterApiKey &&
        current.inferenceModels === lastSavedSettingsRef.current.inferenceModels &&
        current.validationModels === lastSavedSettingsRef.current.validationModels) {
      return;
    }

    const timer = setTimeout(() => {
      doSave(openRouterApiKey, inferenceModels, validationModels)
        .then(() => {
          // Update snapshot on successful save
          lastSavedSettingsRef.current = { ...current };
        })
        .catch(() => {
          // On error, keep old snapshot so retry may happen on next change
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [openRouterApiKey, inferenceModels, validationModels, doSave]);

  const handleImport = async () => {
    try {
      const filePath = await window.electronAPI.openFileDialog({
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (!filePath) return;

      const fileData = await window.electronAPI.readFile(filePath);
      const settings = JSON.parse(fileData.content);
      // Validate fields
      if (typeof settings.openRouterApiKey === 'string') setOpenRouterApiKey(settings.openRouterApiKey);
      if (typeof settings.inferenceModels === 'string') setInferenceModels(settings.inferenceModels);
      if (typeof settings.validationModels === 'string') setValidationModels(settings.validationModels);
    } catch (err) {
      console.error('Import failed:', err);
      alert('Failed to import settings. Please check the file format.');
    }
  };

  const handleExport = async () => {
    try {
      const filePath = await window.electronAPI.saveFileDialog({
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (!filePath) return;

      const settings = { openRouterApiKey, inferenceModels, validationModels };
      await window.electronAPI.writeFile(filePath, JSON.stringify(settings, null, 2));
      alert('Settings exported successfully.');
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export settings.');
    }
  };

  return (
    <div className="tab-panel settings-tab">
      <div className="settings-group">
        <div className="settings-field">
          <label htmlFor="openRouterApiKey">Open Router API Key</label>
          <input
            id="openRouterApiKey"
            type={isApiKeyFocused ? 'text' : 'password'}
            value={openRouterApiKey}
            onChange={(e) => setOpenRouterApiKey(e.target.value)}
            onFocus={() => setIsApiKeyFocused(true)}
            onBlur={() => setIsApiKeyFocused(false)}
            placeholder="Enter your Open Router API key"
            className="settings-input"
          />
          <small className="settings-hint">The key is hidden by default and becomes visible only when the field has focus.</small>
        </div>
        <div className="settings-field">
          <label htmlFor="inferenceModels">Models for Inference</label>
          <input
            id="inferenceModels"
            type="text"
            value={inferenceModels}
            onChange={(e) => setInferenceModels(e.target.value)}
            placeholder='"model1", "model2", ...'
            className="settings-input"
            title="Enter model names as quoted strings separated by commas"
          />
          <small className="settings-hint">Multiple models: use quoted strings separated by commas, e.g. "gpt-4", "claude-3"</small>
        </div>
        <div className="settings-field">
          <label htmlFor="validationModels">Models for Validation</label>
          <input
            id="validationModels"
            type="text"
            value={validationModels}
            onChange={(e) => setValidationModels(e.target.value)}
            placeholder='"model1", "model2", ...'
            className="settings-input"
            title="Enter model names as quoted strings separated by commas"
          />
          <small className="settings-hint">Multiple models: use quoted strings separated by commas, e.g. "gpt-4", "claude-3"</small>
        </div>
      </div>
      <div className="settings-actions">
        <button className="settings-button" onClick={handleImport}>
          Import
        </button>
        <button className="settings-button" onClick={handleExport}>
          Export
        </button>
        {saveStatus === 'success' && <span className="settings-status success">✓ Saved</span>}
        {saveStatus === 'error' && <span className="settings-status error">✗ Save failed</span>}
      </div>
    </div>
  );
};

export default SettingsTab;