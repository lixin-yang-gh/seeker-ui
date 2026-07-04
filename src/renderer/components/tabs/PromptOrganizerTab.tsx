import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getErrorMessage,
  getRelativePath,
  sanitizeText,
  parseMaskedSubstrings,
  applyCustomMasking
} from '../../../shared/utils';

import InferenceControls from '../shared/InferenceControls';

interface PromptOrganizerTabProps {
  selectedFilePaths: string[];
  rootFolder?: string | null;
  onBackToOverview: () => void;
  onSwitchToInference?: () => void;
  onInferenceStatusChange?: (
    status: 'idle' | 'running' | 'success' | 'error',
    result?: string,
    reasoning?: string,
    error?: string,
  ) => void;
}

// Define prepend and append button configurations for scalability
const PREPEND_BUTTONS: Array<{ key: string; value: string }> = [
  { key: 'Feasibility', value: 'Please explore feasibility ' },
  { key: 'Analysis', value: 'Please provide analysis ' },
  { key: 'Review', value: 'Please review ' },
  { key: 'Solution', value: 'Please propose the best solution.' },
  { key: 'Enhancements', value: 'Please propose enhancement.' },
  { key: 'Improvements', value: 'Please propose improvement.' },
  { key: 'Words', value: 'Please propose word changes.' },
  { key: 'Codes', value: 'Please propose code changes.' },
  { key: 'Fixes', value: 'Please propose fixes.' },
  { key: 'Report', value: 'Please create a report.' },
];

const block_replacement_prompt = `
---
For each file that requires changes, return a JSON array of change objects wrapped in a fenced code block with language tag "json". Do not include any explanatory text or markdown outside the fence.

\`\`\`json
[ ... ]
\`\`\`

Each object must contain exactly these fields:

- "path": string — file path relative to project root, prefixed with "<project_root>/"
- "op": string — one of "add", "replace", or "delete"
- "is_full_file": boolean — true if the operation applies to the entire file; false if it applies to a specific block
  * "add" + true: create a new file with content in "replacement"
  * "add" + false: insert "replacement" after the anchor block in "original"
  * "replace" + true: overwrite the entire file with "replacement"
  * "replace" + false: replace the exact block in "original" with "replacement"
  * "delete" + true: delete the entire file
  * "delete" + false: remove the exact block in "original"
- "original": string or null — the verbatim, exact text from the target file
  * For partial "replace" or "delete": copy the complete contiguous block character-for-character from the file, including all whitespace and indentation. Include enough surrounding lines so the block is globally unique within the file.
  * For partial "add": the exact anchor block after which new content will be inserted.
  * When is_full_file is true: set to null.
- "replacement": string or null — the new content to insert or replace. Set to null for "delete".

JSON STRING ESCAPING RULES:
- Use \\n for newlines, \\t for tabs inside all string values.
- Do not embed unescaped literal newlines inside JSON string values.
- Do not wrap "replacement" content in internal markdown code fences.
- Output must be immediately parseable by a standard JSON parser.

Guidelines:
- Keep replacements minimal — change only what is necessary; avoid rewriting surrounding unchanged lines.
- For partial operations, "original" must match the file content character-for-character.
- Prefer fewer, larger contiguous blocks over many small fragmented ones.
- All content must be directly copy-pasteable.

Example:
\`\`\`json
[
  {
    "path": "<project_root>/src/example.ts",
    "op": "replace",
    "is_full_file": false,
    "original": "function foo() {\\n  return 1;\\n}",
    "replacement": "function foo() {\\n  return 2;\\n}"
  },
  {
    "path": "<project_root>/src/other.ts",
    "op": "replace",
    "is_full_file": true,
    "original": null,
    "replacement": "<full new file content>"
  }
]
\`\`\`
`;

const block_replacement_prompt_conditional = block_replacement_prompt.replace(
  '\nFor each file that requires changes',
  '\nIf changes are required, for each file that requires changes'
);

const full_file_prompt = `
---
Return a JSON array of change objects wrapped in a fenced code block with language tag "json". Do not include any explanatory text or markdown outside the fence.

\`\`\`json
[ ... ]
\`\`\`

Each object must contain exactly these fields:

- "path": string — file path relative to project root, prefixed with "<project_root>/"
- "op": string — one of "add", "replace", or "delete"
- "is_full_file": true
- "original": null
- "replacement": string or null — the complete new file content using \\n for newlines, \\t for tabs. Set to null for "delete".
- "reason": string — a brief description of the change

JSON STRING ESCAPING RULES:
- Use \\n for newlines, \\t for tabs inside all string values.
- Do not embed unescaped literal newlines inside JSON string values.
- Output must be immediately parseable by a standard JSON parser.

Example:
\`\`\`json
[
  {
    "path": "<project_root>/src/example.ts",
    "op": "replace",
    "is_full_file": true,
    "original": null,
    "replacement": "// full new file content\\nexport function foo() {\\n  return 2;\\n}",
    "reason": "Updated foo to return 2"
  }
]
\`\`\`
`;

const full_file_prompt_conditional = full_file_prompt.replace(
  '\nReturn a JSON array',
  '\nIf changes are required, return a JSON array'
);

const APPEND_BUTTONS: Array<{ key: string; value: string }> = [
  {
    key: 'Current File', value: full_file_prompt.replace(
      '\nReturn a JSON array of change objects',
      '\nReturn a JSON array with one object for the updated file'
    )
  },
  { key: 'Files', value: full_file_prompt },
  { key: 'Files - conditional', value: full_file_prompt_conditional },
  { key: 'Update blocks', value: block_replacement_prompt },
  { key: 'Update blocks - conditional', value: block_replacement_prompt_conditional },
  { key: 'Minimal changes', value: '\n---\nPlease try to keep the proposed text/code changes minimal; modify only the essential lines; avoid any unnecessary refactoring or rewriting of surrounding text or code.' }
];

const HEADER_OPTIONS: Array<{ display: string; value: string }> = [
  { display: 'Issues', value: 'issues' },
  { display: 'Errors', value: 'errors' },
  { display: 'Output', value: 'output' },
  { display: 'Logs', value: 'logs' },
  { display: 'Feedback', value: 'feedback' },
  { display: 'Proposals', value: 'proposals' },
  { display: 'Third Party Proposals', value: 'third_party_proposals' },
  { display: 'Analysis', value: 'analysis' },
  { display: 'Context', value: 'context' },
  { display: 'Info', value: 'info' },
];

const PromptOrganizerTab: React.FC<PromptOrganizerTabProps> = ({
  selectedFilePaths,
  rootFolder,
  onBackToOverview,
  onSwitchToInference,
  onInferenceStatusChange,
}) => {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [task, setTask] = useState('');
  const [issues, setIssues] = useState('');
  const [selectedHeader, setSelectedHeader] = useState('issues');
  const [referencedFilesContent, setReferencedFilesContent] = useState<string>('');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [lastSavedSystemPrompt, setLastSavedSystemPrompt] = useState<number | null>(null);
  const [lastSavedTask, setLastSavedTask] = useState<number | null>(null);
  const [lastSavedIssues, setLastSavedIssues] = useState<number | null>(null);
  const [lastSavedHeader, setLastSavedHeader] = useState<number | null>(null);
  const [maskedSubstrings, setMaskedSubstrings] = useState('');
  const [lastSavedMaskedSubstrings, setLastSavedMaskedSubstrings] = useState<number | null>(null);
  const [standaloneCopyStatus, setStandaloneCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [lastSavedDefaultSystemPrompt, setLastSavedDefaultSystemPrompt] = useState<number | null>(null);

  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const [confirmTimer, setConfirmTimer] = useState<NodeJS.Timeout | null>(null);
  const [redactionApplied, setRedactionApplied] = useState(false);

  const [inferenceStatus2, setInferenceStatus2] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [inferenceResult, setInferenceResult] = useState('');
  const [inferenceReasoning, setInferenceReasoning] = useState('');
  const [inferenceError, setInferenceError] = useState('');

  // Load saved data when rootFolder changes
  useEffect(() => {
    const handleFolderChange = async () => {
      if (!rootFolder) return;

      try {
        // Check if state exists for this specific folder
        const savedState = await window.electronAPI.getFolderState(rootFolder);

        if (savedState) {
          // State exists: Load it into the UI
          setSystemPrompt(savedState.systemPrompt || '');
          setTask(savedState.task || '');
          setIssues(savedState.issues || '');
          setSelectedHeader(savedState.selectedHeader || 'issues');
          setMaskedSubstrings(savedState.maskedSubstrings || '');
        } else {
          // State does NOT exist: Inherit current values (Inheritance Logic)
          // The current state variables hold values from the previous folder context.
          // We save these current values to the new folder's key.

          const currentStateToInherit = {
            systemPrompt,
            task,
            issues,
            selectedHeader,
            maskedSubstrings
          };

          // Save to the new folder path
          await window.electronAPI.saveFolderState(rootFolder, currentStateToInherit);

          // UI remains unchanged (values are inherited). 
          // Optional: Indicate save time
          const now = Date.now();
          setLastSavedSystemPrompt(now);
          setLastSavedTask(now);
          setLastSavedIssues(now);
          setLastSavedHeader(now);
          setLastSavedMaskedSubstrings(now);
        }

        // Reset timestamps for 'last saved' displays if we loaded old data
        // (Only relevant if we want to show "Loaded" vs "Saved")
        // Here we reset them to null to avoid confusion, or leave as is.
        // For inheritance, we set the timestamps above.

      } catch (err) {
        console.error('Failed to handle folder change:', err);
      }
    };

    handleFolderChange();
    // Note: We intentionally only depend on rootFolder. 
    // We want to capture the *current* state (from previous render) when folder changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFolder]);

  // Load default system prompt on mount
  useEffect(() => {
    const loadDefaultPrompt = async () => {
      try {
        const defaultPrompt = await window.electronAPI.getDefaultSystemPrompt();
        setDefaultSystemPrompt(defaultPrompt || '');
      } catch (err) {
        console.error('Failed to load default system prompt:', err);
      }
    };

    loadDefaultPrompt();
  }, []);

  const saveMaskedSubstrings = useCallback(async (value: string) => {
    if (!rootFolder) return;
    try {
      await window.electronAPI.saveMaskedSubstrings(rootFolder, value);
      setLastSavedMaskedSubstrings(Date.now());
    } catch (err) {
      console.error('Failed to save masked substrings:', err);
    }
  }, [rootFolder]);

  const saveSystemPrompt = useCallback(async (value: string) => {
    if (!rootFolder) return;
    try {
      await window.electronAPI.saveSystemPrompt(rootFolder, value);
      setLastSavedSystemPrompt(Date.now());
    } catch (err) {
      console.error('Failed to save system prompt:', err);
    }
  }, [rootFolder]);

  // Compute if current prompt is different from default
  const isDifferentFromDefault = useMemo(() => {
    return systemPrompt !== defaultSystemPrompt;
  }, [systemPrompt, defaultSystemPrompt]);

  // Load Default button handler
  const handleLoadDefaultPrompt = useCallback(() => {
    if (defaultSystemPrompt) {
      setSystemPrompt(defaultSystemPrompt);
      // Optionally trigger auto-save after load
      setTimeout(() => saveSystemPrompt(defaultSystemPrompt), 100);
    }
  }, [defaultSystemPrompt, saveSystemPrompt]);

  // Save as Global button handler - shows confirm button
  const handleSaveAsDefaultPrompt = useCallback(() => {
    if (!systemPrompt.trim() || !isDifferentFromDefault) return;

    // Hide the regular Save as Default button, show confirm button
    setShowConfirmSave(true);

    // Set a 10-second timer to revert back
    const timer = setTimeout(() => {
      setShowConfirmSave(false);
    }, 5000);

    setConfirmTimer(timer);
  }, [systemPrompt, isDifferentFromDefault]);

  // Confirm Save as Global button handler
  const handleConfirmSaveAsDefault = useCallback(async () => {
    if (!systemPrompt.trim()) return;

    // Clear the timer
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      setConfirmTimer(null);
    }

    try {
      await window.electronAPI.saveDefaultSystemPrompt(systemPrompt);
      setDefaultSystemPrompt(systemPrompt);
      setLastSavedDefaultSystemPrompt(Date.now());
      setShowConfirmSave(false); // Hide confirm button after successful save
    } catch (err) {
      console.error('Failed to save default system prompt:', err);
    }
  }, [systemPrompt, confirmTimer]);

  const maskedSubstringsInitRef = React.useRef(true);
  useEffect(() => {
    if (!rootFolder) return;
    if (maskedSubstringsInitRef.current) { maskedSubstringsInitRef.current = false; return; }
    const timer = setTimeout(() => {
      saveMaskedSubstrings(maskedSubstrings);
    }, 800);
    return () => clearTimeout(timer);
  }, [maskedSubstrings, saveMaskedSubstrings, rootFolder]);

  const saveTask = useCallback(async (value: string) => {
    if (!rootFolder) return;
    try {
      await window.electronAPI.saveTask(rootFolder, value);
      setLastSavedTask(Date.now());
    } catch (err) {
      console.error('Failed to save task:', err);
    }
  }, [rootFolder]);

  const saveIssues = useCallback(async (value: string) => {
    if (!rootFolder) return;
    try {
      await window.electronAPI.saveIssues(rootFolder, value);
      setLastSavedIssues(Date.now());
    } catch (err) {
      console.error('Failed to save issues:', err);
    }
  }, [rootFolder]);

  const saveHeader = useCallback(async (value: string) => {
    if (!rootFolder) return;
    try {
      await window.electronAPI.saveSelectedHeader(rootFolder, value);
      setLastSavedHeader(Date.now());
    } catch (err) {
      console.error('Failed to save header selection:', err);
    }
  }, [rootFolder]);

  const systemPromptInitRef = React.useRef(true);
  useEffect(() => {
    if (!rootFolder) return;
    if (systemPromptInitRef.current) { systemPromptInitRef.current = false; return; }
    const timer = setTimeout(() => {
      saveSystemPrompt(systemPrompt);
    }, 800);
    return () => clearTimeout(timer);
  }, [systemPrompt, saveSystemPrompt, rootFolder]);

  const taskInitRef = React.useRef(true);
  useEffect(() => {
    if (!rootFolder) return;
    if (taskInitRef.current) { taskInitRef.current = false; return; }
    const timer = setTimeout(() => {
      saveTask(task);
    }, 800);
    return () => clearTimeout(timer);
  }, [task, saveTask, rootFolder]);

  const issuesInitRef = React.useRef(true);
  useEffect(() => {
    if (!rootFolder) return;
    if (issuesInitRef.current) { issuesInitRef.current = false; return; }
    const timer = setTimeout(() => {
      saveIssues(issues);
    }, 800);
    return () => clearTimeout(timer);
  }, [issues, saveIssues, rootFolder]);

  // Auto-save header selection (debounced)
  useEffect(() => {
    if (!selectedHeader || !rootFolder) return;
    const timer = setTimeout(() => {
      saveHeader(selectedHeader);
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedHeader, saveHeader, rootFolder]);

  // Load / reload referenced files content
  const loadFileContents = useCallback(async () => {
    if (selectedFilePaths.length === 0) {
      setReferencedFilesContent('');
      return;
    }

    setIsLoadingFiles(true);
    try {
      const filePromises = selectedFilePaths.map(async (filePath) => {
        try {
          const fileData = await window.electronAPI.readFile(filePath);
          const relPath = getRelativePath(filePath, rootFolder).replace(/\\/g, '/');
          const relativePath = "<project_root>/" + relPath;

          // Apply sanitization to file content - this will decode HTML entities
          const sanitizedContent = sanitizeText(fileData.content);

          return `<file path="${relativePath}">\n${sanitizedContent}\n</file>`;
        } catch (error) {
          const relativePath = getRelativePath(filePath, rootFolder);
          return `<file path="${relativePath}">\nError loading file: ${getErrorMessage(error)}\n</file>`;
        }
      });

      const fileContents = await Promise.all(filePromises);

      // Combine all file contents
      const combinedContent = fileContents.join('\n\n');

      setReferencedFilesContent(combinedContent);
    } catch (error) {
      console.error('Error loading files:', error);
      setReferencedFilesContent(`Error loading files: ${getErrorMessage(error)}`);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [selectedFilePaths, rootFolder]);

  useEffect(() => {
    loadFileContents();
  }, [loadFileContents]);

  // Handle New Task button - clear Task textarea
  const handleNewTask = () => {
    setTask('');
    saveTask(''); // Save empty string
  };

  // Handle Clear Issues button - clear Issues textarea
  const handleClearIssues = () => {
    setIssues('');
    saveIssues(''); // Save empty string
  };

  // Handle Get Standalone Prompt from Task button
  const handleGetStandalonePrompt = async () => {
    const taskText = task.trim();
    if (!taskText) return;

    setStandaloneCopyStatus('idle');

    try {
      const substrings = parseMaskedSubstrings(maskedSubstrings);
      const maskedTask = applyCustomMasking(taskText, substrings);
      await navigator.clipboard.writeText(maskedTask);
      setStandaloneCopyStatus('success');
      setTimeout(() => setStandaloneCopyStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to copy standalone prompt:', err);
      setStandaloneCopyStatus('error');
      setTimeout(() => setStandaloneCopyStatus('idle'), 2000);
    }
  };

  // Handle prepend button click
  const handlePrepend = (textToPrepend: string) => {
    setTask(prevTask => {
      // If task is empty, just set the prepended text
      if (!prevTask.trim()) {
        return textToPrepend;
      }
      // Otherwise, add the prepended text as a new line at the beginning
      return `${textToPrepend}\n${prevTask}`;
    });
  };

  // Handle append button click
  const handleAppend = (textToAppend: string) => {
    setTask(prevTask => {
      // If task is empty, just set the appended text
      if (!prevTask.trim()) {
        return textToAppend;
      }
      // Otherwise, add the appended text as a new line at the end
      return `${prevTask}\n${textToAppend}`;
    });
  };

  const handleCopyPrompt = async () => {
    if (!systemPrompt.trim() || !task.trim()) return;

    setGenerationStatus('generating');
    try {
      // Reload files
      await loadFileContents();
      // Generate prompt with or without redaction based on checkbox
      await handleGeneratePrompt(redactionApplied);
    } catch (error) {
      console.error('Failed to copy prompt:', error);
      setGenerationStatus('error');
    }
  };

  const handleGeneratePrompt = async (applyRedaction: boolean = true) => {
    if (!systemPrompt.trim() || !task.trim()) return;

    setGenerationStatus('generating');

    try {
      // Sanitize all text inputs first
      const sanitizedSystemPrompt = sanitizeText(systemPrompt.trim());
      const sanitizedTask = sanitizeText(task.trim());
      const sanitizedIssues = issues.trim() ? sanitizeText(issues.trim()) : '';
      // referencedFilesContent is already built from files; we treat it as is (no extra sanitization needed here)
      const filesContent = referencedFilesContent;

      const customSubstrings = parseMaskedSubstrings(maskedSubstrings);

      // Apply custom substring masking unconditionally to all fields
      const processedSystemPrompt = applyCustomMasking(sanitizedSystemPrompt, customSubstrings);
      const processedTask = applyCustomMasking(sanitizedTask, customSubstrings);
      const processedIssues = applyCustomMasking(sanitizedIssues, customSubstrings);
      const processedFiles = applyCustomMasking(filesContent, customSubstrings);

      // Build the prompt parts
      const promptParts = [];
      const missingFilesNomination = '---\n**Please nominate missing or unselected but still anticipated files if there are any**\n';

      promptParts.push(`<system_prompt content="System Prompt">\n${processedSystemPrompt}\n</system_prompt>`);
      promptParts.push(`<task content="Task">\n${processedTask}\n${missingFilesNomination}</task>`);

      if (processedIssues) {
        const displayHeader = HEADER_OPTIONS.find(h => h.value === selectedHeader)?.display || 'Issues';
        const xmlTag = selectedHeader || 'issues';
        promptParts.push(`<${xmlTag} content="${displayHeader}">\n${processedIssues}\n</${xmlTag}>`);
      }

      if (processedFiles.trim()) {
        promptParts.push(`<referenced_files content="Referenced Files">\n${processedFiles}\n</referenced_files>`);
      }

      const systemPromptPart = promptParts[0];
      const userPromptContent = promptParts.slice(1).join('\n\n---\n\n');
      let fullPrompt = `${systemPromptPart}\n<user_prompt content="User Prompt">\n${userPromptContent}\n</user_prompt>`;

      // Apply redaction if requested
      if (applyRedaction) {
        try {
          fullPrompt = await window.electronAPI.redactText(fullPrompt);
        } catch (redactError) {
          console.error('Redaction failed, using unredacted prompt:', redactError);
          // Continue with unredacted prompt if redaction fails
        }
      }

      await navigator.clipboard.writeText(fullPrompt);
      setGenerationStatus('success');

      setTimeout(() => setGenerationStatus('idle'), 3000);
    } catch (error) {
      console.error('Failed to generate prompt:', error);
      setGenerationStatus('error');
    }
  };

  const canGeneratePrompt = systemPrompt.trim() && task.trim();

  const handleStartInference = useCallback(async (model: string, temperature: number) => {
    if (!canGeneratePrompt) return;

    setInferenceStatus2('running');
    setInferenceResult('');
    setInferenceReasoning('');
    setInferenceError('');
    onInferenceStatusChange?.('running');
    onSwitchToInference?.();

    try {
      await loadFileContents();

      const sanitizedSystemPrompt = sanitizeText(systemPrompt.trim());
      const sanitizedTask = sanitizeText(task.trim());
      const sanitizedIssues = issues.trim() ? sanitizeText(issues.trim()) : '';
      const filesContent = referencedFilesContent;
      const customSubstrings = parseMaskedSubstrings(maskedSubstrings);

      const processedSystemPrompt = applyCustomMasking(sanitizedSystemPrompt, customSubstrings);
      const processedTask = applyCustomMasking(sanitizedTask, customSubstrings);
      const processedIssues = applyCustomMasking(sanitizedIssues, customSubstrings);
      const processedFiles = applyCustomMasking(filesContent, customSubstrings);

      const userParts: string[] = [];
      userParts.push(`<task>${processedTask}</task>`);
      if (processedIssues) {
        const xmlTag = selectedHeader || 'issues';
        userParts.push(`<${xmlTag}>${processedIssues}</${xmlTag}>`);
      }
      if (processedFiles.trim()) {
        userParts.push(`<referenced_files>${processedFiles}</referenced_files>`);
      }

      let sysPrompt = processedSystemPrompt;
      let userPrompt = userParts.join('\n\n');

      if (redactionApplied) {
        try {
          sysPrompt = await window.electronAPI.redactText(sysPrompt);
          userPrompt = await window.electronAPI.redactText(userPrompt);
        } catch (e) {
          console.error('Redaction failed, using unredacted prompt:', e);
        }
      }

      const result = await window.electronAPI.callOpenRouter(
        sysPrompt,
        userPrompt,
        model,
        { temperature }
      );

      setInferenceResult(result.content || result.text || '');
      if (result.reasoning) setInferenceReasoning(result.reasoning);
      setInferenceStatus2('success');
      onInferenceStatusChange?.('success', result.content || result.text || '', result.reasoning, undefined);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      setInferenceError(errMsg);
      setInferenceStatus2('error');
      onInferenceStatusChange?.('error', undefined, undefined, errMsg);
    }
  }, [canGeneratePrompt, systemPrompt, task, issues, selectedHeader, maskedSubstrings, referencedFilesContent, redactionApplied, loadFileContents]);

  return (
    <div className="tab-panel prompt-organizer">
      <div className="generate-prompt-section">
        <div className="generate-prompt-header">
          <div className="masked-substrings-container">
            <label
              htmlFor="masked-substrings"
              style={{
                display: 'block',
                marginBottom: '5px',
                color: '#888',
                fontSize: '13px',
                fontWeight: '500'
              }}
            >
              Masked Substrings (each must be double quote enclosed)
            </label>
            <input
              id="masked-substrings"
              type="text"
              className="masked-substrings-input"
              placeholder='"substring1", "substring2", "substring3"'
              title="Custom substrings masked and presented as [SENSITIVE] in the redacted prompt"
              value={maskedSubstrings}
              onChange={(e) => setMaskedSubstrings(e.target.value)}
              disabled={!rootFolder}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="char-counter" style={{ fontSize: '11px', color: '#888' }}>
                {maskedSubstrings.length} characters
              </div>
              {lastSavedMaskedSubstrings && (
                <div style={{ fontSize: '11px', color: '#4ec9b0' }}>
                  Saved {new Date(lastSavedMaskedSubstrings).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ccc', fontSize: '13px' }}>
              Redaction<br />Applied<br />
              <input
                type="checkbox"
                checked={redactionApplied}
                onChange={(e) => setRedactionApplied(e.target.checked)}
              />
            </label>
            <button
              className={`generate-prompt-button ${!canGeneratePrompt ? 'disabled' : ''} ${generationStatus === 'success' ? 'success' : ''
                }`}
              onClick={handleCopyPrompt}
              disabled={!canGeneratePrompt || generationStatus === 'generating'}
            >
              {generationStatus === 'success' ? '✓ Copied!' : 'Copy Prompt'}
            </button>
            <InferenceControls
              rootFolder={rootFolder ?? null}
              onStartInference={handleStartInference}
              disabled={!canGeneratePrompt || inferenceStatus2 === 'running'}
              showStartButton={canGeneratePrompt}
            />
          </div>
        </div>

        {generationStatus === 'error' && (
          <div className="alert-message alert-error">Failed to copy prompt</div>
        )}
        {inferenceStatus2 === 'running' && (
          <div className="inference-loading" style={{ padding: '8px 0' }}>Running inference…</div>
        )}
        {inferenceStatus2 === 'error' && (
          <div className="inference-result-area"><span className="error">{inferenceError}</span></div>
        )}
        {inferenceStatus2 === 'success' && (
          <div style={{ marginTop: '8px' }}>
            {inferenceReasoning && (
              <div style={{ marginBottom: '6px' }}>
                <label style={{ fontSize: '11px', color: '#888' }}>Reasoning</label>
                <div className="inference-result-area" style={{ maxHeight: '120px', color: '#aaa' }}>{inferenceReasoning}</div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '11px', color: '#888' }}>Inference Result</label>
              <button className="toolbar-button" onClick={() => navigator.clipboard.writeText(inferenceResult)} style={{ padding: '2px 8px', fontSize: '11px' }}>Copy</button>
            </div>
            <div className="inference-result-area" style={{ maxHeight: '250px' }}>{inferenceResult}</div>
          </div>
        )}
      </div>


      <div className="prompt-organizer-tab">
        <div className="prompt-input-section">
          <div className="section-header">Configuration</div>

          <div className="prompt-input-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="system-prompt">
                System Prompt <span className="required-marker">*</span>
              </label>

              <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
                {/* Load Global button */}
                <button
                  className="toolbar-button"
                  onClick={handleLoadDefaultPrompt}
                  disabled={!defaultSystemPrompt || !rootFolder || systemPrompt === defaultSystemPrompt}
                  title={
                    !defaultSystemPrompt
                      ? "No default prompt saved"
                      : systemPrompt === defaultSystemPrompt
                        ? "Current prompt is already the default"
                        : "Load global system prompt"
                  }
                >
                  Load Global
                </button>

                {/* Regular Save as Global button - hidden when confirm is shown */}
                <button
                  className={`toolbar-button ${isDifferentFromDefault && !(!isDifferentFromDefault || !rootFolder) ? 'special' : ''}`}
                  onClick={handleSaveAsDefaultPrompt}
                  disabled={!isDifferentFromDefault || !rootFolder}
                  title="Save current prompt as global"
                  style={{ display: showConfirmSave ? 'none' : 'inline-flex' }}
                >
                  Save as Global
                </button>

                {/* Confirm Save as Global button - shown for 5 seconds after clicking Save as Global */}
                <button
                  className="toolbar-button confirm"
                  onClick={handleConfirmSaveAsDefault}
                  disabled={!isDifferentFromDefault || !rootFolder}
                  title="Click to confirm saving as global (expires in 5 seconds)"
                  style={{ display: showConfirmSave ? 'inline-flex' : 'none' }}
                >
                  ⚠️ Confirm Save as Global
                </button>
              </div>

            </div>
            <textarea
              id="system-prompt"
              className="prompt-textarea"
              style={{ minHeight: '20px' }}
              placeholder="Define the AI assistant's role, behavior, and constraints..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={!rootFolder}
              rows={2}
            />
            <div className="char-counter">{systemPrompt.length} characters</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
              {lastSavedSystemPrompt && (
                <div style={{ fontSize: '11px', color: '#4ec9b0' }}>
                  Saved {new Date(lastSavedSystemPrompt).toLocaleTimeString()}
                </div>
              )}
              {defaultSystemPrompt && (
                <div style={{ fontSize: '11px', color: '#888' }}>
                  Default: {defaultSystemPrompt.length > 30 ? defaultSystemPrompt.substring(0, 30) + '...' : defaultSystemPrompt}
                </div>
              )}
            </div>
          </div>

          <div className="prompt-input-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="task">
                Task <span className="required-marker">*</span>
                <span style={{ marginLeft: '50px' }}>
                  <button
                    className="toolbar-button"
                    onClick={handleNewTask}
                    title="Clear task and start fresh"
                    disabled={!rootFolder}
                  >
                    New Task
                  </button>
                </span>
              </label>
            </div>

            {/* Prepended text buttons - First row */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {PREPEND_BUTTONS.map((button) => (
                <button
                  key={button.key}
                  className="toolbar-button"
                  onClick={() => handlePrepend(button.value)}
                  title={`Prepend: ${button.value}`}
                >
                  ⬇️ {button.key}
                </button>
              ))}
            </div>

            <textarea
              id="task"
              className="prompt-textarea"
              placeholder="Describe the specific task or objective..."
              value={task}
              onChange={(e) => setTask(e.target.value)}
              disabled={!rootFolder}
              rows={4}
            />
            {/* Appended text buttons - Second row */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px', flexWrap: 'wrap' }}>
              {APPEND_BUTTONS.map((button) => (
                <button
                  key={button.key}
                  className="toolbar-button"
                  onClick={() => handleAppend(button.value)}
                  title={`Append: ${button.value}`}
                >
                  ⬆️ {button.key}
                </button>
              ))}
            </div>

            <div className="char-counter">{task.length} characters</div>
            {standaloneCopyStatus !== 'idle' && (
              <div className={`alert-message alert-${standaloneCopyStatus === 'success' ? 'success' : 'error'}`} style={{ marginTop: '8px' }}>
                {standaloneCopyStatus === 'success' ? '✓ Standalone prompt copied to clipboard!' : 'Failed to copy standalone prompt'}
              </div>
            )}
            {lastSavedTask && (
              <div style={{ fontSize: '11px', color: '#4ec9b0', marginTop: 2 }}>
                Saved {new Date(lastSavedTask).toLocaleTimeString()}
              </div>
            )}
          </div>

          <div className="prompt-input-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="issues">
                {HEADER_OPTIONS.find(h => h.value === selectedHeader)?.display || 'Issues'} (Optional)
                <span style={{ marginLeft: '50px' }}>
                  <button
                    className="toolbar-button"
                    onClick={handleClearIssues}
                    title="Clear issues textarea"
                    disabled={!rootFolder}
                  >
                    Clear
                  </button>
                </span>
              </label>
            </div>

            {/* Section Header Radio Buttons */}
            <div style={{ marginBottom: '12px' }}>
              <span style={{ color: '#888', fontSize: '13px', marginRight: '12px' }}>Section Header:</span>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: '8px' }}>
                {HEADER_OPTIONS.map((option) => (
                  <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="header-option"
                      value={option.value}
                      checked={selectedHeader === option.value}
                      onChange={(e) => setSelectedHeader(e.target.value)}
                      disabled={!rootFolder}
                      style={{ margin: 0, cursor: 'pointer' }}
                    />
                    <span style={{ color: selectedHeader === option.value ? '#ccaa00' : '#ccc' }}>
                      {option.display}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <textarea
              id="issues"
              className="prompt-textarea issues-textarea"
              placeholder="List any known issues, feedback, logs, errors, or proposals..."
              value={issues}
              onChange={(e) => setIssues(e.target.value)}
              disabled={!rootFolder}
              rows={2}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="char-counter">{issues.length} characters</div>
              <div style={{ display: 'flex', gap: '12px' }}>
                {lastSavedIssues && (
                  <div style={{ fontSize: '11px', color: '#4ec9b0' }}>
                    Saved {new Date(lastSavedIssues).toLocaleTimeString()}
                  </div>
                )}
                {lastSavedHeader && (
                  <div style={{ fontSize: '11px', color: '#4ec9b0' }}>
                    Header saved {new Date(lastSavedHeader).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="referenced-files-section">
          <div className="referenced-files-header">
            <h4>Referenced Files ({selectedFilePaths.length})</h4>
          </div>

          <div className="referenced-files-display">
            <div className="referenced-files-content">
              {isLoadingFiles ? (
                <div className="referenced-files-loading">
                  <div className="spinner" />
                  Loading {selectedFilePaths.length} file{selectedFilePaths.length !== 1 ? 's' : ''}...
                </div>
              ) : selectedFilePaths.length === 0 ? (
                <div className="empty-referenced-files">
                  <div className="icon">📁</div>
                  <p>No files selected</p>
                  <p>Select files in the Explorer to include them</p>
                </div>
              ) : (
                <pre className="raw-content">{referencedFilesContent}</pre>
              )}
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button
            className="action-button secondary-button"
            onClick={() => setGenerationStatus('idle')}
            disabled={generationStatus === 'generating'}
          >
            Reset Status
          </button>
        </div>

        <div className="alert-message alert-info">
          <span>💡</span>
          <span>
            <strong>Content sanitization applied:</strong> HTML entities decoded. State saved per folder.
          </span>
        </div>
      </div>
    </div>
  );
};

export default PromptOrganizerTab;