/**
 * Tests for the core composition root.
 *
 * Narrow on purpose: what matters here is the *choice* of collaborators, since
 * every collaborator has its own suite. The sandbox choice in particular,
 * because picking the wrong one silently changes the app's safety story.
 *
 * @module common/core.test
 */

import { describe, expect, it } from 'vitest';
import { createCore } from './core.ts';
import { LocalRunner } from './docker/localRunner.ts';
import { DockerSandbox } from './docker/sandbox.ts';

describe('createCore', () => {
  it('registers the built-in tool set', () => {
    const core = createCore({ workspaceRoot: '/ws' });

    expect(core.server.getToolNames().sort()).toEqual([
      'ask_agent',
      'get_editor_context',
      'list_directory',
      'list_models',
      'read_file',
      'run_terminal_command',
      'write_file',
    ]);
  });

  it('sandboxes by default', () => {
    // The default is the product's promise. If this ever flips, it should take
    // a deliberate failing test with it rather than a quiet commit.
    const core = createCore({ workspaceRoot: '/ws' });

    expect(core.sandbox).toBeInstanceOf(DockerSandbox);
    expect(core.sandbox).not.toBeInstanceOf(LocalRunner);
  });

  it('uses the unisolated runner only when explicitly asked', () => {
    const core = createCore({ workspaceRoot: '/ws', allowLocalExecution: true });

    expect(core.sandbox).toBeInstanceOf(LocalRunner);
  });

  it('still prefers an injected sandbox over the opt-in flag', () => {
    // Injection is how tests and plugins substitute a runner; it must not be
    // overridden by an environment-driven default.
    const injected = new DockerSandbox();

    const core = createCore({
      workspaceRoot: '/ws',
      sandbox: injected,
      allowLocalExecution: true,
    });

    expect(core.sandbox).toBe(injected);
  });
});
