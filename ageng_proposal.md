

# Feasibility Report: Agentic Architecture & Remote MCP Integration for Seeker UI

## 1. Executive Summary

This report explores the feasibility of transforming Seeker UI's current single-shot inference workflow into an agentic architecture with remote MCP (Model Context Protocol) server integration. The proposed changes are scoped strictly to the Electron desktop application, with all MCP servers being remote (no local sub-processing). The assessment concludes that the transformation is feasible with moderate architectural changes, primarily in the main process, with minimal disruption to the existing renderer UI.

---

## 2. Current Architecture Analysis

### 2.1 Inference Workflow (As-Is)

The current inference flow is a **single-shot, synchronous-style pipeline**:

1. **Prompt Assembly** (`PromptOrganizerTab.tsx`): The user constructs a prompt from four components—system prompt, task description, inference context, and referenced file contents. Redaction and custom masking are applied optionally. The assembled prompt is sent via IPC to the main process.

2. **API Dispatch** (`main.ts`, `openRouter:call` handler): The main process dispatches to either `callOpenRouter()` or `callVenice()` based on the `apiTarget` setting. Both functions are pure HTTP POST calls to OpenAI-compatible chat completion endpoints. There is no tool-calling, no multi-turn loop, and no intermediate reasoning step.

3. **Result Handling** (`InferenceTab.tsx`): The renderer receives the response text, parses it for fenced JSON block-replacement items, and optionally applies those blocks to files via `applyBlockReplacements()`.

**Key limitation**: The LLM has no ability to request additional information mid-inference. It cannot ask to read a file it wasn't given, query a knowledge base, or perform multi-step reasoning with intermediate tool calls. The entire context must be provided upfront.

### 2.2 State Management

- **Per-folder state** (`FolderSpecificState`): system prompt, task, inference context, model settings, inference results—all keyed by absolute folder path.
- **Global state**: API keys, model lists, default system prompt, window bounds, preview settings.
- **Persistence**: `electron-store` with JSON serialization to `app-settings.json`.

### 2.3 IPC Boundary

The preload script (`preload.js`) exposes a flat API surface via `contextBridge`. All main-process operations are invoked through `ipcRenderer.invoke()`. The renderer has no direct Node.js access.

---

## 3. Proposed Agentic Architecture

### 3.1 Core Design Principles

1. **Agent Engine in Main Process**: All agentic orchestration runs in the Electron main process. The renderer remains a pure UI layer that sends high-level commands and receives status updates via IPC events.

2. **Tool-Based Architecture**: The agent operates through a defined set of tools. Each tool is a typed function with input validation (Zod schema). The LLM can request tool calls; the engine executes them and feeds results back.

3. **Sequential Execution with Future Multi-Node Support**: The initial implementation uses a single-agent sequential loop. The architecture is designed so that multiple agent nodes can be composed later (e.g., a planner agent → executor agent → reviewer agent), with forced sequential ordering.

4. **No Local Sub-Processing for MCP**: All MCP servers are remote. The app acts as an MCP *client* connecting to remote servers over HTTP/SSE. No `stdio` transport, no spawning local processes.

5. **Memory Optional, Off by Default**: Agent memory (conversation history across sessions, learned preferences) is a configurable feature, disabled by default. When disabled, each inference run is stateless with respect to prior runs.

### 3.2 Architectural Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Prompt       │  │ Agent        │  │ MCP Server       │   │
│  │ Organizer    │  │ Monitor      │  │ Config Panel     │   │
│  │ (existing)   │  │ (new tab/    │  │ (Settings tab    │   │
│  │              │  │  panel)      │  │  extension)      │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                 │                    │             │
│         ▼                 ▼                    ▼             │
│   ┌─────────────────────────────────────────────────┐       │
│   │              IPC Bridge (preload.js)              │       │
│   └─────────────────────┬───────────────────────────┘       │
└─────────────────────────┼───────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                     Main Process                             │
│                         │                                     │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │              Agent Engine (new)                      │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │    │
│  │  │ Planner  │→ │ Executor │→ │ Synthesizer      │  │    │
│  │  │ (step 1) │  │ (loop)   │  │ (final output)   │  │    │
│  │  └──────────┘  └────┬─────┘  └──────────────────┘  │    │
│  │                     │                                 │    │
│  │  ┌──────────────────▼──────────────────────────┐   │    │
│  │  │           Tool Registry                      │   │    │
│  │  │  ┌─────────┐ ┌─────────┐ ┌────────────────┐ │   │    │
│  │  │  │readFile │ │writeFile│ │queryMcpServer  │ │   │    │
│  │  │  └─────────┘ └─────────┘ └──────┬───────────┘ │   │    │
│  │  └───────────────────────────────┼─────────────┘   │    │
│  └──────────────────────────────────┼──────────────────┘    │
│                                      │                       │
│  ┌───────────────────────────────────▼──────────────────┐   │
│  │           MCP Client Manager (new)                    │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐     │   │
│  │  │ MCP Server │  │ MCP Server │  │ MCP Server │     │   │
│  │  │   Conn A   │  │   Conn B   │  │   Conn C   │     │   │
│  │  └────────────┘  └────────────┘  └────────────┘     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ Inference        │  │ Memory Store     │                │
│  │ Providers        │  │ (optional,       │                │
│  │ (existing OR/Ven)│  │  off by default) │                │
│  └──────────────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Agent Execution Loop

The core agentic loop replaces the current single-shot `callOpenRouter`/`callVenice` dispatch:

```
1. PREPARE: Assemble system prompt + task + context + referenced files (existing logic)
2. RAG FETCH (if MCP servers enabled): Query selected MCP servers with task description
   → Inject retrieved context into the prompt as additional <context> blocks
3. AGENT LOOP:
   a. Send prompt to LLM (OpenRouter or Venice) with tool definitions
   b. Parse response:
      - If text content → accumulate as partial result
      - If tool calls → execute each tool sequentially, collect results
   c. If tool calls were made → append tool results to conversation, go to (a)
   d. If no tool calls (or max iterations reached) → exit loop
4. SYNTHESIZE: Combine accumulated text + reasoning into final result
5. RETURN: Send final result + execution trace to renderer
```

### 3.4 Tool Registry

Tools are the bridge between the LLM and the application's capabilities. Each tool is defined with:
- A name and description (exposed to the LLM)
- A Zod input schema
- An async executor function in the main process

**Initial tool set:**

| Tool | Purpose | Scope |
|------|---------|-------|
| `read_file` | Read a file within the project root | Local (already exists as IPC) |
| `write_file` | Write/modify a file within the project root | Local (already exists as IPC) |
| `list_directory` | List files in a directory | Local (already exists as IPC) |
| `query_mcp_server` | Query a configured remote MCP server | Remote (new) |
| `search_context` | RAG query to MCP servers for relevant context | Remote (new, wrapper over query_mcp_server) |

Tools are strictly scoped: file operations are confined to the currently opened project root. MCP queries are confined to user-configured remote servers.

### 3.5 Multi-Node & Forced Sequential Execution

The architecture supports future multi-node execution through a **DAG (Directed Acyclic Graph) execution plan**:

- **Phase 1 (Current)**: Single agent node, sequential tool execution within the node.
- **Phase 2 (Future)**: Multiple agent nodes defined in an execution plan. Each node has its own system prompt, tool access, and model configuration. The DAG defines dependencies (node B waits for node A). Forced sequential execution is the default; parallel execution is opt-in per edge.

The `AgentEngine` class is designed with this in mind:
- The engine accepts an `ExecutionPlan` (currently a single-node plan).
- Each node in the plan has: `id`, `systemPrompt`, `allowedTools`, `model`, `maxIterations`.
- The engine processes nodes in topological order.
- Node outputs can be referenced by downstream nodes via `${nodeId.output}` template syntax.

---

## 4. Remote MCP Server Integration

### 4.1 MCP Protocol Overview

The Model Context Protocol (MCP) is an open standard for connecting AI applications to external data sources and tools. An MCP server exposes:
- **Resources**: Static or dynamic data (files, database records, documentation)
- **Tools**: Callable functions with typed inputs
- **Prompts**: Pre-defined prompt templates

For Seeker UI's initial use case (RAG data injection), the primary interaction is:
1. Connect to a remote MCP server
2. Call a search/query tool with the user's task description
3. Receive relevant context/documents
4. Inject that context into the inference prompt

### 4.2 Connection Types

Since all MCP servers are remote (no local sub-processing), the supported transports are:

| Transport | Use Case | Implementation |
|-----------|----------|----------------|
| **Streamable HTTP** | Modern MCP servers (2025 spec) | `@modelcontextprotocol/sdk` Client with `StreamableHTTPTransport` |
| **SSE (Server-Sent Events)** | Legacy/compatible servers | `@modelcontextprotocol/sdk` Client with `SSEClientTransport` |

Both are HTTP-based and require no local process spawning. The `stdio` transport is explicitly excluded.

### 4.3 Configuration Model (GUI-First, Better than Claude Code)

Claude Code uses a `.mcp.json` file for MCP server configuration. Seeker UI, being a GUI application, provides a **richer configuration experience**:

**Per-server configuration fields:**

```typescript
interface McpServerConfig {
  id: string;                    // UUID
  name: string;                  // User-friendly display name
  url: string;                   // Remote server URL (https://...)
  transport: 'streamable-http' | 'sse';
  auth: McpAuthConfig;           // Authentication configuration
  enabled: boolean;              // Toggle on/off
  scope: 'global' | 'folder';    // Available globally or per-project
  tools: McpToolFilter;          // Whitelist/blacklist of exposed tools
  timeout: number;               // Connection/query timeout in ms
  description?: string;           // User notes
}

interface McpAuthConfig {
  type: 'none' | 'bearer' | 'api-key' | 'oauth2';
  // For 'bearer' and 'api-key':
  token?: string;                // Stored encrypted in electron-store
  headerName?: string;           // Default: 'Authorization' or 'X-API-Key'
  // For 'oauth2':
  oauth?: {
    authorizeUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
    // Token is obtained via browser redirect flow
    // Refresh token stored encrypted
  };
}

interface McpToolFilter {
  mode: 'all' | 'whitelist' | 'blacklist';
  tools?: string[];              // Tool names to include/exclude
}
```

**Configuration UI** (added to Settings tab):
- A dedicated "MCP Servers" section with a list of configured servers
- Add/Edit/Delete/Enable-Disable per server
- "Test Connection" button that pings the server and lists available tools
- Per-folder override: when a folder is open, the user can enable additional MCP servers specific to that project
- OAuth2 flow: opens a browser window via `shell.openExternal`, captures the redirect callback via a local HTTP server or custom protocol handler

### 4.4 Authentication Management for Multiple MCP Servers

Each MCP server has independent authentication. The approach:

1. **Credential Storage**: Credentials are stored in `electron-store` with encryption (using `electron-store`'s `encryptionKey` option or a separate `safeStorage` API from Electron). Each server's credentials are keyed by server ID.

2. **Auth Types**:
   - **None**: No authentication required (public MCP servers).
   - **Bearer Token**: A static token sent in the `Authorization: Bearer <token>` header. User pastes the token in the config UI.
   - **API Key**: A key sent in a custom header (e.g., `X-API-Key: <key>`). Configurable header name.
   - **OAuth 2.0**: Full OAuth flow. The app opens the authorization URL in the system browser, runs a temporary local HTTP server to capture the redirect, exchanges the code for tokens, and stores the access + refresh tokens. Token refresh is handled automatically by the MCP Client Manager.

3. **Connection Pooling**: The MCP Client Manager maintains a pool of active connections. Connections are lazily established on first use and kept alive. If a connection fails, it is retried with exponential backoff. If authentication fails (401), the user is notified via the UI to re-authenticate.

4. **Per-Folder vs. Global**: Servers can be marked as `global` (always available) or `folder` (only active when a specific project is open). This prevents irrelevant MCP servers from being exposed to the agent.

### 4.5 RAG Integration Flow

The initial RAG use case works as follows:

```
User writes task: "Explore feasibility of adding WebSocket support to the auth module"
User has selected 3 source files in the Explorer.
User has enabled an MCP server "internal-docs" (remote, RAG-enabled).

1. Agent Engine PREPARE phase:
   - Assembles system prompt + task + selected file contents (existing logic)

2. Agent Engine RAG FETCH phase (new):
   - Calls MCP Client Manager: queryMcpServer("internal-docs", {
       tool: "search",
       args: { query: "WebSocket support auth module feasibility" }
     })
   - Receives: [{ title: "Auth Architecture v3", content: "...", score: 0.92 }, ...]
   - Injects into prompt:
     <retrieved_context source="internal-docs">
       <document title="Auth Architecture v3" score="0.92">
         ...content...
       </document>
     </retrieved_context>

3. Agent Engine continues with LLM call (existing inference providers)
4. The LLM now has both the source code AND relevant documentation
```

---

## 5. NPM Libraries

### 5.1 Required New Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | `^1.0.0` | Official MCP SDK for TypeScript. Provides `Client`, `StreamableHTTPTransport`, `SSEClientTransport`, and type definitions for MCP protocol messages. This is the industry-standard library for MCP integration. |
| `zod` | `^3.23.0` | Schema validation for tool inputs and MCP protocol messages. The MCP SDK uses Zod internally. Also used for agent tool definitions. Already a transitive dependency of MCP SDK but should be explicit. |
| `electron-store` | (existing) | Already used for settings persistence. Will be extended with MCP server configs and agent settings. May need `encryptionKey` for credential storage. |

### 5.2 Optional / Future Dependencies

| Library | Purpose | Justification |
|---------|---------|---------------|
| `langchain` / `langchain.js` | Agent orchestration framework | **Not recommended for initial implementation.** Seeker UI's agent loop is simple enough to implement directly. LangChain adds significant bundle size and complexity. The custom agent loop keeps the app lightweight and maintainable. |
| `ai` (Vercel AI SDK) | Streaming + tool-calling abstractions | **Not recommended initially.** Could be considered if streaming token-by-token output is desired in the future. For now, the existing non-streaming approach via OpenRouter/Venice is sufficient. |
| `@anthropic-ai/sdk` | Direct Anthropic API access | **Not needed.** OpenRouter already provides access to Claude models. Adding a direct SDK would duplicate provider management. |

### 5.3 Why These Libraries Make the App "Mainstream"

The `@modelcontextprotocol/sdk` is the **official, canonical library** maintained by Anthropic for MCP. It is used by Claude Code, Cursor, and other production agentic applications. By adopting it, Seeker UI:

1. Follows the exact same protocol and wire format as industry-standard agentic tools
2. Can connect to any MCP-compatible server (including those built for Claude Code)
3. Benefits from the MCP ecosystem's growing catalog of pre-built servers
4. Stays compatible with future MCP protocol versions via SDK updates

The custom agent loop (rather than LangChain) is actually the **more mainstream approach** for production agentic apps. Claude Code, Cursor, and Aider all implement custom agent loops rather than depending on a heavy framework. This gives fine-grained control over tool execution, error handling, and the sequential execution guarantee.

---

## 6. Agent Memory: Optional, Off by Default

### 6.1 Design

```typescript
interface AgentSettings {
  memory: {
    enabled: boolean;       // Default: false
    maxHistoryEntries: number;  // Default: 50
    persistenceScope: 'folder' | 'global';  // Default: 'folder'
  };
  maxIterations: number;    // Default: 10
  requireApproval: boolean; // Default: true (user approves tool calls before execution)
}
```

### 6.2 Memory Behavior

- **When disabled (default)**: Each inference run is entirely stateless. No conversation history, no learned preferences. The agent starts fresh every time. This matches the current behavior exactly—no regression for existing users.

- **When enabled**: The agent stores a summary of each completed inference run (task description, tools used, outcome). On the next run, relevant past entries are injected into the system prompt as `<agent_memory>` context. This helps the agent avoid repeating mistakes and build on prior conclusions within a project.

- **Memory is NOT used for**: Storing user prompts, file contents, or MCP server data. It is purely a lightweight execution log for the agent's own use.

### 6.3 User Control

- A checkbox in Settings: "Enable Agent Memory" (unchecked by default)
- A "Clear Memory" button to wipe stored entries
- Memory entries are stored per-folder (when `persistenceScope = 'folder'`) or globally
- No telemetry, no cloud sync—memory is purely local

---

## 7. Scope: Desktop-Only, Remote MCP Only

### 7.1 Enforcement

The architecture is strictly scoped:

1. **No local MCP server spawning**: The MCP Client Manager only supports `streamable-http` and `sse` transports. The `stdio` transport (which requires spawning a child process) is not imported or available. This is enforced at the code level by only importing the HTTP-based transport classes from `@modelcontextprotocol/sdk`.

2. **No local agent execution environment**: The agent runs entirely within the Electron main process. It does not spawn workers, child processes, or containers. Tool execution is in-process function calls.

3. **File access confinement**: The `read_file` and `write_file` tools are restricted to paths within the currently opened project root. Path traversal is prevented by resolving and validating against the root folder.

4. **MCP server URLs**: Only `https://` and `http://` URLs are accepted for MCP server configuration. The URL is validated at configuration time.

---

## 8. Implementation Plan

### Phase 1: Foundation (Agent Engine + Tool Registry)

**Scope**: Refactor the inference dispatch to support an agent loop with tools, without MCP.

**Changes**:

1. **New file: `src/main/agent/engine.ts`**
   - `AgentEngine` class with `execute(plan: ExecutionPlan, signal: AbortSignal)` method
   - Manages the LLM call → tool call → feed-back loop
   - Supports max iterations, abort, and status reporting via IPC events
   - Uses existing `callOpenRouter`/`callVenice` for LLM calls, extended with tool definitions in the request body

2. **New file: `src/main/agent/tools.ts`**
   - Tool registry with `registerTool(name, schema, executor)` and `getToolDefinitions()` methods
   - Built-in tools: `read_file`, `write_file`, `list_directory` (wrapping existing IPC handlers)
   - Each tool returns `{ success: boolean, content: string, error?: string }`

3. **Modify: `src/main/main.ts`**
   - Replace `openRouter:call` handler with `agent:execute` handler
   - Add `agent:cancel` handler (replaces `openRouter:cancel`)
   - Add IPC events: `agent:status` (running/thinking/tool-executing/done), `agent:toolCall` (for UI display), `agent:iteration` (progress)

4. **Modify: `src/main/preload.js`**
   - Add `agentExecute`, `agentCancel`, `onAgentStatus`, `onAgentToolCall` to the exposed API

5. **Modify: `src/renderer/components/tabs/PromptOrganizerTab.tsx`**
   - Replace `callOpenRouter` with `agentExecute`
   - Listen to `onAgentStatus` for real-time progress display
   - The existing prompt assembly logic is preserved as the "PREPARE" phase input

6. **Modify: `src/renderer/components/tabs/InferenceTab.tsx`**
   - Display agent execution trace (tool calls, iterations) alongside the final result
   - Show "Agent is thinking..." / "Executing tool: read_file..." status messages

**Estimated effort**: 3-5 days

### Phase 2: MCP Client Integration

**Scope**: Add MCP server configuration, connection management, and RAG context injection.

**Changes**:

1. **Install dependencies**: `@modelcontextprotocol/sdk`, `zod`

2. **New file: `src/main/mcp/client-manager.ts`**
   - `McpClientManager` class
   - `connect(serverConfig: McpServerConfig): Promise<void>`
   - `disconnect(serverId: string): void`
   - `listTools(serverId: string): Promise<McpTool[]>`
   - `callTool(serverId: string, toolName: string, args: unknown): Promise<McpToolResult>`
   - Connection pooling, retry logic, timeout handling
   - Uses `StreamableHTTPTransport` or `SSEClientTransport` from MCP SDK

3. **New file: `src/main/mcp/auth.ts`**
   - Authentication helpers per auth type
   - OAuth2 flow: `startOAuthFlow(config) → opens browser → captures callback → exchanges tokens`
   - Token storage and refresh logic
   - Uses Electron's `safeStorage` for credential encryption

4. **Modify: `src/main/main.ts`**
   - Add IPC handlers: `mcp:listServers`, `mcp:addServer`, `mcp:updateServer`, `mcp:deleteServer`, `mcp:testConnection`, `mcp:callTool`, `mcp:startOAuth`
   - Initialize `McpClientManager` on app startup
   - Load server configs from `electron-store`

5. **Modify: `src/main/agent/tools.ts`**
   - Add `query_mcp_server` and `search_context` tools
   - These tools call `McpClientManager.callTool()` under the hood
   - `search_context` is a higher-level tool that queries all enabled MCP servers and aggregates results

6. **Modify: `src/main/agent/engine.ts`**
   - Add RAG FETCH phase before the agent loop
   - If MCP servers are enabled, call `search_context` with the task description
   - Inject retrieved context into the prompt

7. **Modify: `src/shared/electron.d.ts`**
   - Add MCP-related type definitions and IPC method signatures

8. **Modify: `src/renderer/components/tabs/SettingsTab.tsx`**
   - Add "MCP Servers" section
   - Server list with add/edit/delete/enable-disable
   - Connection test button
   - OAuth2 authorization button (opens browser)

9. **Modify: `src/main/preload.js`**
   - Expose MCP IPC methods

**Estimated effort**: 5-8 days

### Phase 3: Agent Monitor UI & Memory

**Scope**: Add an agent execution monitor panel and optional memory.

**Changes**:

1. **New component: `src/renderer/components/tabs/AgentMonitorTab.tsx`** (or integrate into InferenceTab)
   - Real-time display of agent execution: current iteration, tool calls, tool results, intermediate reasoning
   - Timeline view of the execution trace
   - "Approve Tool Call" prompt when `requireApproval` is enabled

2. **Modify: `src/main/agent/engine.ts`**
   - Add memory integration (read/write from `electron-store`)
   - Memory is only active when `agentSettings.memory.enabled === true`

3. **Modify: `src/main/main.ts`**
   - Add `agent:getSettings`, `agent:saveSettings` IPC handlers
   - Add `agent:clearMemory`, `agent:approveToolCall` IPC handlers

4. **Modify: `src/renderer/components/tabs/SettingsTab.tsx`**
   - Add "Agent Settings" section: memory toggle, max iterations, require approval

**Estimated effort**: 3-5 days

### Phase 4: Multi-Node Execution (Future)

**Scope**: Enable composing multiple agent nodes in a DAG.

**Changes** (design-level, not implemented in initial release):

1. `ExecutionPlan` type with multiple nodes and edges
2. A visual plan editor in the UI (drag-and-drop node graph)
3. Engine processes nodes in topological order
4. Output templating: `${nodeId.output}` references in downstream node prompts

**Estimated effort**: 1-2 weeks (future milestone)

---

## 9. Risk Assessment & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MCP SDK breaking changes | Medium | Pin SDK version; add integration tests for MCP protocol compliance |
| Agent loop infinite cycles | High | Hard `maxIterations` limit (default 10); abort signal propagation |
| Unintended file writes by agent | High | `requireApproval` flag (default true); path confinement to project root; tool execution logging |
| MCP server credential leakage | High | `electron-store` encryption or `safeStorage` API; no credentials in logs; no credentials sent to LLM |
| Increased bundle size from MCP SDK | Low | MCP SDK is modular (~50KB gzipped for client only); tree-shake unused transports |
| Backward compatibility with existing users | Medium | Agent engine is a superset of current behavior; when no tools are enabled and no MCP servers are configured, behavior is identical to current single-shot inference |
| OAuth2 callback capture in desktop app | Medium | Use Electron's `app.setAsDefaultProtocolClient()` with a custom protocol (e.g., `seeker-ui://oauth/callback`) or a temporary local HTTP server on a random port |

---

## 10. Conclusion

The proposed transformation is **feasible** with moderate effort. The key architectural decisions are:

1. **Custom agent loop in the main process** (not a heavy framework like LangChain)—this matches the approach used by Claude Code, Cursor, and other production agentic tools.
2. **Official `@modelcontextprotocol/sdk`** for MCP integration—industry standard, connects to the same ecosystem as Claude Code.
3. **GUI-first MCP configuration** with per-server authentication, per-folder scoping, and connection testing—superior to Claude Code's file-based config.
4. **Memory off by default**—zero regression for existing users; opt-in for power users.
5. **Remote MCP only**—no local sub-processing, enforced at the transport layer.

The implementation can proceed in phases: the agent engine (Phase 1) delivers immediate value by enabling tool-calling in the inference loop; MCP integration (Phase 2) adds RAG capabilities; the monitor and memory features (Phase 3) complete the agentic experience. Each phase is independently shippable.

---
