import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node.js';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node.js';

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('Alloy Language Server');
    outputChannel.appendLine('[Alloy] Activating VS Code Extension...');

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'alloy.showModelStats';
    context.subscriptions.push(statusBarItem);

    // Update status bar on active editor change or document save/edit
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar(vscode.window.activeTextEditor)),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
                updateStatusBar(vscode.window.activeTextEditor);
            }
        })
    );

    updateStatusBar(vscode.window.activeTextEditor);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('alloy.showModelStats', () => showModelStatsCommand()),
        vscode.commands.registerCommand('alloy.restartServer', () => restartServerCommand(context))
    );

    client = await startLanguageClient(context);
}

export async function deactivate(): Promise<void> {
    if (client) {
        await client.stop();
        client = undefined;
    }
}

function analyzeModelText(text: string) {
    const lines = text.split(/\r?\n/).length;
    const sigs = (text.match(/^\s*(?:abstract\s+|one\s+|lone\s+|some\s+|private\s+|var\s+)*sig\s+([A-Za-z0-9_,\s]+)/gm) || []).length;
    const preds = (text.match(/^\s*(?:private\s+|var\s+)*pred\s+([A-Za-z0-9_]+)/gm) || []).length;
    const funs = (text.match(/^\s*(?:private\s+|var\s+)*fun\s+([A-Za-z0-9_]+)/gm) || []).length;
    const facts = (text.match(/^\s*(?:private\s+|var\s+)*fact\s*([A-Za-z0-9_]*)/gm) || []).length;
    const asserts = (text.match(/^\s*(?:private\s+|var\s+)*assert\s+([A-Za-z0-9_]+)/gm) || []).length;
    const cmds = (text.match(/^\s*(?:run|check)\s+([A-Za-z0-9_]+)/gm) || []).length;

    let complexity = lines * 0.1 + text.length * 0.001 + sigs * 2 + preds * 3 + funs * 3 + facts * 4 + asserts * 3 + cmds * 1;
    const complexKeywords = ['all', 'some', 'no', 'lone', 'one', 'let', 'implies', 'iff'];
    complexKeywords.forEach(kw => {
        const matches = (text.match(new RegExp(`\\b${kw}\\b`, 'g')) || []).length;
        complexity += matches * 0.5;
    });

    return {
        lines,
        size: text.length,
        sigs,
        preds,
        funs,
        facts,
        asserts,
        cmds,
        complexity: Math.round(complexity * 100) / 100
    };
}

function updateStatusBar(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.languageId !== 'alloy') {
        statusBarItem.hide();
        return;
    }

    const stats = analyzeModelText(editor.document.getText());
    statusBarItem.text = `$(symbol-class) ${stats.sigs} sigs | $(symbol-method) ${stats.preds} preds`;
    statusBarItem.tooltip = `Alloy Model: ${stats.sigs} signatures, ${stats.preds} predicates, ${stats.facts} facts\nComplexity Score: ${stats.complexity}\nClick to show full report`;
    statusBarItem.show();
}

function showModelStatsCommand(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'alloy') {
        vscode.window.showWarningMessage('Please open an Alloy specification (.als) file to view model statistics.');
        return;
    }

    const doc = editor.document;
    const stats = analyzeModelText(doc.getText());
    const fileName = path.basename(doc.fileName);

    outputChannel.show(true);
    outputChannel.appendLine('====================================================');
    outputChannel.appendLine(` 📊 ALLOY MODEL STATISTICS: ${fileName}`);
    outputChannel.appendLine('====================================================');
    outputChannel.appendLine(` 📁 File Size:         ${stats.size} bytes (${stats.lines} lines)`);
    outputChannel.appendLine(` 🔷 Signatures (sig):  ${stats.sigs}`);
    outputChannel.appendLine(` 🔶 Predicates (pred): ${stats.preds}`);
    outputChannel.appendLine(` 🔹 Functions (fun):   ${stats.funs}`);
    outputChannel.appendLine(` 📜 Facts (fact):      ${stats.facts}`);
    outputChannel.appendLine(` 🛡 Assertions (assert): ${stats.asserts}`);
    outputChannel.appendLine(` 🚀 Commands (run/check): ${stats.cmds}`);
    outputChannel.appendLine(` 🧮 Complexity Score:  ${stats.complexity}`);
    outputChannel.appendLine('====================================================\n');

    vscode.window.showInformationMessage(
        `Alloy Model '${fileName}': ${stats.sigs} sigs, ${stats.preds} preds, ${stats.facts} facts. Complexity: ${stats.complexity}`,
        'Show Report'
    ).then(selection => {
        if (selection === 'Show Report') {
            outputChannel.show(true);
        }
    });
}

async function restartServerCommand(context: vscode.ExtensionContext): Promise<void> {
    outputChannel.appendLine('[Alloy] Restarting Language Server...');
    if (client) {
        await client.stop();
        client = undefined;
    }
    client = await startLanguageClient(context);
    vscode.window.showInformationMessage('Alloy Language Server restarted.');
}

async function startLanguageClient(context: vscode.ExtensionContext): Promise<LanguageClient> {
    const serverModule = context.asAbsolutePath(path.join('out', 'language', 'main.cjs'));
    const debugOptions = { execArgv: ['--nolazy', `--inspect${process.env.DEBUG_BREAK ? '-brk' : ''}=${process.env.DEBUG_SOCKET || '6009'}`] };

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: '*', language: 'alloy' }],
        outputChannel
    };

    const newClient = new LanguageClient(
        'alloy',
        'Alloy Language Server',
        serverOptions,
        clientOptions
    );

    outputChannel.appendLine('[Alloy] Starting Language Client and Server...');
    await newClient.start();
    outputChannel.appendLine('[Alloy] Language Server started successfully.');
    return newClient;
}
