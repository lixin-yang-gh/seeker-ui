import React, { useState, useEffect, useCallback, useMemo } from 'react';

interface InferenceControlsProps {
  /** Root folder path used to persist per-folder inference settings */
  rootFolder: string | null;
  /** Called when the user clicks the start button */
  onStartInference: (
    model: string,
    temperature: number,
    apiTarget: 'OpenRouter' | 'Venice',
    maxTokens: number
  ) => void;
  /** Disable all controls (e.g. while an inference is already running) */
  disabled?: boolean;
  /** Whether to render the start button (some hosts render their own) */
  showStartButton?: boolean;
  /** Custom label for the start button */
  startButtonLabel?: string;
}

const MAX_TOKEN_CHOICES = ['4096', '8192', '16384', '32768', '65536'] as const;
type MaxTokenChoice = typeof MAX_TOKEN_CHOICES[number];

const DEFAULT_MODEL_FALLBACK = '';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_API_TARGET: 'OpenRouter' | 'Venice' = 'OpenRouter';
const DEFAULT_MAX_TOKEN_CHOICE: MaxTokenChoice = '32768';

/**
 * Parse a comma-separated string of quoted model names, e.g.
 *   "model-a", "model-b", "model-c"
 * into an array of trimmed model ids.
 */
function parseModelList(raw: string): string[] {
  if (!raw) return [];
  const models: string[] = [];
  const regex = /"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(raw)) !== null) {
    const v = m[1].trim();
    if (v) models.push(v);
  }
  return models;
}

const InferenceControls: React.FC<InferenceControlsProps> = ({
  rootFolder,
  onStartInference,
  disabled = false,
  showStartButton = true,
  startButtonLabel = 'Start Inference',
}) => {
  const [apiTarget, setApiTarget] = useState<'OpenRouter' | 'Venice'>(DEFAULT_API_TARGET);
  const [openRouterModels, setOpenRouterModels] = useState<string[]>([]);
  const [veniceModels, setVeniceModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>(DEFAULT_MODEL_FALLBACK);
  const [temperature, setTemperature] = useState<number>(DEFAULT_TEMPERATURE);
  const [maxTokenChoice, setMaxTokenChoice] = useState<MaxTokenChoice>(DEFAULT_MAX_TOKEN_CHOICE);
  const [loaded, setLoaded] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  // Load API settings (global) and per-folder inference settings.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const apiSettings = await window.electronAPI.getApiSettings();
        const orModels = parseModelList(apiSettings?.inferenceModels || '');
        const veModels = parseModelList(apiSettings?.veniceInferenceModels || '');
        if (cancelled) return;
        setOpenRouterModels(orModels);
        setVeniceModels(veModels);

        let savedApiTarget: 'OpenRouter' | 'Venice' = DEFAULT_API_TARGET;
        let savedModel = '';
        let savedTemp = DEFAULT_TEMPERATURE;
        let savedMaxTok: MaxTokenChoice = DEFAULT_MAX_TOKEN_CHOICE;

        if (rootFolder) {
          const folderState = await window.electronAPI.getFolderState(rootFolder);
          if (folderState) {
            if (folderState.apiTarget === 'Venice' || folderState.apiTarget === 'OpenRouter') {
              savedApiTarget = folderState.apiTarget;
            }
            if (folderState.inferenceModel) savedModel = folderState.inferenceModel;
            if (typeof folderState.temperature === 'number') savedTemp = folderState.temperature;
            if (
              folderState.maxTokenChoice &&
              (MAX_TOKEN_CHOICES as readonly string[]).includes(folderState.maxTokenChoice)
            ) {
              savedMaxTok = folderState.maxTokenChoice as MaxTokenChoice;
            }
          }
        }

        // Pick a sensible model default if the saved one is missing.
        const listForTarget = savedApiTarget === 'Venice' ? veModels : orModels;
        if (!savedModel || !listForTarget.includes(savedModel)) {
          savedModel = listForTarget[0] || '';
        }

        if (cancelled) return;
        setApiTarget(savedApiTarget);
        setModel(savedModel);
        setTemperature(savedTemp);
        setMaxTokenChoice(savedMaxTok);
      } catch (err) {
        console.error('InferenceControls: failed to load settings', err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [rootFolder]);

  const currentModelList = useMemo(
    () => (apiTarget === 'Venice' ? veniceModels : openRouterModels),
    [apiTarget, openRouterModels, veniceModels]
  );

  // If the API target changes and the current model is not in the new list,
  // fall back to the first available model for that target.
  useEffect(() => {
    if (!loaded) return;
    if (currentModelList.length === 0) {
      if (model !== '') setModel('');
      return;
    }
    if (!currentModelList.includes(model)) {
      setModel(currentModelList[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiTarget, currentModelList, loaded]);

  // Persist per-folder inference settings (debounced) whenever they change.
  useEffect(() => {
    if (!loaded || !rootFolder) return;
    const t = setTimeout(async () => {
      try {
        const currentState = (await window.electronAPI.getFolderState(rootFolder)) || {};
        await window.electronAPI.saveFolderState(rootFolder, {
          ...currentState,
          apiTarget,
          inferenceModel: model,
          temperature,
          maxTokenChoice,
        });
        setLastSaved(Date.now());
      } catch (err) {
        console.error('InferenceControls: failed to persist settings', err);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [apiTarget, model, temperature, maxTokenChoice, rootFolder, loaded]);

  const handleStart = useCallback(() => {
    if (!model) return;
    const maxTokens = parseInt(maxTokenChoice, 10);
    onStartInference(model, temperature, apiTarget, maxTokens);
  }, [model, temperature, apiTarget, maxTokenChoice, onStartInference]);

  const controlsDisabled = disabled || !loaded;

  return (
    <div className="inference-controls">
      <div className="inference-controls-row">
        <div className="inference-controls-column">
          <div className="inference-control-group">
            <label htmlFor="inference-api-target">API</label>
            <select
              id="inference-api-target"
              className="inference-select"
              value={apiTarget}
              onChange={(e) => setApiTarget(e.target.value as 'OpenRouter' | 'Venice')}
              disabled={controlsDisabled}
              title="Choose the inference API provider"
            >
              <option value="OpenRouter">OpenRouter</option>
              <option value="Venice">Venice</option>
            </select>
          </div>

          <div className="inference-control-group">
            <label htmlFor="inference-model">Model</label>
            <select
              id="inference-model"
              className="inference-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={controlsDisabled || currentModelList.length === 0}
              title="Select the inference model"
            >
              {currentModelList.length === 0 ? (
                <option value="">(no models configured)</option>
              ) : (
                currentModelList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="inference-control-group">
            {lastSaved && (
              <div
                style={{ fontSize: '10px', color: '#4ec9b0', margin: '3px 8px 0 0' }}
                title="Inference settings were persisted for this folder"
              >
                Settings saved {new Date(lastSaved).toLocaleTimeString()}
              </div>
            )}

          </div>

        </div>

        <div className="inference-controls-column">
          <div className="inference-control-group">
            <label htmlFor="inference-temperature">Temp</label>
            <input
              id="inference-temperature"
              type="number"
              className="inference-temp-input"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setTemperature(Number.isFinite(v) ? v : DEFAULT_TEMPERATURE);
              }}
              disabled={controlsDisabled}
              title="Sampling temperature (0.0 – 2.0)"
            />
          </div>

          <div className="inference-control-group">
            <label htmlFor="inference-max-tokens">Max Tokens</label>
            <select
              id="inference-max-tokens"
              className="inference-select"
              value={maxTokenChoice}
              onChange={(e) => setMaxTokenChoice(e.target.value as MaxTokenChoice)}
              disabled={controlsDisabled}
              title="Maximum completion tokens"
            >
              {MAX_TOKEN_CHOICES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="inference-controls-column">
          <div className="inference-control-group">
            {showStartButton && (
              <button
                className={`inference-start-button${startButtonLabel === 'Run Inference Again' ? ' inference-start-button--rerun' : ''}`}
                onClick={handleStart}
                disabled={controlsDisabled || !model}
                title={
                  !model
                    ? 'Configure at least one model in Settings first'
                    : 'Start inference with the selected configuration'
                }
              >
                {startButtonLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InferenceControls;
