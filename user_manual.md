# Seeker UI Manual

This document guides you through every step, from the first launch to applying AI-generated changes.

---

## 1. First Launch & End-User License Agreement (EULA)

When you start Seeker UI for the first time, the **EULA modal** blocks the main interface until you accept or decline the terms.

- **Agree and Proceed** – saves your acceptance in `electron-store` and opens the main window.
- **Deny and Exit** – quits the application.

The EULA covers:
- Disclaimer of liability and "as-is" use.
- Your responsibility when using third-party inference providers (OpenRouter and Venice).
- Local-first privacy (no telemetry, analytics, or tracking).
- Open-source licensing (personal, non-commercial use; enterprise licensing requires separate agreement).

Once agreed, you will not see the modal again on subsequent launches.

---

## 2. Configuration (Settings)

The **Settings tab** lets you configure global, application-wide settings that are shared across all folders.

### OpenRouter

| Field | Purpose |
|-------|---------|
| **OpenRouter API Key** | Your OpenRouter API key (hidden by default, visible when focused). Required for OpenRouter inference. |
| **Models for Inference** | A comma-separated list of quoted model names (e.g. "anthropic/claude-sonnet-4-6", "deepseek/deepseek-v4-pro"). These populate the model dropdown when OpenRouter is selected as the API target. |

### Venice

| Field | Purpose |
|-------|---------|
| **Venice API Key** | Your Venice AI API key. Required for Venice inference. |
| **Models for Inference** | A comma-separated list of quoted model names for Venice (e.g. "llama-3.3-70b", "deepseek-r1"). These populate the model dropdown when Venice is selected. |

- **Auto-save** – changes are saved automatically after a short debounce.
- **Import / Export** – you can import or export settings as a JSON file, making it easy to share configurations across machines.

**Tip:** API keys are sent only to the respective provider; they are never logged or stored outside your local `electron-store`.

---

## 3. Selecting Files (Explorer)

The **Explorer** is the left-hand sidebar. It displays the file tree of the currently opened folder.

### Opening a Folder
- Click **"Open Folder"** to open a dialog showing recent folders and a "Browse" button. The last opened folder is remembered across sessions.
- Up to 10 recent folders are tracked and displayed for quick switching.
- The folder's state (system prompt, task, inference context, inference model, temperature, API target, max tokens, and inference results) is automatically saved per folder.

### Selecting Files
- Each file has a **checkbox** – check any file to include it in the referenced files section of your prompt.
- **Folders** – checking a folder selects all files inside it recursively. The folder will expand to show its contents.
- **Clear** – deselects all checked files.
- **Refresh** – reloads the directory tree and verifies the existence of previously selected files (invalid selections and favorites are removed).

### Binary File Detection
- The app inspects the first 512 bytes of each file to detect binary content.
- Binary files are blocked from being checked (selected) or opened in the Editor. A transient warning notice is displayed when a binary file is encountered.

### Favorite Files
- Click the **star icon (★/☆)** next to any file to add or remove it from your favorites.
- Favorites are stored per folder and displayed in a dedicated section at the top of the Explorer.
- Use the **Clear** button in the favorites header to remove all favorites at once.

### File Actions
Each file row provides quick-action icons:
- **★/☆** – toggle favorite status.
- **📋** – copy the project-root-relative path (e.g. `<project_root>/src/example.ts`) to the clipboard.
- **✒️** – open the file in the Editor tab.

### Context Menu (Right-Click)
Right-clicking any file or folder opens a context menu with:
- **Copy File/Folder Path** – copies the project-root-relative path.
- **Create New File** (folders only) – opens a dialog to create a new file in that folder.
- **Edit** (files only) – opens the file in the Editor tab.
- **Add/Remove Favorite** (files only) – toggles favorite status.
- **Delete File** (files only) – opens the containing folder in your system file manager for manual deletion.
- **Open Containing Folder** – reveals the file/folder in your OS file manager.

### Creating New Files
- Use the **"📄+ New File"** button at the bottom of the sidebar, or right-click a folder and choose **"Create New File"**.
- Enter the file name and click **Create**. The parent folder is automatically expanded.

### Single-Click to Open
- Single-clicking a file in the tree opens it in the **Editor tab** for editing. The file name is highlighted with an outstanding color to indicate it is the currently opened file.

---

## 4. Editing Files (Editor Tab)

The **Editor tab** provides a full-featured code editor for individual files.

### Opening a File
- Single-click any file in the Explorer, or click the **✒️** edit icon, or right-click and choose **Edit**.
- The tab title shows the project-root-relative path of the currently open file.
- Files larger than 10 MB are rejected.

### Editing Features
- **Search & Replace** – an always-visible search bar with case-sensitive matching, match navigation (↑/↓), and replace/replace-all functionality.
- **Undo / Redo** – Ctrl/Cmd+Z for undo, Ctrl/Cmd+Y for redo. History is batched with a 600ms debounce.
- **Word Wrap** – toggle word wrap on/off via the toolbar.
- **Font Size** – increase font size (+2px) or reset to the default (13px). Font size is saved per folder.
- **Copy All** – copies the entire file content to the clipboard.
- **Revert All** – reloads the file from disk, discarding all unsaved changes.
- **Save** – Ctrl/Cmd+S saves the file to disk. The toolbar shows save status (Saving…, ✓ Saved, ✗ Failed).
- **Markdown Preview** – click the **📄 Preview** button to open a standalone markdown preview window.
- **Prepare Inference** – click the **⚡ Prepare Inference** button to switch to the Prompt tab.

### Unicode-Safe Copy/Cut/Paste
- The editor snaps selection boundaries to Unicode scalar values, ensuring supplementary characters (emoji, CJK extensions, etc.) are never split when copying, cutting, or pasting.

### Unsaved Changes Guard
- If you have unsaved changes and attempt to switch files, tabs, or folders, a confirmation modal appears:
  - **Save Changes** – saves the current file, then proceeds with the switch.
  - **Abandon Changes** – discards unsaved changes and proceeds.
  - Press **Escape** to cancel and stay on the current file.

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd+F | Focus the search bar |
| Ctrl/Cmd+S | Save |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Y | Redo |
| Enter (in search) | Next match |
| Shift+Enter (in search) | Previous match |

---

## 5. Building Prompts (Prompt Organizer)

The **Prompt tab** is where you craft the instructions that will be sent to the AI. It is divided into several sections:

### 5.1 System Prompt
- Defines the assistant's role, tone, and constraints (e.g., "You are a senior software engineer…").
- **Required** – the tab will not allow copying the prompt or running inference if empty.
- **Global Default** – you can save the current system prompt as the global default (click "Save as Global", then confirm within 5 seconds), and later load it into any folder with "Load Global".
- **Auto-saved** per folder.

### 5.2 Task
- Describes the specific task or objective.
- **Required** – must be filled for inference.
- **Prepend buttons** – quickly add common task prefixes:
  - Feasibility, Analysis, Review, Solution, Enhancement, Improvement, Words, Codes, Fixes, Report
  - **Tagged Block Update** – injects instructions for a single-block replacement mode (see Section 9.2). While active, all other prepend/append buttons are locked until you press "New Task".
- **Append buttons** – add structural instructions:
  - **Single File** – full-file replacement prompt for a single file.
  - **Files** – full-file replacement prompt for multiple files.
  - **Files – conditional** – same as above, but only requests changes if needed.
  - **Update blocks** – block-level replacement instructions.
  - **Update blocks – conditional** – same, but only if changes are required.
  - **Minimal changes** – instructs the AI to keep changes minimal.
- **New Task** clears the task field.
- **Get Standalone Prompt** – copies just the task text (with custom masking applied) to the clipboard, without the system prompt or file context.

### 5.3 Inference Context (Optional)
- A free-form field for listing known issues, errors, logs, output, feedback, proposals, or any additional context.
- **Sub-tag insertion buttons** – click to insert XML sub-tags: Issues, Errors, Output, Logs, Feedback, Proposals, Retrieved Context, Info, Constraints. Each inserts an empty tag pair (e.g., `<issues>` and `</issues>` with a blank line between them) into the context.
- **Clear** empties the field.

### 5.4 Referenced Files
- Displays the content of all selected files (from the Explorer). Each file is wrapped in an XML-like `<file path="...">` tag.
- The content is automatically **sanitised** (HTML entities decoded) and, if the **"Redaction Applied"** checkbox is ticked, **redacted** using a configurable set of policies (API keys, AWS/Azure keys, credit cards, emails, IP addresses, MAC addresses, passwords, private keys, Slack tokens, Stripe keys, phone numbers, URLs, usernames, UUIDs, and custom Azure subscription/resource group patterns).
- **Custom Masked Substrings** – you can define a list of double-quoted substrings that will be replaced with `[SENSITIVE]` in the prompt. This is useful for hiding proprietary names or internal identifiers.

### 5.5 The Prompt Structure
When you click **"Copy Prompt"**, the app builds a combined prompt with the following structure (after applying sanitisation, custom masking, and optional redaction):

```
<system_prompt content="System Prompt">
  [your system prompt]
</system_prompt>
<user_prompt content="User Prompt">
  <task content="Task">
    [task]
    ---
    **Please nominate missing or unselected but still anticipated files if there are any**
  </task>
  ---
  <context content="Context">          (if provided)
    [inference context]
  </context>
  ---
  <referenced_files content="Referenced Files">          (if files are selected)
    <file path="...">...</file>
    ...
  </referenced_files>
</user_prompt>
```

The **"Copy Prompt"** button copies this full structured prompt to your clipboard. You can then paste it into any external LLM interface.

---

## 6. Choosing API Provider, Model, and Parameters

At the top of the **Prompt tab**, next to the "Copy Prompt" button, you'll find the inference controls:

- **API** – select the inference provider: **OpenRouter** or **Venice**.
- **Model dropdown** – populated from the "Models for Inference" setting for the selected provider. Select the model you want to use.
- **Temp** – a numeric input (0.0 – 2.0) controlling sampling temperature.
- **Max Tokens** – a dropdown with choices: 4096, 8192, 16384, 32768, 65536, 102400.
- These values are saved per folder and will be restored when you reopen the folder.

**Note:** Some models require specific temperature settings when deep-thinking is enabled – the app automatically adjusts the temperature when it detects a compatible model (e.g., Anthropic Claude models require temperature = 1 when thinking is active). The app also enforces a minimum max_tokens floor when thinking is active, based on the model's capability profile.

---

## 7. Running Inference and Reviewing Results

Once you have configured your system prompt, task, selected files, and chosen a model/temperature, you can run inference:

1. In the **Prompt tab**, click **"Start Inference"**.
2. If no files are selected, a confirmation modal asks whether to continue without file context.
3. The app will:
   - Build the prompt (applying redaction if enabled).
   - Send it to the selected provider (OpenRouter or Venice) using the chosen model.
   - Display a "running" status and switch to the Inference tab.
4. Upon completion, the **Inference tab** shows:
   - The assistant's **reasoning** (if returned by the model).
   - The main **inference result** – the assistant's reply.
   - A truncation warning if the response was cut off by the token limit (finish_reason = "length").

The inference result is parsed for **block replacement items** – specially formatted JSON objects that describe file modifications (see Section 9). These blocks are rendered with distinct visual cues (original vs replacement, operation type, etc.).

### Stopping Inference
While inference is running, a **"Cancel"** button appears in the Inference tab. Click it to abort the request.

### Re-running Inference
The **"Run Inference Again"** button in the Inference tab re-sends the prompt with the current model and parameters – useful for iterative refinement.

### Inference State Persistence
Inference results, reasoning, errors, and status are saved per folder and restored when you reopen the folder.

---

## 8. Copying Prompts to External Services & Pasting Responses Back

Seeker UI is built to work seamlessly with **outside inference services**, such as OpenRouter's web chat, ChatGPT, Claude, etc.

### Copying the Prompt
- Use the **"Copy Prompt"** button in the Prompt tab to copy the full structured prompt to your clipboard.
- You can now paste it into any external chat interface or API client.

### Pasting a Response
Once you receive a response from an external service (or from any other source), you can bring it back into Seeker UI.

There are two ways to paste a response:

#### Quick Paste from the Prompt Tab
- In the **Prompt tab**, next to the "Copy Prompt" button, there is a **"Paste Inference Result"** button.
- This button automatically detects whether your clipboard contains a valid JSON block replacement response. If it does, the button becomes enabled.
- Click it to paste the result directly into the Inference tab and switch to that tab. The app will parse the response, display it, and enable the **"Update Files"** button if valid blocks are found.
- After pasting, the button is temporarily disabled and the clipboard is cleared to prevent accidental re-pasting. To paste again, copy a new response to the clipboard.

#### Paste from the Inference Tab
- Alternatively, switch to the **Inference tab** and click the **"Paste"** button there.
- This reads your clipboard content, sanitizes it, and parses it for fenced JSON blocks.
- The result is displayed in the inference result area, and if valid block replacement items are found, the **"Update Files"** button becomes enabled.

Both methods allow you to use any AI service you prefer and still leverage Seeker UI's file-update workflow.

---

## 9. Applying Block Updates to Files

When the inference result (or pasted response) contains a valid JSON array of block replacement items, you can apply those changes to your files.

### 9.1 Standard Block Replacement

Each object in the JSON array must have:

- `"path"` – relative path prefixed with `<project_root>/`.
- `"op"` – one of `"add"`, `"replace"`, or `"delete"`.
- `"reason"` – explanation of the change (displayed in the UI).
- `"is_full_file"` – boolean; `true` means the operation applies to the entire file.
- `"original"` – string or `null`; the exact block to be replaced/deleted (for partial operations).
- `"replacement"` – string or `null`; the new content (for add/replace, `null` for delete).

The UI renders each block with the original and replacement side-by-side, along with a **copy** button for each snippet.

### Applying Updates
1. With a valid set of blocks in the result area, click **"Update Files"**.
2. A confirmation prompt appears. Click **"OK"** to proceed.
3. The app will:
   - For each block, attempt to locate the file, read it, find the `original` block (using exact match, flexible whitespace-insensitive regex, or trimmed line-by-line matching as fallbacks), and perform the specified operation.
   - Write the updated content back to disk.
4. A **File Update Summary** popup shows the result for each file (success/failure, operation type, and any errors).

### 9.2 Single Block Replacement (Tagged Block Update)

When you use the **"Tagged Block Update"** prepend button in the Prompt tab, the AI is instructed to find the first `<block_to_update>` XML tag in the referenced files and return only the updated inner content. In this mode:

- The **"Update Files"** button applies the replacement to the inner content of the first `<block_to_update>` tag found in the target file, preserving the tag wrapper and any surrounding text.
- Only one block item is expected in the result.

---

## 10. Markdown Preview Window

The standalone **Markdown Preview window** renders file content as formatted markdown or plain text.

- Open it from the Editor tab by clicking the **📄 Preview** button.
- The window opens as a separate BrowserWindow and can be positioned independently.
- **Theme** – toggle between dark and light mode.
- **View Mode** – switch between "As Text" (raw markdown with symbols visible) and "As Markdown" (rendered).
- **Zoom** – set zoom to 100%, 110%, 120%, or 150%.
- All preview settings (theme, mode, zoom) and window bounds are persisted.
- The preview content updates live as you edit in the Editor tab.

---

## 11. About Tab

The **About tab** provides links to the project repository, issue tracker, and licensing information.

- **Source & Releases** – view code and download the latest release.
- **Report an Issue** – bugs and feature requests.
- **Enterprise Licensing** – bulk/commercial use inquiries.

The app is open-source software for personal, non-commercial use. Enterprise or bulk usage requires separate licensing.

---

## Final Notes

- **All settings, prompts, and inference results are stored locally** in `electron-store`. No data is sent anywhere except to the configured inference provider (OpenRouter or Venice) when you explicitly run inference.
- The app is **open-source and free for personal, non-commercial use**. For enterprise or bulk usage, please contact the authors for licensing terms.
- **Security** – the app includes built-in redaction for common secrets (API keys, passwords, credit cards, IPs, emails, etc.) and custom masking for user-defined substrings. However, you are ultimately responsible for reviewing what you send to third-party APIs.
- **Backups** – before applying AI-generated changes, ensure all uncommitted changes are committed to your source control system (e.g., Git) or create a backup. The app does not provide an undo function for file modifications.

Enjoy using Seeker UI – The Visual AI Workspace that puts you in control of your code, your prompts, and your workflow.
