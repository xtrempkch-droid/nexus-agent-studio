/**
 * End-to-end smoke test for the headless MCP core.
 *
 * Why this file exists: `npm run test` covers the tool *registry* in isolation,
 * but nothing exercised `InternalMCPServer.build()` or `serveStdio()` — the
 * boundary with the MCP v2 SDK. A passing typecheck only proves the types line
 * up, not that the SDK accepts our Zod schemas and serves them at runtime. This
 * script spawns the real built entry point (`dist/core.mjs`) and drives it with
 * a real client over stdio, which per the SDK docs is the only path stdio has
 * ("Stdio has no in-process shortcut").
 *
 * Run after a build:
 *
 * ```bash
 * npm run build && npm run smoke
 * ```
 *
 * The client API used here is verified against the official v2 documentation
 * (ts.sdk.modelcontextprotocol.io), not assumed:
 * - `new Client({ name, version })` + `client.connect(transport)`
 * - `StdioClientTransport({ command, args, cwd })` from the `/stdio` subpath
 * - `listTools()` -> `{ tools }`, `callTool({ name, arguments })`
 * - a failed call resolves as a result with `isError: true`; it does not throw
 *
 * @module scripts/smoke-mcp
 */

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

/** Tools the core must advertise, sorted to make the comparison order-independent. */
const EXPECTED_TOOLS: readonly string[] = [
  'get_editor_context',
  'list_directory',
  'list_models',
  'read_file',
  'run_terminal_command',
  'write_file',
];

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const client = new Client({ name: 'nexus-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/core.mjs'],
    cwd: process.cwd(),
  });

  await client.connect(transport);
  console.error('[smoke] connected over stdio');

  try {
    const serverVersion = client.getServerVersion();
    assert(serverVersion !== undefined, 'client reported no server version after connect');
    assert(
      serverVersion.name === 'nexus-agent-studio',
      `unexpected server name: ${JSON.stringify(serverVersion)}`,
    );
    console.error(`[smoke] server ${serverVersion.name}@${serverVersion.version}`);

    // 1. `tools/list` goes through the SDK, which converts each registered Zod
    //    schema into the JSON Schema it advertises. If that conversion failed,
    //    this call is where it shows up.
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    console.error(`[smoke] tools advertised: ${names.join(', ')}`);
    assert(
      names.join(',') === EXPECTED_TOOLS.join(','),
      `tool list mismatch. expected=[${EXPECTED_TOOLS.join(', ')}] got=[${names.join(', ')}]`,
    );

    // 2. Happy path: read a file that must exist.
    const read = await client.callTool({
      name: 'read_file',
      arguments: { path: 'package.json' },
    });
    assert(read.isError !== true, 'read_file(package.json) reported isError');
    const serialized = JSON.stringify(read);
    assert(
      serialized.includes('nexus-agent-studio'),
      `read_file did not return the manifest content; head: ${serialized.slice(0, 200)}`,
    );
    console.error('[smoke] read_file(package.json) ok');

    // 3. Schema enforcement: omitting a required argument must be rejected by
    //    the SDK *before* the handler runs, as a result rather than a throw.
    //    This is the runtime proof that the Zod schema is actually wired up.
    const invalid = await client.callTool({ name: 'read_file', arguments: {} });
    assert(invalid.isError === true, 'read_file accepted a call missing the required "path"');
    console.error('[smoke] invalid arguments rejected by the input schema');

    // 4. Security boundary: traversal must be refused, and refused as a result
    //    so the server stays alive instead of crashing the connection.
    const traversal = await client.callTool({
      name: 'read_file',
      arguments: { path: '../../../etc/passwd' },
    });
    assert(traversal.isError === true, 'path traversal was NOT rejected');
    console.error('[smoke] path traversal rejected');

    // 5. The server must still answer after the two rejected calls.
    const { tools: afterFailures } = await client.listTools();
    assert(afterFailures.length === EXPECTED_TOOLS.length, 'server degraded after rejected calls');
    console.error('[smoke] server still healthy after rejected calls');
  } finally {
    await client.close();
  }

  console.error('[smoke] all assertions passed');
}

/**
 * Guards CI against a handshake that never completes: a broken stdio handshake
 * would otherwise hang until the job hits its own timeout, hiding the cause.
 */
const WATCHDOG_MS = 30_000;
const watchdog = setTimeout(() => {
  console.error(`[smoke] FAILED: no completion within ${WATCHDOG_MS} ms (handshake hung?)`);
  process.exit(1);
}, WATCHDOG_MS);
// `unref` stops the timer from holding the event loop open once main resolves.
watchdog.unref();

main()
  .then(() => {
    clearTimeout(watchdog);
  })
  .catch((error: unknown) => {
    clearTimeout(watchdog);
    console.error('[smoke] FAILED:', error);
    process.exitCode = 1;
  });
