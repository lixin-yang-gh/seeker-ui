# Seeker UI: Agentic Architecture & MCP Integration — Implementation Plan

## Overview

This plan outlines the transformation of Seeker UI's single-shot inference workflow into an agentic architecture with remote MCP (Model Context Protocol) server integration. It combines the lightweight, custom agent loop approach (avoiding heavy frameworks like LangChain) with a robust MCP integration strategy using the official MCP SDK. 

All phases are independently shippable. Phase 1 establishes the agent engine; Phase 2 adds MCP configuration; Phase 3 enables RAG context injection; Phase 4 introduces optional memory; Phase 5 polishes the UX.

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
- **`@langchain/langgraph`**: Replaced by a custom agent loop. The proposal explicitly notes that production agentic apps (Claude Code, Cursor) avoid heavy frameworks to maintain fine-grained control over tool execution and reduce bundle size.

---

## Phase 1 — Infrastructure & Agent Scaffolding

**Goal:** Route existing inference through a custom Agent Engine with zero behavioral change.

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
  // Inputs
  systemPrompt: string;
  userPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiTarget: 'OpenRouter' | 'Venice';
  rootFolder: string;
  applyRedaction: boolean;
  isSingleBlockReplacementMode: boolean;

  // MCP Context
  retrievedContext: string;
  mcpCallResults: MCPCallResult[];

  // Memory
  memoryContext: string | null;

  // Assembled Prompts
  assembledSystemPrompt: string;
  assembledUserPrompt: string;

  // Inference Outputs
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
```

### 1.3 Create `src/main/agent/AgentOrchestrator.ts`

Implement a custom `AgentOrchestrator` class that executes a predefined sequence of nodes. In Phase 1, `context_retrieval` and `memory_injection` are no-op pass-through nodes.

**Execution Sequence:**
1. `context_retrieval` (stub)
2. `memory_injection` (stub)
3. `prompt_assembly` (ports existing logic from `PromptOrganizerTab.tsx`)
4. `inference` (calls `callOpenRouter` or `callVenice`)
5. `result_postprocess` (stub)

**Abort mechanism:** The orchestrator exposes an `abort()` method that sets `state.cancelled = true`. The `inference` node checks this flag before making the API call.

### 1.4 Update `src/main/main.ts`

Replace the direct `callOpenRouter`/`callVenice` dispatch inside `ipcMain.handle('openRouter:call', ...)` with a call to `AgentOrchestrator.run(payload)`. 

Add new IPC channels:
- `agent:cancel` — calls `orchestrator.abort()`
- Emit `agent:nodeStatus` events from the orchestrator to the renderer via `mainWindow.webContents.send`.

### 1.5 Update `src/main/preload.js` & `src/shared/electron.d.ts`

Expose:
```javascript
agentCancel: () => ipcRenderer.invoke('agent:cancel'),
onAgentNodeStatus: (callback) => ipcRenderer.on('agent:nodeStatus', (_, data) => callback(data)),
```

---

## Phase 2 — MCP Foundation

**Goal:** Users can configure remote MCP servers through the GUI, store credentials securely using `safeStorage`, and test connections.

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
  toolFilter?: string[];         // empty = all tools allowed
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
*Note: `safeStorage.encryptString` and `safeStorage.decryptString` are used to store encrypted blobs in `electron-store` under a separate `mcpCredentials` key.*

### 2.4 Create `src/main/mcp/MCPClientManager.ts`

Manages the pool of active MCP `Client` instances using `@modelcontextprotocol/sdk`.

**Key methods:**
- `connect(config: MCPServerConfig)`: Retrieves credential, constructs `SSEClientTransport` or `StreamableHTTPClientTransport`, and connects.
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

**Goal:** The `context_retrieval` node becomes active. Configured MCP servers are queried at inference time, and retrieved content is injected into the prompt.

**Estimated effort:** 4–5 days

### 3.0 Scope & Interaction Contract

**Critical design constraints — all remote MCP servers serve a single purpose:**

1. **RAG-only scope:** Remote MCP servers are used **exclusively** for generating content that populates the `<retrieved_context>` tag — i.e., retrieval-augmented generation (RAG) data that enriches the inference context. They are **not** used for tool-calling, agentic actions, file modifications, or any purpose other than providing supplementary context.

2. **User confirmation gate:** Before any inference request is sent to OpenRouter or Venice, the user **must always** be asked whether he/she wants RAG data retrieved from remote MCP servers for this inference run. This prompt appears every time the user initiates inference (it is never silently skipped). The dialog presents the list of currently-selected MCP servers (by label) and offers:
   - **Yes, retrieve RAG data** — proceeds with the `context_retrieval` node active.
   - **No, skip RAG** — proceeds with the `context_retrieval` node skipped (no MCP calls made; `<retrieved_context>` tag is omitted from the assembled prompt).

3. **Multi-selection persistence:** The user's latest multi-selection of which MCP servers to use for RAG must be persisted at rest and restored at app restart. Selections exist at two scopes:
   - **Global selection:** A set of MCP server IDs applicable when no folder-specific override exists. Stored under `mcpSelectionGlobal?: string[]` in the store schema.
   - **Project/folder-specific selection:** A per-folder override map stored within `FolderSpecificState` as `mcpSelectedServerIds?: string[]`. When a folder is opened, if a folder-specific selection exists it takes precedence; otherwise the global selection is used.
   - The confirmation dialog pre-checks the servers from the effective selection (folder-specific or global) so the user can quickly confirm or adjust. Any changes the user makes in the dialog are persisted back to the effective scope immediately.

### 3.1 Wire `MCPClientManager` into `AgentOrchestrator`

Pass `MCPClientManager` and `MCPServerRegistry` instances to the `AgentOrchestrator` constructor. The orchestrator also receives the effective list of selected MCP server IDs (resolved from folder-specific or global selection) and a boolean `ragRequested` flag from the renderer.

### 3.2 Implement `context_retrieval` Node

This node is **skipped entirely** when `state.ragRequested === false` (the user chose "No, skip RAG"). When active:

1. Retrieve only the servers whose IDs are in the effective selection AND are enabled in the registry.
2. Use `p-queue` to call `listTools` and identify a retrieval tool (e.g., matching `^(retrieve|search|query|find|lookup)/i`).
3. Execute the tool with `{ query: state.userPrompt, limit: 5 }`.
4. Aggregate results into `state.retrievedContext` wrapped in `<source server="..." tool="...">` tags.
5. Failures are caught and recorded in `mcpCallResults` without aborting inference.

### 3.3 Update `prompt_assembly` Node

When `state.retrievedContext` is non-empty (RAG was requested and returned data), inject it into the user prompt under a `<retrieved_context>` sub-tag, positioned after `<context>` and before `<referenced_files>`. When RAG was skipped or returned no data, the `<retrieved_context>` tag is omitted entirely.

### 3.4 Surface RAG Status in `InferenceTab.tsx`

Add a collapsible "Context Retrieval" panel that appears when `mcpCallResults` is present:
```text
▼ Context Retrieval  (2 sources)
  ✓  KnowledgeBase (retrieve) — 3 chunks
  ✗  SecondaryDB   — connection failed: timeout
```
When the user skipped RAG, the panel shows: `Context Retrieval — skipped by user`.

### 3.5 RAG Confirmation Dialog in `PromptOrganizerTab.tsx`

Create a `RagConfirmDialog` component that is shown **every time** the user clicks the Start Inference button (before any API call is dispatched). The dialog:

1. Loads the effective MCP server selection:
   - If `mcp:getFolderSelection(rootFolder)` returns a non-null array, use it (folder-specific override).
   - Otherwise use `mcp:getGlobalSelection()`.
2. Displays a multi-select checklist of all configured MCP servers (label + URL), pre-checking the servers from the effective selection.
3. Shows the message: `Do you want to retrieve RAG data from remote MCP servers for this inference?`
4. Provides two primary actions:
   - **Yes, retrieve RAG data** — persists the current checklist selection back to the effective scope (folder-specific if an override existed, otherwise global) via `mcp:saveFolderSelection` or `mcp:saveGlobalSelection`, sets `ragRequested = true`, passes the selected server IDs to the agent payload, and proceeds with inference.
   - **No, skip RAG** — sets `ragRequested = false`, still persists the current checklist selection (so the user's latest multi-selection is saved at rest), and proceeds with inference with the `context_retrieval` node skipped.
5. A **Cancel** button aborts the inference attempt entirely (no API call is made).

The persisted selection is restored at app restart because it is stored in `electron-store` under `mcpSelectionGlobal` (global) or within `folderStates[folderPath].mcpSelectedServerIds` (per-folder).

### 3.6 Pass `ragRequested` and Selected Server IDs Through the Agent Payload

Update the `openRouter:call` IPC payload (or the new `agent:run` payload) to include:
```typescript
{
  // ... existing fields ...
  ragRequested: boolean;
  mcpSelectedServerIds: string[];  // effective selection at inference time
}
```
The `AgentOrchestrator` reads these fields to decide whether to execute the `context_retrieval` node and which servers to query.

---

## Phase 4 — Agent Memory

**Goal:** Optional per-folder session memory that injects a rolling conversation summary into each inference. Off by default.

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

Handles reading and updating memory. `updateMemory` fires-and-forgets a background LLM call to summarize the previous summary + latest exchange.

### 4.3 Implement `memory_injection` Node

If `agentSettings.memoryEnabled` is true, load the memory entry for the current `rootFolder`. Inject it into the system prompt as:
```text
<session_memory>
{memoryContext}
</session_memory>
```

### 4.4 Implement `result_postprocess` Node

If memory is enabled and inference was successful, trigger the background `updateMemory` call. Return the final state to the renderer immediately without waiting for the memory update.

### 4.5 Memory UI in `McpSettingsTab.tsx`

Add a "Session Memory" section:
- Toggle: Enable Memory (default Off)
- Max Summary Tokens input
- Current Folder Memory stats (Exchanges, Last updated, Tokens)
- "View Summary" and "Clear Folder Memory" buttons.

---

## Phase 5 — Polish & Extensibility

**Goal:** Production-quality UX, observable agent execution, and a documented extension pattern.

**Estimated effort:** 3–4 days

### 5.1 Node Status Streaming in `InferenceTab.tsx`

Replace the binary running/done state with per-node progress driven by `onAgentNodeStatus`:
```text
● Running inference…

  ✓  Context Retrieval   (2 sources, 340ms)
  ✓  Memory Injection    (skipped — memory disabled)
  ✓  Prompt Assembly     (12,450 tokens)
  ↻  Inference           running…
  ○  Post-processing     pending
```

### 5.2 MCP Tool Filter UI Enhancement

In `McpSettingsTab.tsx`, add a "Browse Available Tools" expansion on each server card (visible after a successful test). Allow toggling tools via checkboxes instead of comma-separated text.

### 5.3 Node Extension Documentation

Create `src/main/agent/NODES.md` documenting the interface contract for adding new nodes to the custom `AgentOrchestrator` loop, ensuring future extensibility without renderer changes.
