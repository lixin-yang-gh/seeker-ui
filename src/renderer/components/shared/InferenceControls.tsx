import React, { useState, useEffect, useCallback, useRef } from 'react';

export type ApiTarget = 'OpenRouter' | 'Venice';
export type MaxTokenChoice = '32K' | '64K';

export const MAX_TOKEN_VALUES: Record<MaxTokenChoice, number> = {
  '32K': 32_768,
  '64K': 65_536,
};

interface InferenceControlsProps {
  rootFolder: string | null;
  onStartInference: (
    model: string,
    temperature: number,
    apiTarget: ApiTarget,
    maxTokens: number
  ) => void;
  disabled?: boolean;
  showStartButton?: boolean;
  /** Optional override label for the start button */
  startButtonLabel?: string;
}

const InferenceControls: React.FC<InferenceControlsProps> = ({
  rootFolder,
  onStartInference,
  disabled = false,
  showStartButton = false,
  startButtonLabel = 'Start Inference',
}) => {
  const [openRouterModels, setOpenRouterModels] = useState<string[]>([]);
  const [veniceModels, setVeniceModels] = useState<string[]>([]);
  const [apiTarget, setApiTarget] = useState<ApiTarget>('OpenRouter');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.7);
  const [maxTokenChoice, setMaxTokenChoice] = useState<MaxTokenChoice>('32K');
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  const parseModels = (modelsStr: string): string[] => {
    const parsed: string[] = [];
    const regex = /"([^"]*)"/g;
    let match;
    while ((match = regex.exec(modelsStr || '')) !== null) {
      if (match[1].trim()) parsed.push(match[1].trim());
    }
    return parsed;
  };

  // Load saved state and model list
  useEffect(() => {
    const loadData = async () => {
      setIsLoadingModels(true);
      try {
        const settings = await window.electronAPI.getApiSettings();
        const orModels = parseModels(settings.inferenceModels || '');
        const venModels = parseModels(settings.veniceInferenceModels || '');
        setOpenRouterModels(orModels);
        setVeniceModels(venModels);

        let initialApi: ApiTarget = 'OpenRouter';
        let initialModel = orModels[0] || '';
        let initialTemp = 0.7;
        let initialMax: MaxTokenChoice = '32K';

        if (rootFolder) {
          const folderState = await window.electronAPI.getFolderState(rootFolder);
          if (folderState) {
            const savedApi = (folderState as any).apiTarget as ApiTarget | undefined;
            if (savedApi === 'OpenRouter' || savedApi === 'Venice') initialApi = savedApi;
            const savedMax = (folderState as any).maxTokenChoice as MaxTokenChoice | undefined;
            if (savedMax === '32K' || savedMax === '64K') initialMax = savedMax;
            initialTemp = folderState.temperature ?? 0.7;

            const poolForApi = initialApi === 'Venice' ? venModels : orModels;
            initialModel = folderState.inferenceModel || poolForApi[0] || '';
            // If saved model isn't in the pool, fall back to first model of the pool
            if (initialModel && !poolForApi.includes(initialModel)) {
              initialModel = poolForApi[0] || '';
            }
          }
        }

        setApiTarget(initialApi);
        setSelectedModel(initialModel);
        setTemperature(initialTemp);
        setMaxTokenChoice(initialMax);
      } catch (error) {
        console.error('Failed to load inference settings:', error);
      } finally {
        setIsLoadingModels(false);
      }
    };
    loadData();
  }, [rootFolder]);

  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const saveState = useCallback(
    async (model: string, temp: number, api: ApiTarget, mtc: MaxTokenChoice) => {
      if (!rootFolder) return;
      try {
        const currentState = (await window.electronAPI.getFolderState(rootFolder)) || {};
        await window.electronAPI.saveFolderState(rootFolder, {
          ...currentState,
          inferenceModel: model,
          temperature: temp,
          apiTarget: api,
          maxTokenChoice: mtc,
        } as any);
      } catch (error) {
        console.error('Failed to save inference state:', error);
      }
    },
    [rootFolder]
  );

  const scheduleSave = (
    model: string,
    temp: number,
    api: ApiTarget,
    mtc: MaxTokenChoice
  ) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => saveState(model, temp, api, mtc), 500);
  };

  const activeModels = apiTarget === 'Venice' ? veniceModels : openRouterModels;

  const handleApiChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newApi = e.target.value as ApiTarget;
    const pool = newApi === 'Venice' ? veniceModels : openRouterModels;
    const newModel = pool.includes(selectedModel) ? selectedModel : pool[0] || '';
    setApiTarget(newApi);
    setSelectedModel(newModel);
    scheduleSave(newModel, temperature, newApi, maxTokenChoice);
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    scheduleSave(newModel, temperature, apiTarget, maxTokenChoice);
  };

  const handleTemperatureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (isNaN(val) || val < 0 || val > 2) return;
    setTemperature(val);
    scheduleSave(selectedModel, val, apiTarget, maxTokenChoice);
  };

  const handleMaxTokenChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as MaxTokenChoice;
    setMaxTokenChoice(val);
    scheduleSave(selectedModel, temperature, apiTarget, val);
  };

  const handleStart = () => {
    if (selectedModel && !disabled) {
      onStartInference(selectedModel, temperature, apiTarget, MAX_TOKEN_VALUES[maxTokenChoice]);
    }
  };

  const isDisabled = disabled || !rootFolder || isLoadingModels || activeModels.length === 0;

  // Two-row layout: row 1 = API + Model + Max Token (+ Start button),
  // row 2 = Temp (moved down per UX request).
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  };
  const groupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    color: '#aaa',
    fontWeight: 500,
  };

  return (
    <div className="inference-controls">
      <div style={rowStyle}>
        <div style={groupStyle}>
          <label htmlFor="inference-api" style={labelStyle}>API</label>
          <select
            id="inference-api"
            value={apiTarget}
            onChange={handleApiChange}
            disabled={disabled || !rootFolder || isLoadingModels}
            className="inference-select"
            style={{ minWidth: 90 }}
          >
            <option value="OpenRouter">OpenRouter</option>
            <option value="Venice">Venice</option>
          </select>
        </div>

        <div style={groupStyle}>
          <label htmlFor="inference-model" style={labelStyle}>Model</label>
          <select
            id="inference-model"
            value={selectedModel}
            onChange={handleModelChange}
            disabled={isDisabled}
            className="inference-select"
            style={{ minWidth: 140 }}
          >
            {activeModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div style={groupStyle}>
          <label htmlFor="inference-max-tokens" style={labelStyle}>Max Token</label>
          <select
            id="inference-max-tokens"
            value={maxTokenChoice}
            onChange={handleMaxTokenChange}
            disabled={isDisabled}
            className="inference-select"
            style={{ minWidth: 70 }}
          >
            <option value="32K">32K</option>
            <option value="64K">64K</option>
          </select>
        </div>
        <label htmlFor="inference-temperature" style={labelStyle}>Temp</label>
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

        {showStartButton && (
          <button
            className="inference-start-button"
            onClick={handleStart}
            disabled={isDisabled || !selectedModel}
            title="Start inference with the selected API, model, temperature, and max token limit"
          >
            {startButtonLabel}
          </button>
        )}
      </div>

      {isLoadingModels && <div className="inference-loading">Loading models…</div>}
      {!isLoadingModels && activeModels.length === 0 && (
        <div className="inference-warning">
          No {apiTarget} models configured in Settings.
        </div>
      )}
    </div>
  );
};

export default InferenceControls;
