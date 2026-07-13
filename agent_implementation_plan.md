# Seeker UI: RAG-Enhanced Inference Pipeline & MCP Integration — Implementation Plan

## Overview

This plan outlines the integration of remote MCP (Model Context Protocol) servers into Seeker UI's existing inference workflow to provide retrieval-augmented generation (RAG) context. The architecture is a **sequential async pipeline with structured state** — not an agentic loop. Under the RAG-only constraint (Phases 1–4), there is no branching, no LLM-influenced control flow, and no feedback loops. The pipeline executes a fixed sequence of steps, each of which can be expressed as a simple `await` call.

### Honest Architectural Framing

The word "agentic" is deliberately avoided in this revised plan. What is being built is:

1. **A thin orchestration layer in the main process** that handles credentials (`safeStorage`), MCP server connections, cancellation, and telemetry — the parts that genuinely require main-process access.
2. **Prompt assembly and output parsing remain in the renderer** where they are tightly coupled to React state (selected files, masked substrings, task text) and are easier to iterate on and test.

The primary motivation for introducing a main-process layer is **security**: `safeStorage` for MCP server credentials and avoiding API key exposure through IPC. This motivation stands independently of any "agentic" framing.

### What the Orchestrator Actually Provides

The `AgentOrchestrator` class adds value only for:

- **Cancellation** — a shared `cancelled` flag checked between steps. An `AbortController` passed through the chain achieves the same thing more idiomatically.
- **Node status telemetry** — emitting `agent:nodeStatus` IPC events at each step. A simple callback or event emitter passed into each function accomplishes the same thing.
- **Error isolation** — catching failures per-node without aborting the whole run. A `try/catch` around each `await` accomplishes this too.

These are legitimate infrastructure benefits, but they are not agentic capabilities. The plan documents them honestly as such.

### Features That Genuinely Benefit from Main-Process Placement

- **Credential-gated external services.** Anything requiring `safeStorage` — MCP server tokens, future OAuth flows, database connection strings — must live in main. If the orchestration layer is already there, adding a new credentialed call is just adding a function.
- **Background execution.** If inference or RAG retrieval should continue while the user switches folders or closes the Prompt tab, main process is the only place that works. Renderer-side logic is tied to the React component lifecycle.
- **File system operations mid-pipeline.** Memory updates and result post-processing already write to disk. A main-process layer can do this directly, eliminating IPC round-trips for multi-file updates.
- **Cross-window state.** If future features add a diff viewer, memory browser, or tool-call inspector as separate windows, a main-process layer is the natural single source of truth.

### Features That Do NOT Benefit from Main-Process Placement

- **UI-driven prompt assembly.** The `PromptOrganizerTab` already handles this well in the renderer because it is inherently coupled to React state — selected files, masked substrings, task text. Moving prompt assembly to main means either duplicating that state there or serializing it all into an IPC payload on every run. Neither is obviously better.
- **Parsing and applying LLM output.** The `InferenceTab`'s block replacement parser is complex and tightly coupled to the renderer's display logic. There is no strong reason to move it to main, and doing so would make the renderer dependent on main for what is currently a self-contained local operation.

### Practical Consideration

The main process in this app currently does relatively little — it is mostly IPC handlers delegating to `callOpenRouter`, `callVenice`, and `electron-store`. Adding a non-trivial pipeline there means the main process becomes harder to reason about if something blocks or throws, since a crash there takes down the entire app rather than just a renderer tab. This is why the orchestration layer should be kept **thin** — owning only what genuinely requires main-process access.

### Future: Agentic Tool-Calling (Not Implemented in This Plan)

If agentic tool-calling is introduced in the future (where the LLM influences what executes next, tool calls feed back into the loop, and the pipeline branches), the minimum viable safety layer would be:

- **Hard round limit** — configurable, defaulting to a conservative value (e.g., 4).
- **Per-round token accounting** — emitted via `agent:nodeStatus` IPC so the user sees cost accumulating in real time.
- **Tool filter allowlist** — enforced before tool definitions are sent to the model.

The data structures in this plan (`SeekerAgentState`, `NodeHistoryEntry`, `MCPCallResult`) already accommodate these, but none are implemented yet. This plan explicitly scopes them out.

---

## Validated Dependencies

To ensure mainstream compatibility, stability, and ease of packaging within Electron, the following dependencies have been validated and selected:

| Library | Version | Purpose | Validation Notes |
|---------|---------|---------|------------------|
| `@modelcontextprotocol/sdk` | `^1.0.0` | Official MCP SDK for TypeScript. | **Mainstream.** The canonical library maintained by Anthropic. Used by Claude Code, Cursor, etc. |
| `zod` | `^3.23.0` | Schema validation for tool inputs and MCP protocol. | **Mainstream.** Industry standard for TypeScript schema validation. |
| `p-queue` | `^8.0.0` | Promise concurrency control for MCP connections/queries. | **Mainstream.** Lightweight, zero-dependency queue. |

### Rejected / Replaced Dependencies
- **`keytar`**: Replaced by Electron's built-in `safeStorage` API. `keytar` requires native rebuilding (`electron-rebuild`) which often breaks across Electron versions. `safeStorage` uses OS-native keychains (macOS Keychain, Windows DPAPI, Linux GNOME Keyring) without native compilation.
- **`@langchain/langgraph`**: Replaced by a custom pipeline. The proposal explicitly notes that production agentic apps (Claude Code, Cursor) avoid heavy frameworks to maintain fine-grained control over tool execution and reduce bundle size.

---

## Phase 1 — Thin Orchestration Layer in Main

**Goal:** Move credential management, MCP connection lifecycle, cancellation, and telemetry into the main process. Prompt assembly and output parsing remain in the renderer.

**Estimated effort:** 3–5 days

### 1.1 Install Dependencies

```json
"dependencies": {
  "@modelcontextprotocol/sdk": "^1.0.0",
  "zod": "^3.23.0",
  "p-queue": "^8.0.0"
}
```

### 1.2 Create `src/shared/agent-types.ts`

Define the canonical shared types used across main and renderer processes:

```typescript
export interface SeekerAgentState {
  // Inputs (assembled by the renderer, passed to main)
  systemPrompt: string;
  userPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiTarget: 'OpenRouter' | 'Venice';
  rootFolder: string;
  applyRedaction: boolean;
  isSingleBlockReplacementMode: boolean;

  // MCP Context (populated by main-process retrieval)
  retrievedContext: string;
  mcpCallResults: MCPCallResult[];

  // Memory (populated by main-process memory layer)
  memoryContext: string | null;

  // Assembled Prompts (assembled by the renderer)
  assembledSystemPrompt: string;
  assembledUserPrompt: string;

  // Inference Outputs (returned by main-process inference call)
  inferenceResult: string;
  inferenceReasoning: string;
  finishReason?: string;
  truncated?: boolean;

  // Control
  error: string | null;
  nodeHistory: NodeHistoryEntry[];
  cancelled: boolean;
}

export interface NodeHistoryEntry {
  node: string;
  status: 'started' | 'completed' | 'skipped' | 'error';
  durationMs?: number;
  detail?: string;
}

export interface MCPCallResult {
  serverId: string;
  serverLabel: string;
  toolName: string;
  content: string;
  success: boolean;
  error?: string;
}

export interface AgentNodeStatusPayload {
  node: string;
  status: 'started' | 'completed' | 'skipped' | 'error';
  detail?: string;
}

export interface AgentResultPayload {
  success: boolean;
  content: string;
  reasoning?: string;
  error?: string;
  usage?: object;
  finishReason?: string;
  truncated?: boolean;
  nodeHistory: NodeHistoryEntry[];
  mcpCallResults?: MCPCallResult[];
  isSingleBlockReplacementMode: boolean;
}

// Context Retrieval Request (renderer to main)
export interface RetrieveContextRequest {
  mcpSelectedServerIds: string[];
  userPrompt: string;
  rootFolder: string;
}

// Context Retrieval Response (main to renderer)
export interface RetrieveContextResponse {
  retrievedContext: string;
  mcpCallResults: MCPCallResult[];
  nodeHistory: NodeHistoryEntry[];
}
```

### 1.3 Create `src/main/agent/AgentOrchestrator.ts` — Thin Layer

The `AgentOrchestrator` is a **thin layer** in the main process that owns only:

- MCP server connections and credential retrieval (via `safeStorage`)
- Cancellation (shared flag / `AbortController`)
- Telemetry (emitting `agent:nodeStatus` events to the renderer)
- The `context_retrieval` step (MCP RAG queries)

It does **NOT** own:
- **Prompt assembly** — stays in the renderer, coupled to React state (selected files, masked substrings, task text). Moving it to main would require either duplicating that state in main or serializing it all into an IPC payload on every run.
- **Output parsing** — stays in the renderer. The `InferenceTab`'s block replacement parser is complex and tightly coupled to the renderer's display logic. There is no strong reason to move it to main.
- **Inference dispatch** — the existing `openRouter:call` IPC handler remains unchanged. The renderer calls it directly with the fully assembled prompt.

**Execution flow (when RAG is requested):**
1. Renderer calls `agent:retrieveContext` IPC with selected server IDs + user prompt.
2. Main process queries selected MCP servers via `MCPClientManager`, aggregates results.
3. Main returns `retrievedContext` string + `mcpCallResults[]` to the renderer.
4. Renderer assembles the full prompt (system + user + retrieved context + referenced files) — same logic as today, plus the new `<retrieved_context>` tag.
5. Renderer calls `openRouter:call` IPC with assembled prompts — unchanged from today.
6. Renderer parses and displays the result — unchanged from today.

**When RAG is skipped:** The `agent:retrieveContext` IPC is not called at all. The renderer assembles the prompt and calls inference directly, exactly as it does today. The orchestrator is not involved.

**Abort mechanism:** The orchestrator exposes an `abort()` method that sets an `AbortController`. The `context_retrieval` step checks the signal before and during MCP server queries. This is functionally equivalent to passing an `AbortController` through a chain of `await` calls, but centralized for telemetry.

### 1.4 Update `src/main/main.ts`

Add new IPC channels:
- `agent:retrieveContext` — takes `RetrieveContextRequest`, runs context retrieval against selected MCP servers, returns `RetrieveContextResponse`.
- `agent:cancel` — aborts an in-flight context retrieval.
- Emit `agent:nodeStatus` events from the orchestrator to the renderer via `mainWindow.webContents.send`.

The existing `openRouter:call` IPC handler remains **unchanged** — the renderer still calls it directly with the fully assembled prompt. This avoids moving prompt assembly to the main process where it would need to duplicate or serialize React state.

### 1.5 Update `src/main/preload.js` & `src/shared/electron.d.ts`

Expose:
```javascript
agentRetrieveContext: (payload) => ipcRenderer.invoke('agent:retrieveContext', payload),
agentCancel: () => ipcRenderer.invoke('agent:cancel'),
onAgentNodeStatus: (callback) => ipcRenderer.on('agent:nodeStatus', (_, data) => callback(data)),
```

---

## Phase 2 — MCP Foundation

**Goal:** Users can configure remote MCP servers through the GUI, store credentials securely using `safeStorage`, and test connections. All MCP configuration and credential management lives in the main process.

**Estimated effort:** 5–7 days

### 2.1 Define MCP Configuration Types in `src/shared/agent-types.ts`

```typescript
export type MCPAuthType = 'none' | 'bearer' | 'api-key-header' | 'basic';
export type MCPTransportType = 'sse' | 'streamable-http';

export interface MCPServerConfig {
  id: string;                    // UUID
  label: string;                 // user-facing display name
  url: string;                   // HTTPS base URL
  transport: MCPTransportType;
  authType: MCPAuthType;
  authHeaderName?: string;       // for 'api-key-header'
  authUsername?: string;         // for 'basic'
  enabled: boolean;
  toolFilter?: string[];         // empty = all tools allowed; enforced before tool definitions are sent to the model
  timeoutMs?: number;            // defaults to 30000
  lastTestResult?: {
    success: boolean;
    testedAt: number;
    toolCount?: number;
    error?: string;
  };
}
```

### 2.2 Extend `StoreSchema` in `src/main/main.ts`

```typescript
interface StoreSchema {
  // ... existing fields ...
  mcpServers?: MCPServerConfig[];
  mcpSelectionGlobal?: string[];  // IDs of MCP servers selected for RAG at global scope; persisted at rest and restored at app restart
  agentSettings?: {
    memoryEnabled: boolean;
    memoryMaxTokens: number;
  };
}

// Also extend FolderSpecificState with a per-folder MCP selection override:
interface FolderSpecificState {
  // ... existing fields ...
  mcpSelectedServerIds?: string[];  // Per-folder override of global MCP server selection for RAG; takes precedence when present
}
```

### 2.3 Create `src/main/mcp/MCPServerRegistry.ts`

Responsible for CRUD operations on `MCPServerConfig[]` in `electron-store` and credential management via Electron's `safeStorage`.

```typescript
import { safeStorage } from 'electron';

export class MCPServerRegistry {
  getAll(): MCPServerConfig[];
  getById(id: string): MCPServerConfig | undefined;
  save(config: MCPServerConfig): void;
  delete(id: string): void;
  
  setCredential(id: string, value: string): void;
  getCredential(id: string): string | null;
  deleteCredential(id: string): void;
}
```
*Note: `safeStorage.encryptString` and `safeStorage.decryptString` are used to store encrypted blobs in `electron-store` under a separate `mcpCredentials` key. This is the primary security motivation for the main-process layer.*

### 2.4 Create `src/main/mcp/MCPClientManager.ts`

Manages the pool of active MCP `Client` instances using `@modelcontextprotocol/sdk`.

**Key methods:**
- `connect(config: MCPServerConfig)`: Retrieves credential from `MCPServerRegistry`, constructs `SSEClientTransport` or `StreamableHTTPClientTransport`, and connects.
- `disconnect(id: string)`: Disconnects and removes client.
- `testConnection(config)`: Connects, lists tools, disconnects, returns latency.
- `listTools(id)`: Lists tools applying `toolFilter`.
- `callTool(id, toolName, params)`: Executes tool and returns stringified content.
- `connectAll(configs)`: Uses `p-queue` (concurrency 4) to connect all enabled servers.

### 2.5 Register MCP IPC Handlers in `src/main/main.ts`

```typescript
ipcMain.handle('mcp:getServers', () => registry.getAll());
ipcMain.handle('mcp:saveServer', (_, config) => registry.save(config));
ipcMain.handle('mcp:deleteServer', async (_, id) => {
  registry.delete(id);
  registry.deleteCredential(id);
  await clientManager.disconnect(id);
});
ipcMain.handle('mcp:setCredential', (_, id, value) => registry.setCredential(id, value));
ipcMain.handle('mcp:testConnection', (_, config) => clientManager.testConnection(config));
ipcMain.handle('mcp:listTools', (_, id) => clientManager.listTools(id));

// MCP RAG selection persistence (global + per-folder)
ipcMain.handle('mcp:getGlobalSelection', () => store.get('mcpSelectionGlobal') || []);
ipcMain.handle('mcp:saveGlobalSelection', (_, ids: string[]) => { store.set('mcpSelectionGlobal', ids); return { success: true }; });
ipcMain.handle('mcp:getFolderSelection', (_, folderPath: string) => getFolderState(folderPath).mcpSelectedServerIds ?? null);
ipcMain.handle('mcp:saveFolderSelection', (_, folderPath: string, ids: string[]) => { saveFolderState(folderPath, { mcpSelectedServerIds: ids }); return { success: true }; });
```

Expose these in `src/main/preload.js` and `src/shared/electron.d.ts`:
```javascript
getMcpServers: () => ipcRenderer.invoke('mcp:getServers'),
saveMcpServer: (config) => ipcRenderer.invoke('mcp:saveServer', config),
deleteMcpServer: (id) => ipcRenderer.invoke('mcp:deleteServer', id),
setMcpCredential: (id, value) => ipcRenderer.invoke('mcp:setCredential', id, value),
testMcpConnection: (config) => ipcRenderer.invoke('mcp:testConnection', config),
listMcpTools: (id) => ipcRenderer.invoke('mcp:listTools', id),
getMcpGlobalSelection: () => ipcRenderer.invoke('mcp:getGlobalSelection'),
saveMcpGlobalSelection: (ids) => ipcRenderer.invoke('mcp:saveGlobalSelection', ids),
getMcpFolderSelection: (folderPath) => ipcRenderer.invoke('mcp:getFolderSelection', folderPath),
saveMcpFolderSelection: (folderPath, ids) => ipcRenderer.invoke('mcp:saveFolderSelection', folderPath, ids),
```

### 2.6 Create `src/renderer/components/tabs/McpSettingsTab.tsx`

Add a new "MCP" tab to `FileManager.tsx` containing:
- A list of `ServerCard` components.
- Add/Edit/Delete/Enable-Disable functionality.
- "Test Connection" button.
- Credential input (write-only, password-masked).

---

## Phase 3 — RAG Context Injection

**Goal:** Configured MCP servers are queried at inference time via the main-process retrieval layer, and retrieved content is injected into the prompt by the renderer.

**Estimated effort:** 4–5 days

### 3.0 Scope & Interaction Contract

**RAG transparency advantages:**

The RAG approach has a natural transparency advantage that fits the app's design:
- The `<retrieved_context>` tag is visible in the assembled prompt — the user can audit what was retrieved.
- The user chose which MCP servers to query via the confirmation dialog.
- The token cost is fixed and auditable — no multi-round expansion that could push the prompt closer to context limits.
- This aligns well with the app's existing emphasis on user control and redaction visibility.

Users are already working with large referenced file contexts. Stacking agentic tool-calling overhead on top of already-large prompts would put every run closer to context limits, especially for models with smaller effective context windows despite large advertised limits. The RAG approach avoids this.

**Critical design constraints — all remote MCP servers serve a single purpose:**

1. **RAG-only scope:** Remote MCP servers are used **exclusively** for generating content that populates the `<retrieved_context>` tag — i.e., retrieval-augmented generation (RAG) data that enriches the inference context. They are **not** used for tool-calling, agentic actions, file modifications, or any purpose other than providing supplementary context.

2. **User confirmation gate:** Before any inference request is sent to OpenRouter or Venice, the user **must always** be asked whether he/she wants RAG data retrieved from remote MCP servers for this inference run. This prompt appears every time the user initiates inference (it is never silently skipped). The dialog presents the list of currently-selected MCP servers (by label) and offers:
   - **Yes, retrieve RAG data** — proceeds with the `context_retrieval` step active.
   - **No, skip RAG** — proceeds with the `context_retrieval` step skipped (no MCP calls made; `<retrieved_context>` tag is omitted from the assembled prompt).

3. **Multi-selection persistence:** The user's latest multi-selection of which MCP servers to use for RAG must be persisted at rest and restored at app restart. Selections exist at two scopes:
   - **Global selection:** A set of MCP server IDs applicable when no folder-specific override exists. Stored under `mcpSelectionGlobal?: string[]` in the store schema.
   - **Project/folder-specific selection:** A per-folder override map stored within `FolderSpecificState` as `mcpSelectedServerIds?: string[]`. When a folder is opened, if a folder-specific selection exists it takes precedence; otherwise the global selection is used.
   - The confirmation dialog pre-checks the servers from the effective selection (folder-specific or global) so the user can quickly confirm or adjust. Any changes the user makes in the dialog are persisted back to the effective scope immediately.

### 3.1 Implement `context_retrieval` in Main Process

The `agent:retrieveContext` IPC handler (added in Phase 1.4) becomes active:

1. Retrieve only the servers whose IDs are in the effective selection AND are enabled in the registry.
2. Use `p-queue` to call `listTools` and identify a retrieval tool (e.g., matching `^(retrieve|search|query|find|lookup)/i`).
3. Execute the tool with `{ query: state.userPrompt, limit: 5 }`.
4. Aggregate results into `retrievedContext` wrapped in `<source server="..." tool="...">` tags.
5. Failures are caught and recorded in `mcpCallResults` without aborting the retrieval or the subsequent inference.
6. Emit `agent:nodeStatus` events for telemetry (started to completed/error per server).

### 3.2 Update Prompt Assembly in `PromptOrganizerTab.tsx` (Renderer)

The renderer receives `retrievedContext` from the main process (via the `agent:retrieveContext` IPC response) and injects it into the user prompt under a `<retrieved_context>` sub-tag, positioned after `<context>` and before `<referenced_files>`. When RAG was skipped or returned no data, the `<retrieved_context>` tag is omitted entirely.

Prompt assembly remains in the renderer because it is inherently coupled to React state — selected files, masked substrings, task text, inference context. Moving it to main would require either duplicating that state in main or serializing it all into an IPC payload on every run, neither of which is obviously better.

### 3.3 Surface RAG Status in `InferenceTab.tsx`

Add a collapsible "Context Retrieval" panel that appears when `mcpCallResults` is present:
```text
▼ Context Retrieval  (2 sources)
  ✓  KnowledgeBase (retrieve) — 3 chunks
  ✗  SecondaryDB   — connection failed: timeout
```
When the user skipped RAG, the panel shows: `Context Retrieval — skipped by user`.

### 3.4 RAG Confirmation Dialog in `PromptOrganizerTab.tsx`

Create a `RagConfirmDialog` component that is shown **every time** the user clicks the Start Inference button (before any API call is dispatched). The dialog:

1. Loads the effective MCP server selection:
   - If `mcp:getFolderSelection(rootFolder)` returns a non-null array, use it (folder-specific override).
   - Otherwise use `mcp:getGlobalSelection()`.
2. Displays a multi-select checklist of all configured MCP servers (label + URL), pre-checking the servers from the effective selection.
3. Shows the message: `Do you want to retrieve RAG data from remote MCP servers for this inference?`
4. Provides two primary actions:
   - **Yes, retrieve RAG data** — persists the current checklist selection back to the effective scope (folder-specific if an override existed, otherwise global) via `mcp:saveFolderSelection` or `mcp:saveGlobalSelection`, sets `ragRequested = true`, passes the selected server IDs to the retrieval IPC call, and proceeds with inference.
   - **No, skip RAG** — sets `ragRequested = false`, still persists the current checklist selection (so the user's latest multi-selection is saved at rest), and proceeds with inference with the `context_retrieval` step skipped.
5. A **Cancel** button aborts the inference attempt entirely (no API call is made).

The persisted selection is restored at app restart because it is stored in `electron-store` under `mcpSelectionGlobal` (global) or within `folderStates[folderPath].mcpSelectedServerIds` (per-folder).

### 3.5 Renderer-Driven Inference Flow

The complete inference flow is now:

1. User clicks Start Inference in `PromptOrganizerTab.tsx`.
2. RAG confirmation dialog appears (every time — never silently skipped).
3. If RAG requested:
   a. Renderer calls `agentRetrieveContext` IPC with selected server IDs + user prompt.
   b. Main process queries MCP servers, returns `retrievedContext` + `mcpCallResults`.
   c. Renderer receives `mcpCallResults` for status display in `InferenceTab`.
4. Renderer assembles full prompt (system + user + retrieved context + referenced files) — same logic as today, plus the new `<retrieved_context>` tag when RAG data is present.
5. Renderer calls `openRouter:call` IPC with assembled prompts — **unchanged from today**.
6. Renderer parses and displays result — **unchanged from today**.

This keeps the pipeline simple and honest: main handles credentials/MCP retrieval, renderer handles prompt assembly and output parsing. The existing `executeInference` function in `PromptOrganizerTab.tsx` gains one new step (the `agentRetrieveContext` IPC call) between file loading and prompt assembly.

---

## Phase 4 — Session Memory

**Goal:** Optional per-folder session memory that injects a rolling conversation summary into each inference. Off by default. Memory storage and summary generation live in the main process; memory injection into the prompt happens in the renderer during prompt assembly.

**Estimated effort:** 3–4 days

### 4.1 Extend `StoreSchema` for Memory

```typescript
agentMemory?: Record<string, AgentMemoryEntry>; // keyed by folder path hash

interface AgentMemoryEntry {
  folderId: string;
  folderPath: string;
  summary: string;
  exchangeCount: number;
  lastUpdatedAt: number;
  tokenEstimate: number;
}
```

### 4.2 Create `src/main/agent/AgentMemory.ts`

Handles reading and updating memory in the main process. `updateMemory` fires-and-forgets a background LLM call to summarize the previous summary + latest exchange. This lives in main because it requires API key access (via `safeStorage`-protected credentials) and should continue running even if the user switches tabs.

### 4.3 Memory Injection in Renderer

If `agentSettings.memoryEnabled` is true, the renderer calls a new `agent:getMemory` IPC to retrieve the memory summary for the current `rootFolder` before assembling the prompt. The memory context is injected into the system prompt as:
```text
<session_memory>
{memoryContext}
</session_memory>
```
This keeps prompt assembly in the renderer where it belongs. The main process only provides the memory string; the renderer decides where and how to inject it.

### 4.4 Memory Update After Inference

If memory is enabled and inference was successful, the renderer calls `agent:updateMemory` IPC with the latest exchange (system prompt + user prompt + inference result). The main process triggers the background `updateMemory` call. The renderer does not wait for the memory update to complete before displaying the inference result.

### 4.5 Memory UI in `McpSettingsTab.tsx`

Add a "Session Memory" section:
- Toggle: Enable Memory (default Off)
- Max Summary Tokens input
- Current Folder Memory stats (Exchanges, Last updated, Tokens)
- "View Summary" and "Clear Folder Memory" buttons.

---

## Phase 5 — Polish & Extensibility

**Goal:** Production-quality UX, observable pipeline execution, and a documented extension pattern.

**Estimated effort:** 3–4 days

### 5.1 Node Status Streaming in `InferenceTab.tsx`

Replace the binary running/done state with per-step progress driven by `onAgentNodeStatus`:
```text
● Running inference…

  ✓  Context Retrieval   (2 sources, 340ms)
  ✓  Memory Injection    (skipped — memory disabled)
  ✓  Prompt Assembly     (12,450 tokens)
  ↻  Inference           running…
  ○  Post-processing     pending
```
Note: "Prompt Assembly" and "Inference" steps are tracked by the renderer locally; "Context Retrieval" and "Memory" steps are tracked via `agent:nodeStatus` events from main. The node status panel merges both streams chronologically.

### 5.2 MCP Tool Filter UI Enhancement

In `McpSettingsTab.tsx`, add a "Browse Available Tools" expansion on each server card (visible after a successful test). Allow toggling tools via checkboxes instead of comma-separated text.

### 5.3 Pipeline Extension Documentation

Create `src/main/agent/NODES.md` documenting the interface contract for adding new retrieval or post-processing steps to the main-process layer, and the pattern for surfacing new steps via `agent:nodeStatus` events. Emphasize that the main-process layer should remain thin — only steps requiring `safeStorage`, file system access, or background execution belong there.

### 5.4 Future: Agentic Tool-Calling Safety Layer (Design Document Only)

This section documents the minimum viable safety layer for a future agentic tool-calling mode. It is **not implemented** in this plan but is documented here so the data structures in Phase 1.2 already accommodate it.

**Hard round limit:**
- Configurable, defaulting to 4.
- Enforced by the orchestrator before each LLM call in the tool-calling loop.
- When the limit is reached, the pipeline terminates and returns the last valid response.

**Per-round token accounting:**
- After each LLM call in the tool-calling loop, emit a `agent:nodeStatus` event with:
  - `node: 'tool_round_N'`
  - `status: 'completed'`
  - `detail: { roundTokens, cumulativeTokens, toolsCalled }`
- The renderer displays cumulative token cost in real time via the node status panel.

**Tool filter allowlist:**
- The `toolFilter` field on `MCPServerConfig` (already defined in Phase 2.1) is enforced before tool definitions are sent to the model.
- Tools not in the allowlist are never exposed to the LLM, preventing the model from calling unapproved tools.

**Context window awareness:**
- Users are already working with large referenced file contexts. Stacking agentic tool-calling overhead on top of already-large prompts puts every run closer to context limits, especially for models with smaller effective context windows despite large advertised limits.
- The RAG approach (Phases 1–4) avoids this by keeping token cost fixed and auditable. If agentic tool-calling is introduced later, the per-round token accounting above is the minimum mechanism for keeping the user informed about context consumption.

These four measures ensure that if agentic tool-calling is ever enabled, the user retains visibility and control over cost, scope, and context consumption.

---

## Anticipated File Manifest

The following files are expected to be created or modified across all phases. Files marked **new** do not yet exist; files marked **modified** have existing content that requires extension.

### New Files

| File | Phase | Purpose |
|------|-------|---------|
| `src/shared/agent-types.ts` | 1.2 | Canonical shared types: `SeekerAgentState`, `NodeHistoryEntry`, `MCPCallResult`, `AgentNodeStatusPayload`, `AgentResultPayload`, `RetrieveContextRequest`, `RetrieveContextResponse`, `MCPServerConfig`, `AgentMemoryEntry` |
| `src/main/agent/AgentOrchestrator.ts` | 1.3 | Thin main-process layer: cancellation via `AbortController`, `agent:nodeStatus` telemetry emission, delegates to `MCPClientManager` for retrieval |
| `src/main/mcp/MCPServerRegistry.ts` | 2.3 | CRUD for `MCPServerConfig[]` in `electron-store`; credential encryption/decryption via `safeStorage` |
| `src/main/mcp/MCPClientManager.ts` | 2.4 | Pool of active MCP `Client` instances; `connect`, `disconnect`, `testConnection`, `listTools`, `callTool`, `connectAll` |
| `src/renderer/components/tabs/McpSettingsTab.tsx` | 2.6 | MCP server management UI: add/edit/delete/enable-disable, test connection, credential input, session memory section (Phase 4.5) |
| `src/renderer/components/RagConfirmDialog.tsx` | 3.4 | Pre-inference confirmation dialog: multi-select checklist of MCP servers, Yes/No/Cancel, persists selection back to effective scope |
| `src/main/agent/AgentMemory.ts` | 4.2 | Per-folder session memory: read summary, fire-and-forget background LLM summarisation update |
| `src/main/agent/NODES.md` | 5.3 | Extension documentation: interface contract for new main-process retrieval/post-processing steps, `agent:nodeStatus` pattern, thin-layer principle |

### Modified Files

| File | Phase | Changes |
|------|-------|---------|
| `src/main/main.ts` | 1.4, 2.2, 2.5, 4.1 | Extend `StoreSchema` with `mcpServers`, `mcpSelectionGlobal`, `agentSettings`, `agentMemory`; extend `FolderSpecificState` with `mcpSelectedServerIds`; register `agent:retrieveContext`, `agent:cancel`, `agent:getMemory`, `agent:updateMemory` IPC handlers; register all `mcp:*` IPC handlers; emit `agent:nodeStatus` via `mainWindow.webContents.send` |
| `src/main/preload.js` | 1.5, 2.5 | Expose `agentRetrieveContext`, `agentCancel`, `onAgentNodeStatus`, `getMcpServers`, `saveMcpServer`, `deleteMcpServer`, `setMcpCredential`, `testMcpConnection`, `listMcpTools`, `getMcpGlobalSelection`, `saveMcpGlobalSelection`, `getMcpFolderSelection`, `saveMcpFolderSelection`, `getAgentMemory`, `updateAgentMemory` |
| `src/shared/electron.d.ts` | 1.5, 2.5 | Type declarations matching all new preload exposures |
| `src/renderer/components/tabs/PromptOrganizerTab.tsx` | 3.2, 3.4, 3.5, 4.3, 4.4 | Show `RagConfirmDialog` before inference; call `agentRetrieveContext` IPC when RAG requested; inject `<retrieved_context>` into assembled user prompt; call `agent:getMemory` and inject `<session_memory>` into system prompt when memory enabled; call `agent:updateMemory` fire-and-forget after successful inference |
| `src/renderer/components/tabs/InferenceTab.tsx` | 3.3, 5.1 | Add collapsible "Context Retrieval" status panel driven by `mcpCallResults`; replace binary running/done indicator with per-step node status panel merging `agent:nodeStatus` events from main and local renderer-tracked steps |
| `src/renderer/components/FileManager.tsx` | 2.6 | Add "MCP" tab entry pointing to `McpSettingsTab` |
| `package.json` | 1.1 | Add `@modelcontextprotocol/sdk ^1.0.0`, `zod ^3.23.0`, `p-queue ^8.0.0` to `dependencies` |
