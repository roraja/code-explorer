/**
 * Code Explorer — Extension Integration Tests
 *
 * Basic integration tests to verify the extension activates
 * and registers its contributions correctly.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Code Explorer Extension', () => {
  test('Extension is present', () => {
    const ext = vscode.extensions.getExtension('code-explorer-team.code-explorer');
    assert.ok(ext, 'Extension should be found');
  });

  test('Commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('codeExplorer.exploreSymbol'),
      'exploreSymbol command should be registered'
    );
    assert.ok(
      commands.includes('codeExplorer.refreshAnalysis'),
      'refreshAnalysis command should be registered'
    );
    assert.ok(
      commands.includes('codeExplorer.clearCache'),
      'clearCache command should be registered'
    );
    assert.ok(
      commands.includes('codeExplorer.analyzeWorkspace'),
      'analyzeWorkspace command should be registered'
    );
  });
});
