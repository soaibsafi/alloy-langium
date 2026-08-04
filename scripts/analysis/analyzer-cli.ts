import type { AlloyModule } from 'alloy-language';
import { createAlloyServices } from 'alloy-language';
import { NodeFileSystem } from 'langium/node';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { extractDocuments, findAlloyFiles } from '../../packages/cli/src/util.js';

export interface ModelMetrics {
    filePath: string;
    fileSize: number;
    lineCount: number;
    parseTime: number;
    validationTime: number;
    signatures: number;
    predicates: number;
    functions: number;
    facts: number;
    assertions: number;
    commands: number;
    totalNodes: number;
    complexityScore: number;
    parseSuccessful: boolean;
    errorCount: number;
}

export function analyzeASTStructure(ast: any): {
    totalNodes: number;
    signatures: number;
    predicates: number;
    functions: number;
    facts: number;
    assertions: number;
    commands: number;
} {
    if (!ast || !ast.paragraph) {
        return { totalNodes: 0, signatures: 0, predicates: 0, functions: 0, facts: 0, assertions: 0, commands: 0 };
    }

    const analysis = { totalNodes: 0, signatures: 0, predicates: 0, functions: 0, facts: 0, assertions: 0, commands: 0 };

    ast.paragraph.forEach((p: any) => {
        analysis.totalNodes++;
        switch (p.$type) {
            case 'SigDecl':
                analysis.signatures++;
                break;
            case 'PredDecl':
                analysis.predicates++;
                break;
            case 'FunDecl':
                analysis.functions++;
                break;
            case 'FactDecl':
                analysis.facts++;
                break;
            case 'AssertDecl':
                analysis.assertions++;
                break;
            case 'CmdDecl':
            case 'RunCmd':
            case 'CheckCmd':
                analysis.commands++;
                break;
        }
    });

    function countNodes(node: any, visited = new Set(), depth = 0): number {
        if (!node || typeof node !== 'object' || depth > 100) return 0;
        if (visited.has(node)) return 0;
        visited.add(node);

        let count = 1;
        for (const key in node) {
            if (node.hasOwnProperty(key) && key !== '$type' && key !== '$container' && key !== '$document') {
                const value = node[key];
                if (Array.isArray(value)) {
                    value.forEach(item => { count += countNodes(item, visited, depth + 1); });
                } else if (typeof value === 'object') {
                    count += countNodes(value, visited, depth + 1);
                }
            }
        }
        return count;
    }

    analysis.totalNodes = countNodes(ast);
    return analysis;
}

export function calculateComplexityScore(astAnalysis: any, fileContent: string, lineCount: number): number {
    let score = 0;
    score += lineCount * 0.1;
    score += fileContent.length * 0.001;
    score += astAnalysis.signatures * 2;
    score += astAnalysis.predicates * 3;
    score += astAnalysis.functions * 3;
    score += astAnalysis.facts * 4;
    score += astAnalysis.assertions * 3;
    score += astAnalysis.commands * 1;
    score += astAnalysis.totalNodes * 0.05;

    const complexKeywords = ['all', 'some', 'no', 'lone', 'one', 'let', 'implies', 'iff'];
    complexKeywords.forEach(keyword => {
        const matches = (fileContent.match(new RegExp(`\\b${keyword}\\b`, 'g')) || []).length;
        score += matches * 0.5;
    });

    return Math.round(score * 100) / 100;
}

export async function analyzeAction(paths: string[], options: { format?: string; output?: string }): Promise<void> {
    const alloyServices = createAlloyServices(NodeFileSystem);
    await alloyServices.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const services = alloyServices.Alloy;

    let allFiles: string[] = [];
    for (const p of paths) {
        try {
            const files = await findAlloyFiles(p);
            allFiles.push(...files);
        } catch (err: any) {
            console.error(chalk.red(`Error accessing path '${p}': ${err.message}`));
            process.exit(1);
        }
    }

    allFiles = [...new Set(allFiles)];
    if (allFiles.length === 0) {
        console.warn(chalk.yellow('No .als files found to analyze.'));
        return;
    }

    console.log(chalk.bold(`📊 Analyzing ${allFiles.length} Alloy specification file(s)...\n`));

    const buildStart = performance.now();
    const documents = await extractDocuments(allFiles, services);
    const buildTime = performance.now() - buildStart;

    const results: ModelMetrics[] = [];

    for (const document of documents) {
        const filePath = document.uri.fsPath;
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const lineCount = fileContent.split(/\r?\n/).length;

        const ast = document.parseResult?.value as AlloyModule;
        const astAnalysis = analyzeASTStructure(ast);
        const complexityScore = calculateComplexityScore(astAnalysis, fileContent, lineCount);

        const errorCount = (document.diagnostics ?? []).filter(d => d.severity === 1).length + (document.parseResult?.parserErrors.length ?? 0);

        results.push({
            filePath,
            fileSize: fileContent.length,
            lineCount,
            parseTime: Math.round((buildTime / documents.length) * 100) / 100,
            validationTime: 0,
            ...astAnalysis,
            complexityScore,
            parseSuccessful: (document.parseResult?.parserErrors.length ?? 0) === 0,
            errorCount
        });
    }

    const format = (options.format || 'table').toLowerCase();
    let outputString = '';

    if (format === 'json') {
        outputString = JSON.stringify(results, null, 2);
    } else if (format === 'csv') {
        const headers = ['filePath', 'fileSize', 'lineCount', 'parseTime', 'validationTime', 'signatures', 'predicates', 'functions', 'facts', 'assertions', 'commands', 'totalNodes', 'complexityScore', 'errorCount'];
        const rows = results.map(r => headers.map(h => (r as any)[h]).join(','));
        outputString = [headers.join(','), ...rows].join('\n');
    } else {
        // Table / Formatted Text
        console.log(chalk.bold('---------------------------------------------------------------------------------------------------------'));
        console.log(`${chalk.cyan.bold('File')} | ${chalk.yellow('Sigs')} | ${chalk.yellow('Preds')} | ${chalk.yellow('Funs')} | ${chalk.yellow('Facts')} | ${chalk.yellow('Asserts')} | ${chalk.yellow('Cmds')} | ${chalk.yellow('Nodes')} | ${chalk.magenta.bold('Complexity')} | ${chalk.green('Errors')}`);
        console.log(chalk.bold('---------------------------------------------------------------------------------------------------------'));

        for (const r of results) {
            const shortPath = path.basename(r.filePath);
            const errStr = r.errorCount > 0 ? chalk.red(String(r.errorCount)) : chalk.green('0');
            console.log(`${chalk.bold(shortPath.padEnd(25))} | ${String(r.signatures).padEnd(4)} | ${String(r.predicates).padEnd(5)} | ${String(r.functions).padEnd(4)} | ${String(r.facts).padEnd(5)} | ${String(r.assertions).padEnd(7)} | ${String(r.commands).padEnd(4)} | ${String(r.totalNodes).padEnd(5)} | ${chalk.magenta.bold(String(r.complexityScore).padEnd(10))} | ${errStr}`);
        }
        console.log(chalk.bold('---------------------------------------------------------------------------------------------------------\n'));

        const totalSigs = results.reduce((s, r) => s + r.signatures, 0);
        const totalPreds = results.reduce((s, r) => s + r.predicates, 0);
        const totalFacts = results.reduce((s, r) => s + r.facts, 0);
        const avgComplexity = (results.reduce((s, r) => s + r.complexityScore, 0) / results.length).toFixed(2);

        console.log(chalk.bold('=== ANALYSIS SUMMARY ==='));
        console.log(`📁 Total models:       ${results.length}`);
        console.log(`🔷 Total signatures:   ${totalSigs}`);
        console.log(`🔶 Total predicates:   ${totalPreds}`);
        console.log(`📜 Total facts:        ${totalFacts}`);
        console.log(`🧮 Average complexity: ${chalk.magenta.bold(avgComplexity)}`);
    }

    if (format === 'json' || format === 'csv') {
        console.log(outputString);
    }

    if (options.output) {
        fs.writeFileSync(options.output, outputString || JSON.stringify(results, null, 2), 'utf-8');
        console.log(chalk.green(`\n✔ Results saved to ${options.output}`));
    }
}

// Automatically run analyzeAction when called directly from CLI
if (process.argv[1]?.includes('analyzer-cli')) {
    const args = process.argv.slice(2);
    if (args.length > 0) {
        analyzeAction(args, {}).catch(err => {
            console.error(err);
            process.exit(1);
        });
    }
}

