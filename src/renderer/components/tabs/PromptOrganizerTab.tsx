import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getErrorMessage,
  getRelativePath,
  sanitizeText,
  parseMaskedSubstrings,
  applyCustomMasking
} from '../../../shared/utils';
import { parseSegments, extractBlockItems } from '../../../shared/block-parser';

import InferenceControls from '../shared/InferenceControls';

interface PromptOrganizerTabProps {
  selectedFilePaths: string[];
  rootFolder?: string | null;
  onBackToOverview: () => void;
  onSwitchToInference?: () => void;
  onPasteInference?: () => void;
  onInferenceStatusChange?: (
    status: 'idle' | 'running' | 'success' | 'error',
    result?: string,
    reasoning?: string,
    error?: string,
    isSingleBlockReplacement?: boolean,
  ) => void;
}

// Define prepend and append button configurations for scalability
const PREPEND_BUTTONS: Array<{ key: string; value: string }> = [
  { key: 'Feasibility', value: 'Please explore feasibility ' },
  { key: 'Analysis', value: 'Please provide analysis ' },
  { key: 'Review', value: 'Please review ' },
  { key: 'Solution', value: 'Please propose the best solution ' },
  { key: 'Enhancement', value: 'Please propose enhancement ' },
  { key: 'Improvement', value: 'Please propose improvement ' },
  { key: 'Words', value: 'Please propose word changes ' },
  { key: 'Codes', value: 'Please propose code changes ' },
  { key: 'Fixes', value: 'Please propose fixes to the following errors/issues ' },
  { key: 'Report', value: 'Please create a report ' },
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
- "reason": string — a brief explanation of why this change is proposed
- "is_full_file": boolean — true if the operation applies to the entire file; false if it applies to a specific block
  * "add" + true: create a new file with content in "replacement"
  * "add" + false: insert "replacement" after the anchor block in "original"
  * "replace" + true: overwrite the entire file with "replacement"
  * "replace" + false: replace the exact block in "original" with "replacement"
  * "delete" + true: delete the entire file
  * "delete" + false: remove the exact block in "original"
- "original": string or null — the verbatim, exact text from the target file
  * For partial "replace" or "delete": copy the complete contiguous block character-for-character from the file, including all whitespace and indentation. Include enough surrounding lines so the block is globally unique within the file.
  * Line completeness — every line inside "original" must reproduce ALL characters of the corresponding source line in full: no truncation, abbreviation, elision, ellipses ("..."), placeholders, or comment stand-ins (e.g. "// unchanged"). Reproduce even very long lines in their entirety; a partial line will fail to match and the update will be rejected.
  * For partial "add": the exact anchor block after which new content will be inserted.
  * When is_full_file is true: set to null.
- "replacement": string or null — the new content to insert or replace. Set to null for "delete".

JSON STRING ESCAPING RULES:
- Use \\n for newlines, \\t for tabs inside all string values.
- Do not embed unescaped literal newlines inside JSON string values.
- Do not wrap "replacement" content in internal markdown code fences.
- CRITICAL — Escape ALL grave-accent / backtick characters (Unicode U+0060, the \` character used to delimit Markdown code fences and JS template literals) that appear inside any JSON string value (especially "original" and "replacement") as the JSON unicode escape sequence \\u0060. A single backtick must be written as \\u0060; three consecutive backticks (a Markdown fenced-code-block delimiter, i.e. \`\`\`) must be written as \\u0060\\u0060\\u0060. NEVER emit a literal \` inside a JSON string value under any circumstance, even when the source file itself contains fenced code blocks, template literals, or markdown. Failing to escape backticks causes the outer JSON code fence to be prematurely closed, breaking the parser. A standard JSON parser automatically decodes \\u0060 back into a literal backtick character, so the file content is restored exactly and no extra unescaping is needed on the receiving end.
- For example, a TypeScript file containing the template literal \`hello\` must appear in the JSON string as \\u0060hello\\u0060, and a Markdown file containing the fenced block \`\`\`js\\n...\\n\`\`\` must appear as \\u0060\\u0060\\u0060js\\n...\\n\\u0060\\u0060\\u0060.
- Output must be immediately parseable by a standard JSON parser.

Guidelines:
- Keep replacements minimal — change only what is necessary; avoid rewriting surrounding unchanged lines.
- For partial operations, "original" must match the file content character-for-character — including every character of every line; never shorten, elide, ellipsize, or omit any part of a line.
- The "original" field is used ONLY to locate the block in the file. Do not repeat or restate the original block outside the "original" field (for example, do not paste the original block into "reason" or as prose); the "replacement" field must contain exactly the block's intended final content and nothing more.
- Prefer fewer, larger contiguous blocks over many small fragmented ones.
- All content must be directly copy-pasteable.

Example:
\`\`\`json
[
  {
    "path": "<project_root>/src/example.ts",
    "op": "replace",
    "reason": "Updated foo to return 2 as required by the new spec",
    "is_full_file": false,
    "original": "function foo() {\\n  return 1;\\n}",
    "replacement": "function foo() {\\n  return 2;\\n}"
  },
  {
    "path": "<project_root>/src/other.ts",
    "op": "replace",
    "reason": "Full rewrite to support new interface",
    "is_full_file": true,
    "original": null,
    "replacement": "<full new file content>"
  },
  {
    "path": "<project_root>/src/code.md",
    "op": "replace",
    "reason": "Demonstrate proper backtick (U+0060) escaping inside a JSON string",
    "is_full_file": false,
    "original": "This has a code block: \\u0060\\u0060\\u0060js\\ncode here\\n\\u0060\\u0060\\u0060",
    "replacement": "This has a code block: \\u0060\\u0060\\u0060ts\\nupdated code\\n\\u0060\\u0060\\u0060"
  }
]
\`\`\`
`;

const tagged_block_update_prompt = `
**SCAN INSTRUCTIONS:**
- Scan all referenced files in the order they are provided.
- Identify XML tags **exactly** in this format:
  <block_to_update tasks="{modification instructions}">{content to modify}</block_to_update>
- **CRITICAL: Single block only.** Process **only the very first** '<block_to_update>' tag encountered across all files (in document order). 
  Ignore every subsequent matching tag entirely — do not read them, process them, reference them, or include them in any way in your output.

**For the first matched tag:**
1. Extract the 'tasks' attribute value. This contains the **authoritative and complete** modification instructions.
2. Apply those instructions **exclusively** to the text content enclosed between the opening '<block_to_update ...>' and closing '</block_to_update>' tags.
3. Do **not** modify, affect, or spill any changes into any text outside the tag boundaries.

**Strict Scoping & Boundary Rules**
Strictly perform **precisely scoped** modification as below.
- **Strict Tag Scoping**: The scope of modification is strictly limited to the inner text inside the '<block_to_update>...</block_to_update>' tags. Nothing else may be altered.
- **Zero Boundary Spill**: Do not let any changes spill outside the tag. For example, if the file contains PrefixText<block_to_update tasks="...">TargetText</block_to_update>SuffixText, **only** TargetText may be modified. The "replacement" field must contain **only** the rewritten version of the inner content. It must never include any prefix text, suffix text, or surrounding content.
- **AAA/BBB/CCC Rule**: 
Given 
AAA<block_to_update tasks="Improve wording">BBB</block_to_update>CCC, 
only the string "BBB" is eligible for modification. The surrounding "AAA" and "CCC" must remain completely untouched.
**OUTPUT FORMAT:**
Respond **exclusively** with a single valid JSON array (fenced in a code block) containing **exactly one** update object. Do not include any prose, explanations, reasoning, tags, or additional text outside the JSON.

\`\`\`json
[
  {
    "path": "<exact file path of the matched block>",
    "op": "replace",
    "reason": "<very brief 1-line summary of what was done, based on the tasks>",
    "is_full_file": false,
    "replacement": "<the fully updated inner text block ONLY>"
  }
]
\`\`\`

**JSON STRING ESCAPING RULES**:
- Use \\n for newlines, \\t for tabs inside all string values.
- Do not embed unescaped literal newlines inside JSON string values.
- CRITICAL — Escape ALL grave-accent / backtick characters (Unicode U+0060, the \` character used to delimit Markdown code fences and JS template literals) that appear inside any JSON string value (especially "replacement") as the JSON unicode escape sequence \\u0060. A single backtick must be written as \\u0060; three consecutive backticks (a Markdown fenced-code-block delimiter, i.e. \`\`\`) must be written as \\u0060\\u0060\\u0060. NEVER emit a literal \` inside a JSON string value under any circumstance, even when the source file itself contains fenced code blocks, template literals, or markdown. Failing to escape backticks causes the outer JSON code fence to be prematurely closed, breaking the parser. A standard JSON parser automatically decodes \\u0060 back into a literal backtick character, so the file content is restored exactly and no extra unescaping is needed on the receiving end.
- For example, a TypeScript file containing the template literal \`hello\` must appear in the JSON string as \\u0060hello\\u0060, and a Markdown file containing the fenced block \`\`\`js\\n...\\n\`\`\` must appear as \\u0060\\u0060\\u0060js\\n...\\n\\u0060\\u0060\\u0060.
- Output must be immediately parseable by a standard JSON parser.

Example:
\`\`\`json
[
  {
    "path": "<project_root>/src/code.md",
    "op": "replace",
    "reason": "Demonstrate backtick (U+0060) escaping in a block replacement",
    "is_full_file": false,
    "replacement": "# Example\\n\\nHere is a code block: \\u0060\\u0060\\u0060js\\nconsole.log('escaped');\\n\\u0060\\u0060\\u0060"
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
- "reason": string — a brief explanation of why this change is proposed
- "is_full_file": true
- "original": null
- "replacement": string or null — the complete new file content using \\n for newlines, \\t for tabs. Set to null for "delete".

JSON STRING ESCAPING RULES:
- Use \\n for newlines, \\t for tabs inside all string values.
- Do not embed unescaped literal newlines inside JSON string values.
- CRITICAL — Escape ALL grave-accent / backtick characters (Unicode U+0060, the \` character used to delimit Markdown code fences and JS template literals) that appear inside any JSON string value (especially "replacement") as the JSON unicode escape sequence \\u0060. A single backtick must be written as \\u0060; three consecutive backticks (a Markdown fenced-code-block delimiter, i.e. \`\`\`) must be written as \\u0060\\u0060\\u0060. NEVER emit a literal \` inside a JSON string value under any circumstance, even when the source file itself contains fenced code blocks, template literals, or markdown. Failing to escape backticks causes the outer JSON code fence to be prematurely closed, breaking the parser. A standard JSON parser automatically decodes \\u0060 back into a literal backtick character, so the file content is restored exactly and no extra unescaping is needed on the receiving end.
- For example, a TypeScript file containing the template literal \`hello\` must appear in the JSON string as \\u0060hello\\u0060, and a Markdown file containing the fenced block \`\`\`js\\n...\\n\`\`\` must appear as \\u0060\\u0060\\u0060js\\n...\\n\\u0060\\u0060\\u0060.
- Output must be immediately parseable by a standard JSON parser.

Example:
\`\`\`json
[
  {
    "path": "<project_root>/src/example.ts",
    "op": "replace",
    "reason": "Updated foo to return 2 as required by the new spec",
    "is_full_file": true,
    "original": null,
    "replacement": "// full new file content\\nexport function foo() {\\n  return 2;\\n}"
  },
  {
    "path": "<project_root>/src/code.md",
    "op": "replace",
    "reason": "Demonstrate backtick (U+0060) escaping in a full file replacement",
    "is_full_file": true,
    "original": null,
    "replacement": "# Example\\n\\nHere is a code block: \\u0060\\u0060\\u0060js\\nconsole.log('escaped');\\n\\u0060\\u0060\\u0060"
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
    key: 'Single File', value: full_file_prompt.replace(
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
  { display: 'Retrieved Context', value: 'retrieved_context' },
  { display: 'Info', value: 'info' },
  { display: 'Constraints', value: 'constraints' },
];

const PromptOrganizerTab: React.FC<PromptOrganizerTabProps> = ({
  selectedFilePaths,
  rootFolder,
  onBackToOverview,
  onSwitchToInference,
  onPasteInference,
  onInferenceStatusChange,
}) => {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [task, setTask] = useState('');
  const [inferenceContext, setInferenceContext] = useState('');
  const [referencedFilesContent, setReferencedFilesContent] = useState<string>('');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [lastSavedSystemPrompt, setLastSavedSystemPrompt] = useState<number | null>(null);
  const [lastSavedTask, setLastSavedTask] = useState<number | null>(null);
  const [lastSavedInferenceContext, setLastSavedInferenceContext] = useState<number | null>(null);
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

  // Clipboard block detection for enabling the "Paste Inference" button
  const [hasBlockInClipboard, setHasBlockInClipboard] = useState(false);
  // True while the paste action is in flight (button shows inactive until clipboard is cleared)
  const [pasteInferenceUsed, setPasteInferenceUsed] = useState(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    const checkClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        const segments = parseSegments(text);
        const blocks = extractBlockItems(segments);
        const hasBlocks = blocks.length > 0;
        setHasBlockInClipboard(hasBlocks);
        // Re-enable button once clipboard no longer contains blocks
        if (!hasBlocks) setPasteInferenceUsed(false);
      } catch {
        setHasBlockInClipboard(false);
        setPasteInferenceUsed(false);
      }
    };
    checkClipboard();
    intervalId = setInterval(checkClipboard, 2000);
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const handlePasteInferenceClick = useCallback(async () => {
    if (!onPasteInference || !hasBlockInClipboard || pasteInferenceUsed) return;
    // Mark as used immediately so the button goes inactive
    setPasteInferenceUsed(true);
    // Execute the paste action
    if (onSwitchToInference) onSwitchToInference();
    onPasteInference();
    // Clear the clipboard so the button stays inactive and the user
    // must copy a new result before they can paste again
    try {
      await navigator.clipboard.writeText('');
      setHasBlockInClipboard(false);
    } catch {
      // Clipboard clear failed — the periodic check will update the state
    }
  }, [onPasteInference, onSwitchToInference, hasBlockInClipboard, pasteInferenceUsed]);

  // Load saved data when rootFolder changes
  useEffect(() => {
    const handleFolderChange = async () => {
      if (!rootFolder) return;

      // Reset init refs to prevent auto-save effects from overwriting the new
      // folder's persisted state with stale values from the previous folder
      // before the async load completes.
      systemPromptInitRef.current = true;
      taskInitRef.current = true;
      inferenceContextInitRef.current = true;
      maskedSubstringsInitRef.current = true;

      try {
        // Check if state exists for this specific folder
        const savedState = await window.electronAPI.getFolderState(rootFolder);

        if (savedState) {
          // State exists: Load it into the UI
          setSystemPrompt(savedState.systemPrompt || '');
          setTask(savedState.task || '');
          setInferenceContext(savedState.inferenceContext ?? savedState.issues ?? '');
          setMaskedSubstrings(savedState.maskedSubstrings || '');
        } else {
          // State does NOT exist: Inherit current values (Inheritance Logic)
          // The current state variables hold values from the previous folder context.
          // We save these current values to the new folder's key.

          const currentStateToInherit = {
            systemPrompt,
            task,
            inferenceContext,
            maskedSubstrings
          };

          // Save to the new folder path
          await window.electronAPI.saveFolderState(rootFolder, currentStateToInherit);

          // UI remains unchanged (values are inherited). 
          // Optional: Indicate save time
          const now = Date.now();
          setLastSavedSystemPrompt(now);
          setLastSavedTask(now);
          setLastSavedInferenceContext(now);
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

  // Check if the task contains the merged Tagged Block Update prompt.
  // While this is true, all other prefix/suffix buttons are locked; the lock is
  // cleared only when the user presses "New Task" (which empties the task).
  const hasBlockScanReplace = useMemo(() => task.includes(tagged_block_update_prompt), [task]);

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

  const saveInferenceContext = useCallback(async (value: string) => {
    if (!rootFolder) return;
    try {
      await window.electronAPI.saveInferenceContext(rootFolder, value);
      setLastSavedInferenceContext(Date.now());
    } catch (err) {
      console.error('Failed to save inference context:', err);
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

  const inferenceContextInitRef = React.useRef(true);
  useEffect(() => {
    if (!rootFolder) return;
    if (inferenceContextInitRef.current) { inferenceContextInitRef.current = false; return; }
    const timer = setTimeout(() => {
      saveInferenceContext(inferenceContext);
    }, 800);
    return () => clearTimeout(timer);
  }, [inferenceContext, saveInferenceContext, rootFolder]);

  // Load / reload referenced files content.
  // Returns the freshly loaded combined content so that callers (Copy Prompt /
  // Start Inference) can use the latest file contents directly, without
  // depending on the asynchronously-updated React state variable
  // (referencedFilesContent), which still holds the previous render's value
  // inside the same closure.
  const loadFileContents = useCallback(async (): Promise<string> => {
    if (selectedFilePaths.length === 0) {
      setReferencedFilesContent('');
      return '';
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
      return combinedContent;
    } catch (error) {
      console.error('Error loading files:', error);
      const errorContent = `Error loading files: ${getErrorMessage(error)}`;
      setReferencedFilesContent(errorContent);
      return errorContent;
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

  // Handle Clear Inference Context button - clear Inference Context textarea
  const handleClearInferenceContext = () => {
    setInferenceContext('');
    saveInferenceContext(''); // Save empty string
  };

  // Handle header option button click - insert sub-tag placeholder into inference context
  const handleHeaderOptionClick = (tagValue: string) => {
    const tagContent = `<${tagValue}>

</${tagValue}>`;
    setInferenceContext(prev => {
      if (!prev.trim()) {
        return tagContent;
      }
      return `${prev}

${tagContent}`;
    });
  };

  // Ref to store pending inference parameters when modal is shown
  const pendingInferenceRef = React.useRef<{
    model: string;
    temperature: number;
    apiTarget?: 'OpenRouter' | 'Venice';
    maxTokens?: number;
  } | null>(null);

  // State for the empty-referenced-files confirmation modal
  const [showEmptyFilesModal, setShowEmptyFilesModal] = useState(false);

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
  const handlePrepend = (textToPrepend: string, replaceFull: boolean = false) => {
    setTask(prevTask => {
      // If trying to replace in full or no existing task content found
      if (replaceFull || !prevTask.trim()) {
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
      // Always reload the full contents of all referenced files first so the
      // copied prompt is guaranteed to contain the latest on-disk content.
      const freshFilesContent = await loadFileContents();
      // Generate prompt with or without redaction based on checkbox, using the
      // freshly loaded content directly (not the async state variable).
      await handleGeneratePrompt(redactionApplied, freshFilesContent);
    } catch (error) {
      console.error('Failed to copy prompt:', error);
      setGenerationStatus('error');
    }
  };

  const handleGeneratePrompt = async (applyRedaction: boolean = true, freshFilesContent?: string) => {
    if (!systemPrompt.trim() || !task.trim()) return;

    setGenerationStatus('generating');

    try {
      // Sanitize all text inputs first
      const sanitizedSystemPrompt = sanitizeText(systemPrompt.trim());
      const sanitizedTask = sanitizeText(task.trim());
      const sanitizedInferenceContext = inferenceContext.trim() ? sanitizeText(inferenceContext.trim()) : '';
      // Prefer the freshly loaded file contents (passed in by the caller after a
      // guaranteed reload); fall back to the state variable only when not
      // provided. referencedFilesContent is already built from files; we treat
      // it as is (no extra sanitization needed here).
      const filesContent = freshFilesContent ?? referencedFilesContent;

      const customSubstrings = parseMaskedSubstrings(maskedSubstrings);

      // Apply custom substring masking unconditionally to all fields
      const processedSystemPrompt = applyCustomMasking(sanitizedSystemPrompt, customSubstrings);
      const processedTask = applyCustomMasking(sanitizedTask, customSubstrings);
      const processedInferenceContext = applyCustomMasking(sanitizedInferenceContext, customSubstrings);
      const processedFiles = applyCustomMasking(filesContent, customSubstrings);

      // Build the prompt parts
      const promptParts = [];
      const missingFilesNomination = '---\n**Please nominate missing or unselected but still anticipated files if there are any**\n';

      promptParts.push(`<system_prompt content="System Prompt">\n${processedSystemPrompt}\n</system_prompt>`);
      const taskInnerContent = hasBlockScanReplace
        ? processedTask
        : `${processedTask}\n${missingFilesNomination}`;
      promptParts.push(`<task content="Task">\n${taskInnerContent}</task>`);

      if (processedInferenceContext) {
        promptParts.push(`<context content="Context">\n${processedInferenceContext}\n</context>`);
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

  // Core inference execution logic (extracted so both handleStartInference and
  // the modal Continue callback can share it without duplicating the API call).
  const executeInference = useCallback(async (
    model: string,
    temperature: number,
    apiTarget?: 'OpenRouter' | 'Venice',
    maxTokens?: number,
  ) => {
    setInferenceStatus2('running');
    setInferenceResult('');
    setInferenceReasoning('');
    setInferenceError('');
    onInferenceStatusChange?.('running', undefined, undefined, undefined, hasBlockScanReplace);
    onSwitchToInference?.();

    try {
      // Always reload the full contents of all referenced files first so the
      // prompt sent to the remote API is guaranteed to contain the latest
      // on-disk content. Use the returned value directly rather than the
      // asynchronously-updated state variable.
      const freshFilesContent = await loadFileContents();

      const sanitizedSystemPrompt = sanitizeText(systemPrompt.trim());
      const sanitizedTask = sanitizeText(task.trim());
      const sanitizedInferenceContext = inferenceContext.trim() ? sanitizeText(inferenceContext.trim()) : '';
      const filesContent = freshFilesContent;
      const customSubstrings = parseMaskedSubstrings(maskedSubstrings);

      const processedSystemPrompt = applyCustomMasking(sanitizedSystemPrompt, customSubstrings);
      const processedTask = applyCustomMasking(sanitizedTask, customSubstrings);
      const processedInferenceContext = applyCustomMasking(sanitizedInferenceContext, customSubstrings);
      const processedFiles = applyCustomMasking(filesContent, customSubstrings);

      const userParts: string[] = [];
      userParts.push(`<task>${processedTask}</task>`);
      if (processedInferenceContext) {
        userParts.push(`<context>\n${processedInferenceContext}\n</context>`);
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
        { temperature, ...(maxTokens ? { maxTokens } : {}), ...(apiTarget ? { apiTarget } : {}) } as any
      );

      setInferenceResult(result.content || result.text || '');
      if (result.reasoning) setInferenceReasoning(result.reasoning);
      setInferenceStatus2('success');
      onInferenceStatusChange?.('success', result.content || result.text || '', result.reasoning, undefined, hasBlockScanReplace);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      setInferenceError(errMsg);
      setInferenceStatus2('error');
      onInferenceStatusChange?.('error', undefined, undefined, errMsg, hasBlockScanReplace);
    }
  }, [
    canGeneratePrompt,
    systemPrompt,
    task,
    inferenceContext,
    maskedSubstrings,
    referencedFilesContent,
    redactionApplied,
    loadFileContents,
    hasBlockScanReplace,
    onInferenceStatusChange,
    onSwitchToInference,
  ]);

  const handleStartInference = useCallback(async (
    model: string,
    temperature: number,
    apiTarget?: 'OpenRouter' | 'Venice',
    maxTokens?: number,
  ) => {
    if (!canGeneratePrompt) return;

    // When no files are referenced, ask the user to confirm before proceeding.
    if (selectedFilePaths.length === 0) {
      pendingInferenceRef.current = { model, temperature, apiTarget, maxTokens };
      setShowEmptyFilesModal(true);
      return;
    }

    await executeInference(model, temperature, apiTarget, maxTokens);
  }, [canGeneratePrompt, selectedFilePaths, executeInference]);

  // Modal confirmation: user chose to continue with empty referenced files.
  const handleConfirmEmptyFiles = useCallback(async () => {
    const params = pendingInferenceRef.current;
    pendingInferenceRef.current = null;
    setShowEmptyFilesModal(false);
    if (params) {
      await executeInference(params.model, params.temperature, params.apiTarget, params.maxTokens);
    }
  }, [executeInference]);

  // Modal dismissal: user cancelled — do nothing.
  const handleCancelEmptyFiles = useCallback(() => {
    pendingInferenceRef.current = null;
    setShowEmptyFilesModal(false);
  }, []);

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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', whiteSpace: 'nowrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#888', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={redactionApplied}
                    onChange={(e) => setRedactionApplied(e.target.checked)}
                  />
                  Redaction Applied
                </label>
              </div>
          </div>

          <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                className={`generate-prompt-button ${!canGeneratePrompt ? 'disabled' : ''} ${generationStatus === 'success' ? 'success' : ''
                  }`}
                style={{ padding: '7px 5px' }}
                onClick={handleCopyPrompt}
                disabled={!canGeneratePrompt || generationStatus === 'generating'}
                title="Copy the combined prompt (system + user) to clipboard for external inference"
              >
                {generationStatus === 'success' ? '✓ Copied!' : 'Copy Prompt'}
              </button>
              <button
                className={`generate-prompt-button paste-inference ${!onPasteInference || !hasBlockInClipboard || pasteInferenceUsed ? 'disabled' : ''}`}
                onClick={handlePasteInferenceClick}
                disabled={!onPasteInference || !hasBlockInClipboard || pasteInferenceUsed}
                title={
                  pasteInferenceUsed
                    ? 'Inference result pasted — clipboard cleared. Copy a new result to paste again.'
                    : 'Switch to Inference tab and paste clipboard content if it contains valid code update blocks'
                }
              >
                {pasteInferenceUsed ? '✓ Pasted' : 'Paste Inference Result'}
              </button>
            </div>
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
              <button className="toolbar-button" onClick={() => navigator.clipboard.writeText(inferenceResult)} style={{ padding: '2px 8px', fontSize: '11px' }} title="Copy inference result to clipboard">Copy</button>
            </div>
            <div className="inference-result-area" style={{ maxHeight: '250px' }}>{inferenceResult}</div>
          </div>
        )}
      </div>

      {/* Empty Referenced Files confirmation modal */}
      {showEmptyFilesModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            zIndex: 5000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={handleCancelEmptyFiles}
        >
          <div
            style={{
              background: '#1e1e1e',
              border: '1px solid #555',
              borderRadius: 8,
              padding: '24px 28px',
              maxWidth: 420,
              width: '90%',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px 0', color: '#e0e0e0', fontSize: 16, fontWeight: 500 }}>
              No Referenced Files
            </h3>
            <p style={{ margin: '0 0 20px 0', color: '#cccccc', fontSize: 13, lineHeight: 1.5 }}>
              The referenced files list is currently empty. The inference will run
              without any file context. Do you want to continue?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                className="file-editor__modal-btn file-editor__modal-btn--secondary"
                onClick={handleCancelEmptyFiles}
              >
                Cancel
              </button>
              <button
                className="file-editor__modal-btn file-editor__modal-btn--primary"
                onClick={handleConfirmEmptyFiles}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

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
              className="prompt-textarea system-prompt"
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
              </label>
              <button
                className="toolbar-button green-action"
                onClick={handleNewTask}
                title="Clear task and start fresh"
                disabled={!rootFolder}
              >
                New Task
              </button>
            </div>

            {/* Prepended text buttons - First row */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {PREPEND_BUTTONS.map((button) => (
                <button
                  key={button.key}
                  className="toolbar-button"
                  onClick={() => handlePrepend(button.value)}
                  title={hasBlockScanReplace ? 'Locked while Single Block Replacement is active. Press "New Task" to unlock.' : `Prepend: ${button.value}`}
                  disabled={hasBlockScanReplace}
                >
                  ⬇️ {button.key}
                </button>
              ))}
              <button
                className="toolbar-button block-scan-replace-button"
                onClick={() => handlePrepend(tagged_block_update_prompt, true)}
                title="Inject the combined Tagged Block Update instructions into the task. While active, all other prefix/suffix buttons are locked until you press 'New Task'."
                disabled={hasBlockScanReplace || !rootFolder}
              >
                ⬇️ Tagged Block Update
              </button>
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
                  title={hasBlockScanReplace ? 'Locked while Single Block Replacement is active. Press "New Task" to unlock.' : `Append: ${button.value}`}
                  disabled={hasBlockScanReplace}
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
              <label htmlFor="inference-context">
                Inference Context (Optional)
              </label>
              <button
                className="toolbar-button green-action"
                onClick={handleClearInferenceContext}
                title="Clear inference context textarea"
                disabled={!rootFolder}
              >
                Clear
              </button>
            </div>

            {/* Sub-tag insertion buttons */}
            <div style={{ marginBottom: '12px' }}>
              <span style={{ color: '#888', fontSize: '13px', marginRight: '12px' }}>Insert sub-tag:</span>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
                {HEADER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className="toolbar-button"
                    onClick={() => handleHeaderOptionClick(option.value)}
                    title={`Insert <${option.value}> sub-tag into inference context`}
                    disabled={!rootFolder}
                  >
                    ⬇️ {option.display}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              id="inference-context"
              className="prompt-textarea issues-textarea"
              placeholder="Add inference context such as issues, errors, logs, output, feedback, proposals, analysis, or other information..."
              value={inferenceContext}
              onChange={(e) => setInferenceContext(e.target.value)}
              disabled={!rootFolder}
              rows={4}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="char-counter">{inferenceContext.length} characters</div>
              <div style={{ display: 'flex', gap: '12px' }}>
                {lastSavedInferenceContext && (
                  <div style={{ fontSize: '11px', color: '#4ec9b0' }}>
                    Saved {new Date(lastSavedInferenceContext).toLocaleTimeString()}
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
            title="Reset prompt generation status to idle"
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