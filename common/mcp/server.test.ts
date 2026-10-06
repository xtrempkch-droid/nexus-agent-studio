import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { CORE_PLUGIN_ID, InternalMCPServer } from './server.ts';
import { textResult } from './types.ts';

function createServer(): InternalMCPServer {
  return new InternalMCPServer({ name: 'test-server', version: '9.9.9' });
}

const pingDefinition = {
  name: 'ping',
  description: 'Replies with pong.',
  inputSchema: z.object({}),
};

describe('InternalMCPServer registry', () => {
  it('starts empty', () => {
    const server = createServer();
    expect(server.getToolNames()).toEqual([]);
    expect(server.size).toBe(0);
  });

  it('registers a built-in tool', () => {
    const server = createServer();
    server.registerTool(pingDefinition, () => ({ content: [{ type: 'text', text: 'pong' }] }));

    expect(server.getToolNames()).toEqual(['ping']);
    expect(server.size).toBe(1);
    expect(server.getToolDefinition('ping')).toBe(pingDefinition);
  });

  it('rejects a duplicate tool name', () => {
    const server = createServer();
    server.registerTool(pingDefinition, () => ({ content: [{ type: 'text', text: 'pong' }] }));

    expect(() =>
      server.registerTool(pingDefinition, () => ({ content: [{ type: 'text', text: 'again' }] })),
    ).toThrow(/already registered/u);
  });

  it('sorts tool names', () => {
    const server = createServer();
    for (const name of ['zeta', 'alpha', 'mid']) {
      server.registerTool(
        { name, description: name, inputSchema: z.object({}) },
        () => ({ content: [{ type: 'text', text: name }] }),
      );
    }

    expect(server.getToolNames()).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('returns undefined for an unknown definition', () => {
    expect(createServer().getToolDefinition('nope')).toBeUndefined();
  });
});

describe('InternalMCPServer dynamic plugin tools', () => {
  it('registers a plugin tool and attributes it to the plugin', () => {
    const server = createServer();
    server.registerDynamicTool(
      'acme.plugin',
      { name: 'acme_tool', description: 'x', inputSchema: z.object({}) },
      () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );

    expect(server.getToolNames()).toEqual(['acme_tool']);
  });

  it('rejects the reserved core id', () => {
    const server = createServer();
    expect(() =>
      server.registerDynamicTool(
        CORE_PLUGIN_ID,
        { name: 'x', description: 'x', inputSchema: z.object({}) },
        () => ({ content: [{ type: 'text', text: '' }] }),
      ),
    ).toThrow(/reserved/u);
  });

  it('unregisters every tool owned by a plugin', () => {
    const server = createServer();
    // Built with the exported helper rather than an inline object literal. A
    // standalone `const` gets no contextual type, so an inline literal's
    // `type: 'text'` would widen to `string` and stop being assignable to
    // `ToolResult`.
    const handler = () => textResult('ok');

    server.registerDynamicTool(
      'acme.plugin',
      { name: 'a', description: 'a', inputSchema: z.object({}) },
      handler,
    );
    server.registerDynamicTool(
      'acme.plugin',
      { name: 'b', description: 'b', inputSchema: z.object({}) },
      handler,
    );
    server.registerTool(
      { name: 'core_tool', description: 'c', inputSchema: z.object({}) },
      handler,
    );

    expect(server.unregisterToolsByPlugin('acme.plugin')).toBe(2);
    expect(server.getToolNames()).toEqual(['core_tool']);
    expect(server.unregisterToolsByPlugin('acme.plugin')).toBe(0);
  });

  it('leaves other plugins untouched', () => {
    const server = createServer();
    const handler = () => textResult('ok');

    server.registerDynamicTool(
      'one',
      { name: 'one_tool', description: 'a', inputSchema: z.object({}) },
      handler,
    );
    server.registerDynamicTool(
      'two',
      { name: 'two_tool', description: 'b', inputSchema: z.object({}) },
      handler,
    );

    server.unregisterToolsByPlugin('one');

    expect(server.getToolNames()).toEqual(['two_tool']);
  });
});
