# Project-level MCP configuration

The local Runtime reads `.mcp.json` from the main working directory of the current session. The
Desktop, the interactive Alran TUI, `alran exec`, `alran acp` and every CLI that uses the same
Runtime share this capability. Nothing has to be imported, and there is no MCP-specific approval or
configuration-summary authorization.

```json
{
  "mcpServers": {
    "repo-tools": {
      "command": "node",
      "args": ["./tools/mcp-server.js"],
      "env": { "API_TOKEN": "${REPO_API_TOKEN}" }
    },
    "docs": {
      "type": "http",
      "url": "${DOCS_MCP_URL:-https://example.com/mcp}",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" }
    }
  }
}
```

## Automatic loading and connecting

- The Runtime reads the configuration from the canonical `workspaceDir` of the session. The project
  file is not skipped because the client type differs, and the project path does not depend on the
  cwd that the Runtime process was started in.
- Reading the configuration or showing the list does not start an MCP. When the tools are actually
  discovered or called in a turn, the Runtime connects the servers that are valid and not disabled.
- A stdio connection executes the command from the project configuration, and a remote connection
  visits the configured URL. This is the product agreement of the automatic loading of the project
  configuration. Tool calls still follow the existing permission policy, but the tool permission
  confirmation happens after the connection and does not replace the control over the process start.
- The configuration is read again before the tool discovery and the tool call. When the file content
  or the expanded environment variables change, the old project calls are aborted and the old
  connections are closed; the following requests use the new configuration automatically and no
  approval window is shown again.
- An entry can be disabled with `enabled: false` in `.mcp.json`. When the file is deleted or the
  whole file is invalid, remove the project layer and restore the profile configuration of the same
  name.
- The file is only ever read. Nothing is imported into or written back to the profile `mcp.json`,
  and the project configuration authorization is not persisted.

## Project boundary and format

- Only the `.mcp.json` of the main working directory is read. There is no upward search and no scan
  of `/add-dir`. When the Runtime is started in a subdirectory and the main directory of the
  session is that subdirectory, only the file inside the subdirectory is read.
- `stdio`, `http`, `streamable-http` and `sse` are supported; an unsupported transport shows an
  error.
- `command`, `args`, `env`, `url` and `headers` support `${VAR}` and `${VAR:-default}`. When a
  variable is missing, that server is disabled and the name of the variable is shown; the value of
  the variable is never echoed.
- A positive integer `timeout` in milliseconds is supported. Runtime-internal fields (builtin,
  tools, metadata and the like) are not loaded from the project file.
- The stdio cwd and the MCP `roots/list` both use the canonical main project directory. A remote
  MCP receives that root as well; HTTP credentials must not be carried across a redirect to another
  origin.
- The file is at most 1 MiB and has to be a regular file inside the project; a symlink to a file
  inside the project is allowed. Broken JSON, a failed read or a name normalization conflict
  invalidates the whole file; an error in a single server does not stop the other valid servers.
  When the project directory has been deleted, the profile and the builtin servers stay usable.

## Rules for the same name and the state

A regular configuration with the same name is replaced as a whole along the order
**ACP session > project > profile**; the URL, command, env and headers are never merged across
sources. A disabled or broken project entry still shadows the profile entry of the same name, so
another target is not connected silently; a kept builtin name cannot be overridden by the project
configuration. Plugins are still managed independently by the plugin Runtime.

The configuration, the connections and the error state are isolated per session, canonical project
directory and configuration version; clearing the configuration that an ACP client injected does not
clear the configuration of the project file. Deleting a session cleans up the project and the client
connections through the common Runtime lifecycle.

- TUI `/mcp`: shows the Built-in, User-configured, Project and Client session configuration and the
  state of the current session.
- TUI `/mcp reload`: reads it again and shows it; `/mcp <filter>` filters by the server name. There
  are no `approve` / `deny` actions; they work as ordinary filter words.
- ACP `/mcp <filter>`: lists the valid configuration of the current ACP session.
- The inspection interface never echoes args, env, headers or URL query parameters. The global MCP
  administration keeps working on the profile file; a change to the project file is made directly in
  the project.

After a successful connection the state is `available`; when not connected it is `configured`; when
disabled or invalid it is `disabled` / `error`. There is no `pending_approval` state.
