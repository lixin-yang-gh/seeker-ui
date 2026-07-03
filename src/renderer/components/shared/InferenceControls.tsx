import React, { useState, useEffect, useCallback, useRef } from 'react';

interface InferenceControlsProps {
  rootFolder: string | null;
  onStartInference: (model: string, temperature: number) => void;
  disabled?: boolean;
  showStartButton?: boolean;
}

const InferenceControls: React.FC<InferenceControlsProps> = ({
  rootFolder,
  onStartInference,
  disabled = false,
  showStartButton = false,
}) => {
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.1);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Load saved state and model list
  useEffect(() => {
    const loadData = async () => {
      setIsLoadingModels(true);
      try {
        // Fetch API settings for models
        const settings = await window.electronAPI.getApiSettings();
        const modelsStr = settings.inferenceModels || '';
        // Parse quoted strings separated by commas
        const parsedModels: string[] = [];
        const regex = /"([^"]*)"/g;
        let match;
        while ((match = regex.exec(modelsStr)) !== null) {
          if (match[1].trim()) parsedModels.push(match[1].trim());
        }
        setModels(parsedModels);

        // Load folder-specific saved values
        if (rootFolder) {
          const folderState = await window.electronAPI.getFolderState(rootFolder);
          if (folderState) {
            setSelectedModel(folderState.inferenceModel || (parsedModels.length > 0 ? parsedModels[0] : ''));
            setTemperature(folderState.temperature ?? 0.1);
          } else {
            // default to first model if available
            if (parsedModels.length > 0) setSelectedModel(parsedModels[0]);
          }
        } else {
          if (parsedModels.length > 0) setSelectedModel(parsedModels[0]);
        }
      } catch (error) {
        console.error('Failed to load inference settings:', error);
      } finally {
        setIsLoadingModels(false);
      }
    };
    loadData();
  }, [rootFolder]);

  // Save state when model or temperature changes (debounced)
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const saveState = useCallback(async (model: string, temp: number) => {
    if (!rootFolder) return;
    try {
      const currentState = await window.electronAPI.getFolderState(rootFolder) || {};
      await window.electronAPI.saveFolderState(rootFolder, {
        ...currentState,
        inferenceModel: model,
        temperature: temp,
      });
    } catch (error) {
      console.error('Failed to save inference state:', error);
    }
  }, [rootFolder]);

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveState(newModel, temperature);
    }, 500);
  };

  const handleTemperatureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (isNaN(val) || val < 0 || val > 2) return;
    setTemperature(val);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveState(selectedModel, val);
    }, 500);
  };

  const handleStart = () => {
    if (selectedModel && !disabled) {
      onStartInference(selectedModel, temperature);
    }
  };

  const isDisabled = disabled || !rootFolder || isLoadingModels || models.length === 0;

  return (
    <div className="inference-controls">
      <div className="inference-controls-row">
        <div className="inference-controls-column">
          <div className="inference-controls-row">
            <div className="inference-control-group">
              <label htmlFor="inference-model">Model</label>
              <select
                id="inference-model"
                value={selectedModel}
                onChange={handleModelChange}
                disabled={isDisabled}
                className="inference-select"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="inference-controls-row">
            <div className="inference-control-group">
              <label htmlFor="inference-temperature">Temperature</label>
              <input
                id="inference-temperature"
                type="number"
                step="0.01"
                min="0"
                max="2"
                value={temperature}
                onChange={handleTemperatureChange}
                disabled={isDisabled}
                className="inference-temp-input"
              />
            </div>
          </div>
        </div>
        {showStartButton && (
          <div className="inference-controls-button-column">
            <button
              className="inference-start-button"
              onClick={handleStart}
              disabled={isDisabled || !selectedModel}
            >
              Start Inference
            </button>
          </div>
        )}
      </div>
      {isLoadingModels && <div className="inference-loading">Loading models…</div>}
      {!isLoadingModels && models.length === 0 && (
        <div className="inference-warning">No models configured in Settings.</div>
      )}
    </div>
  );
};

export default InferenceControls;