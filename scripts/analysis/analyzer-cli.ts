import type { AlloyModule } from 'alloy-language';
import { createAlloyServices } from 'alloy-language';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { extractDocuments, findAlloyFiles } from '../../packages/cli/src/util.js';
import { isAstNode } from 'langium';

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
                    value.forEach(item => { 
                        if (item && typeof item === 'object' && isAstNode(item)) {
                            count += countNodes(item, visited, depth + 1); 
                        }
                    });
                } else if (value && typeof value === 'object' && isAstNode(value)) {
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

    const format = (options.format || 'table').toLowerCase();
    
    if (format === 'csv') {
        const headers = ['filePath', 'fileSize', 'lineCount', 'parseTime', 'validationTime', 'signatures', 'predicates', 'functions', 'facts', 'assertions', 'commands', 'totalNodes', 'complexityScore', 'errorCount'];
        const headerRow = headers.join(',');
        console.log(headerRow);
        if (options.output) fs.writeFileSync(options.output, headerRow + '\n', 'utf-8');
    } else if (format === 'table') {
        console.log(chalk.bold('---------------------------------------------------------------------------------------------------------'));
        console.log(`${chalk.cyan.bold('File')} | ${chalk.yellow('Sigs')} | ${chalk.yellow('Preds')} | ${chalk.yellow('Funs')} | ${chalk.yellow('Facts')} | ${chalk.yellow('Asserts')} | ${chalk.yellow('Cmds')} | ${chalk.yellow('Nodes')} | ${chalk.magenta.bold('Complexity')} | ${chalk.green('Errors')}`);
        console.log(chalk.bold('---------------------------------------------------------------------------------------------------------'));
    }

    const results: ModelMetrics[] = [];
    let totalBuildTime = 0;

    for (const filePath of allFiles) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const lineCount = fileContent.split(/\r?\n/).length;

        const uri = URI.file(path.resolve(filePath));
        const buildStart = performance.now();
        const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(uri);
        await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
        const buildTime = performance.now() - buildStart;
        totalBuildTime += buildTime;

        const ast = document.parseResult?.value as AlloyModule;
        const astAnalysis = analyzeASTStructure(ast);
        const complexityScore = calculateComplexityScore(astAnalysis, fileContent, lineCount);

        const errorCount = (document.diagnostics ?? []).filter(d => d.severity === 1).length + (document.parseResult?.parserErrors.length ?? 0);

        const rowResult = {
            filePath,
            fileSize: fileContent.length,
            lineCount,
            parseTime: Math.round(buildTime * 100) / 100,
            validationTime: 0,
            ...astAnalysis,
            complexityScore,
            parseSuccessful: (document.parseResult?.parserErrors.length ?? 0) === 0,
            errorCount
        };

        if (format === 'csv') {
            const headers = ['filePath', 'fileSize', 'lineCount', 'parseTime', 'validationTime', 'signatures', 'predicates', 'functions', 'facts', 'assertions', 'commands', 'totalNodes', 'complexityScore', 'errorCount'];
            const rowStr = headers.map(h => (rowResult as any)[h]).join(',');
            console.log(rowStr);
            if (options.output) fs.appendFileSync(options.output, rowStr + '\n', 'utf-8');
        } else if (format === 'table') {
            const shortPath = path.basename(rowResult.filePath);
            const errStr = rowResult.errorCount > 0 ? chalk.red(String(rowResult.errorCount)) : chalk.green('0');
            console.log(`${chalk.bold(shortPath.padEnd(25))} | ${String(rowResult.signatures).padEnd(4)} | ${String(rowResult.predicates).padEnd(5)} | ${String(rowResult.functions).padEnd(4)} | ${String(rowResult.facts).padEnd(5)} | ${String(rowResult.assertions).padEnd(7)} | ${String(rowResult.commands).padEnd(4)} | ${String(rowResult.totalNodes).padEnd(5)} | ${chalk.magenta.bold(String(rowResult.complexityScore).padEnd(10))} | ${errStr}`);
        }
        results.push(rowResult);

        // Deep cleanup memory
        services.shared.workspace.IndexManager.remove(uri);
        services.shared.workspace.LangiumDocuments.deleteDocument(uri);
    }

    if (format === 'table') {
        console.log(chalk.bold('---------------------------------------------------------------------------------------------------------\n'));
    }

    if (format === 'json') {
        const outputString = JSON.stringify(results, null, 2);
        console.log(outputString);
        if (options.output) {
            fs.writeFileSync(options.output, outputString, 'utf-8');
        }
    }

    if (format === 'table') {
        const totalSigs = results.reduce((s, r) => s + r.signatures, 0);
        const totalPreds = results.reduce((s, r) => s + r.predicates, 0);
        const totalFacts = results.reduce((s, r) => s + r.facts, 0);
        const avgComplexity = results.length > 0 ? (results.reduce((s, r) => s + r.complexityScore, 0) / results.length).toFixed(2) : "0";

        console.log(chalk.bold('=== ANALYSIS SUMMARY ==='));
        console.log(`📁 Total models:       ${results.length}`);
        console.log(`🔷 Total signatures:   ${totalSigs}`);
        console.log(`🔶 Total predicates:   ${totalPreds}`);
        console.log(`📜 Total facts:        ${totalFacts}`);
        console.log(`🧮 Average complexity: ${chalk.magenta.bold(avgComplexity)}`);
        if (options.output) {
            console.log(chalk.green(`\n✔ Results printed to console (Table format output file saving not strictly defined, run as CSV/JSON for data output).`));
        }
    }

}

// Automatically run analyzeAction when called directly from CLI
if (process.argv[1]?.includes('analyzer-cli')) {
    const args = process.argv.slice(2);
    const formatIdx = args.indexOf('--format');
    const format = formatIdx !== -1 ? args[formatIdx + 1] : undefined;
    const outputIdx = args.indexOf('--output');
    const output = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

    const filePaths = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]?.startsWith('--')));

    if (filePaths.length > 0) {
        analyzeAction(filePaths, { format, output }).catch(err => {
            console.error(err);
            process.exit(1);
        });
    } else {
        console.log('Usage: npx tsx scripts/analysis/analyzer-cli.ts <path-to-als-file-or-directory> [--format json|csv|table] [--output <filepath>]');
    }
}

