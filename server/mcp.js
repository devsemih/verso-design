// MCP server setup. The same tool list is exposed over stdio (`verso mcp`)
// and Streamable HTTP (http://localhost:<port>/mcp). `execute` decides where
// a call runs: in this process, or forwarded to an already running Verso.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { TOOLS } = require('./tools')
const { INSTRUCTIONS } = require('./guide')
const { version } = require('../package.json')

function buildMcpServer(execute) {
  const server = new McpServer(
    { name: 'verso', title: 'Verso', version },
    { instructions: INSTRUCTIONS },
  )
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.input,
        annotations: {
          title: t.title,
          readOnlyHint: !!t.readOnly,
          destructiveHint: !!t.destructive,
          openWorldHint: t.name === 'search_images',
        },
      },
      async (args) => execute(t.name, args || {}),
    )
  }
  return server
}

// Stateless Streamable HTTP: a fresh server + transport per request.
async function handleMcpHttp(req, res, body, execute) {
  const server = buildMcpServer(execute)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    transport.close().catch(() => {})
    server.close().catch(() => {})
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}

module.exports = { buildMcpServer, handleMcpHttp }
