import React, { useState, useEffect } from 'react';
import { parseMaskedSubstrings } from '../../../shared/utils';

const SettingsTab: React.FC = () => {
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [inferenceModels, setInferenceModels] = useState('');
  const [validationModels, setValidationModels] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await window.electronAPI.getApiSettings();
        setOpenRouterApiKey(settings.openRouterApiKey || '');
        setInferenceModels(settings.inferenceModels || '');
        setValidationModels(settings.validationModels || '');
      } catch (err) {
        console.error('Failed to load API settings:', err);
      }
    };
    loadSettings();
  }, []);

  const handleSave = async () => {
    try {
      await window.electronAPI.saveApiSettings({
        openRouterApiKey,
        inferenceModels,
        validationModels
      });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

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
      <h3>API Settings</h3>
      <div className="settings-group">
        <div className="settings-field">
          <label htmlFor="openRouterApiKey">Open Router API Key</label>
          <input
            id="openRouterApiKey"
            type="text"
            value={openRouterApiKey}
            onChange={(e) => setOpenRouterApiKey(e.target.value)}
            placeholder="Enter your Open Router API key"
            className="settings-input"
          />
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
        <button className="settings-button primary" onClick={handleSave}>
          Save
        </button>
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