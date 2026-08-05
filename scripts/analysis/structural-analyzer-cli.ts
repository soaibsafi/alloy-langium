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

export interface StructuralMetrics {
    filePath: string;
    fileSize: number;
    lineCount: number;
    maxAstDepth: number;
    avgExprDepth: number;
    maxQuantifierNesting: number;
    quantifiedVarCount: number;
    maxTemporalNesting: number;
    maxImplicationNesting: number;
    maxJoinChainLength: number;
    avgJoinChainLength: number;
    transitiveClosureCount: number;
    overloadedNameCount: number;
    declToConstraintRatio: number;
    avgRefsPerDecl: number;
    cyclomaticComplexity: number;
    formulaToSigRatio: number;
    parseSuccessful: boolean;
    errorCount: number;
}

const TEMPORAL_KEYWORDS = new Set(['always', 'eventually', 'after', 'before', 'historically', 'once', 'until', 'releases', 'since', 'triggered']);

export function analyzeStructuralComplexity(ast: AlloyModule, document: any): Omit<StructuralMetrics, 'filePath' | 'fileSize' | 'lineCount' | 'parseSuccessful' | 'errorCount'> {
    let maxAstDepth = 0;
    let exprCount = 0;
    let totalExprDepthSum = 0;
    let maxQuantifierNesting = 0;
    let quantifiedVarCount = 0;
    let maxTemporalNesting = 0;
    let maxImplicationNesting = 0;
    let maxJoinChainLength = 0;
    let totalJoinChainLengthSum = 0;
    let joinChainCount = 0;
    let transitiveClosureCount = 0;
    let cyclomaticComplexity = 0;

    let declarationCount = 0;
    let constraintCount = 0;
    let signatureCount = 0;

    // Track names to detect overloading
    const nameToTypes = new Map<string, Set<string>>();
    function recordName(name: string | undefined, kind: string) {
        if (!name) return;
        if (!nameToTypes.has(name)) {
            nameToTypes.set(name, new Set());
        }
        nameToTypes.get(name)!.add(kind);
    }

    // Traverse AST to collect top-level counts and declarations
    if (ast && ast.paragraph) {
        for (const p of ast.paragraph) {
            switch (p.$type) {
                case 'SigDecl':
                    signatureCount++;
                    declarationCount++;
                    recordName(p.name, 'SigDecl');
                    if (p.fields) {
                        for (const f of p.fields) {
                            if (f.decl?.name?.name) {
                                declarationCount++;
                                recordName(f.decl.name.name, 'FieldDecl');
                            }
                        }
                    }
                    if (p.sigFacts) constraintCount += p.sigFacts.length;
                    break;
                case 'EnumDecl':
                    declarationCount++;
                    recordName(p.name, 'EnumDecl');
                    break;
                case 'PredDecl':
                    constraintCount++;
                    recordName(p.name, 'PredDecl');
                    if (p.paraDecls?.decls) {
                        for (const d of p.paraDecls.decls) {
                            if (d.name?.name) declarationCount++;
                        }
                    }
                    break;
                case 'FunDecl':
                    constraintCount++;
                    recordName(p.name, 'FunDecl');
                    if (p.paraDecls?.decls) {
                        for (const d of p.paraDecls.decls) {
                            if (d.name?.name) declarationCount++;
                        }
                    }
                    break;
                case 'FactDecl':
                    constraintCount++;
                    if (p.name) recordName(p.name, 'FactDecl');
                    break;
                case 'AssertDecl':
                    constraintCount++;
                    if (p.name) recordName(p.name, 'AssertDecl');
                    break;
            }
        }
    }

    let overloadedNameCount = 0;
    for (const [, kinds] of nameToTypes.entries()) {
        if (kinds.size > 1) {
            overloadedNameCount++;
        }
    }

    // Measure AST depth and node-specific metrics
    function walkNode(
        node: any,
        depth: number,
        quantDepth: number,
        tempDepth: number,
        implDepth: number,
        visited = new Set()
    ): number {
        if (!node || typeof node !== 'object' || visited.has(node)) {
            return depth;
        }
        visited.add(node);

        if (depth > maxAstDepth) maxAstDepth = depth;

        let currentQuantDepth = quantDepth;
        let currentTempDepth = tempDepth;
        let currentImplDepth = implDepth;

        const type = node.$type;

        // Quantifier nesting & variables
        if (type === 'QuantExpr' || type === 'SetExpr') {
            currentQuantDepth++;
            if (currentQuantDepth > maxQuantifierNesting) {
                maxQuantifierNesting = currentQuantDepth;
            }
            if (node.decls) {
                for (const d of node.decls) {
                    if (d.name?.name) quantifiedVarCount++;
                    if (d.additionalNames) quantifiedVarCount += d.additionalNames.length;
                }
            }
        }

        // Temporal operator nesting
        let isTemporal = false;
        if (type === 'BinaryTemporalExpr') {
            isTemporal = true;
        } else if (type === 'UnaryLogicalExpr' && typeof node.op === 'string' && TEMPORAL_KEYWORDS.has(node.op)) {
            isTemporal = true;
        }
        if (isTemporal) {
            currentTempDepth++;
            if (currentTempDepth > maxTemporalNesting) {
                maxTemporalNesting = currentTempDepth;
            }
        }

        // Implication nesting
        if (type === 'ImplicationExpr' || type === 'BiImplicationExpr') {
            currentImplDepth++;
            if (currentImplDepth > maxImplicationNesting) {
                maxImplicationNesting = currentImplDepth;
            }
        }

        // Transitive closures
        if (type === 'UnaryExpr' && (node.op === '^' || node.op === '*')) {
            transitiveClosureCount++;
        }

        // Relational join chains (DotJoinExpr)
        if (type === 'DotJoinExpr') {
            let joinLength = 1;
            let curr = node;
            while (curr && curr.$type === 'DotJoinExpr') {
                joinLength++;
                if (curr.op === '.^' || curr.op === '.*') {
                    transitiveClosureCount++;
                }
                curr = curr.right;
            }
            if (joinLength > maxJoinChainLength) {
                maxJoinChainLength = joinLength;
            }
            totalJoinChainLengthSum += joinLength;
            joinChainCount++;
        }

        // Cyclomatic Complexity (branching logic)
        if (['DisjunctionExpr', 'ConjunctionExpr', 'BiImplicationExpr', 'ImplicationExpr', 'UnaryLogicalExpr'].includes(type)) {
            cyclomaticComplexity++;
        }

        // Expression depth measurement
        let maxChildDepth = depth;
        for (const key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key) && key !== '$type' && key !== '$container' && key !== '$document') {
                const child = node[key];
                if (Array.isArray(child)) {
                    for (const item of child) {
                        if (item && typeof item === 'object' && isAstNode(item)) {
                            const d = walkNode(item, depth + 1, currentQuantDepth, currentTempDepth, currentImplDepth, visited);
                            if (d > maxChildDepth) maxChildDepth = d;
                        }
                    }
                } else if (child && typeof child === 'object' && isAstNode(child)) {
                    const d = walkNode(child, depth + 1, currentQuantDepth, currentTempDepth, currentImplDepth, visited);
                    if (d > maxChildDepth) maxChildDepth = d;
                }
            }
        }

        if (type && type.endsWith('Expr')) {
            exprCount++;
            const subTreeDepth = maxChildDepth - depth + 1;
            totalExprDepthSum += subTreeDepth;
        }

        return maxChildDepth;
    }

    if (ast) {
        walkNode(ast, 1, 0, 0, 0);
    }

    const avgExprDepth = exprCount > 0 ? Math.round((totalExprDepthSum / exprCount) * 100) / 100 : 0;
    const avgJoinChainLength = joinChainCount > 0 ? Math.round((totalJoinChainLengthSum / joinChainCount) * 100) / 100 : 0;
    const declToConstraintRatio = constraintCount > 0 ? Math.round((declarationCount / constraintCount) * 100) / 100 : declarationCount;

    // Count cross references per declaration
    let referenceCount = 0;
    if (document && document.references) {
        referenceCount = document.references.length;
    } else if (ast) {
        // Fallback reference count via AST traversal
        function countRefs(node: any, visited = new Set()) {
            if (!node || typeof node !== 'object' || visited.has(node)) return;
            visited.add(node);
            if (node.ref || node.$refText) referenceCount++;
            for (const k in node) {
                if (Object.prototype.hasOwnProperty.call(node, k) && k !== '$container' && k !== '$type') {
                    const val = node[k];
                    if (Array.isArray(val)) val.forEach(v => countRefs(v, visited));
                    else if (typeof val === 'object') countRefs(val, visited);
                }
            }
        }
        countRefs(ast);
    }

    const avgRefsPerDecl = declarationCount > 0 ? Math.round((referenceCount / declarationCount) * 100) / 100 : 0;
    const formulaToSigRatio = signatureCount > 0 ? Math.round((exprCount / signatureCount) * 100) / 100 : exprCount;

    return {
        maxAstDepth,
        avgExprDepth,
        maxQuantifierNesting,
        quantifiedVarCount,
        maxTemporalNesting,
        maxImplicationNesting,
        maxJoinChainLength,
        avgJoinChainLength,
        transitiveClosureCount,
        overloadedNameCount,
        declToConstraintRatio,
        avgRefsPerDecl,
        cyclomaticComplexity,
        formulaToSigRatio
    };
}

export async function analyzeStructuralAction(paths: string[], options: { format?: string; output?: string }): Promise<void> {
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

    console.log(chalk.bold(`🔬 Analyzing Structural Complexity for ${allFiles.length} Specification File(s)...\n`));

    const format = (options.format || 'table').toLowerCase();

    if (format === 'csv') {
        const headers = [
            'filePath', 'lineCount', 'maxAstDepth', 'avgExprDepth', 'maxQuantifierNesting',
            'quantifiedVarCount', 'maxTemporalNesting', 'maxImplicationNesting', 'maxJoinChainLength',
            'avgJoinChainLength', 'transitiveClosureCount', 'overloadedNameCount', 'declToConstraintRatio',
            'avgRefsPerDecl', 'cyclomaticComplexity', 'formulaToSigRatio', 'errorCount'
        ];
        const headerRow = headers.join(',');
        console.log(headerRow);
        if (options.output) fs.writeFileSync(options.output, headerRow + '\n', 'utf-8');
    } else if (format === 'table') {
        console.log(chalk.bold('---------------------------------------------------------------------------------------------------------------------------'));
        console.log(
            `${chalk.cyan.bold('File')} | ` +
            `${chalk.yellow('AST Dpth')} | ` +
            `${chalk.yellow('Quant Nst')} | ` +
            `${chalk.yellow('Quant Vars')} | ` +
            `${chalk.yellow('Temp Nst')} | ` +
            `${chalk.yellow('Impl Nst')} | ` +
            `${chalk.yellow('Max Join')} | ` +
            `${chalk.yellow('Closure')} | ` +
            `${chalk.yellow('Ovrlnd')} | ` +
            `${chalk.magenta.bold('Decl/Cnstr')} | ` +
            `${chalk.magenta.bold('Cyclo')} | ` +
            `${chalk.green('Errors')}`
        );
        console.log(chalk.bold('---------------------------------------------------------------------------------------------------------------------------'));
    }

    const results: StructuralMetrics[] = [];
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
        const metrics = analyzeStructuralComplexity(ast, document);

        const parseErrors = document.parseResult?.parserErrors.length ?? 0;
        const validationErrors = (document.diagnostics ?? []).filter(d => d.severity === 1).length;
        const errorCount = parseErrors + validationErrors;

        const rowResult = {
            filePath,
            fileSize: fileContent.length,
            lineCount,
            ...metrics,
            parseSuccessful: parseErrors === 0,
            errorCount
        };

        if (format === 'csv') {
            const headers = [
                'filePath', 'lineCount', 'maxAstDepth', 'avgExprDepth', 'maxQuantifierNesting',
                'quantifiedVarCount', 'maxTemporalNesting', 'maxImplicationNesting', 'maxJoinChainLength',
                'avgJoinChainLength', 'transitiveClosureCount', 'overloadedNameCount', 'declToConstraintRatio',
                'avgRefsPerDecl', 'cyclomaticComplexity', 'formulaToSigRatio', 'errorCount'
            ];
            const rowStr = headers.map(h => (rowResult as any)[h]).join(',');
            console.log(rowStr);
            if (options.output) fs.appendFileSync(options.output, rowStr + '\n', 'utf-8');
        } else if (format === 'table') {
            const shortPath = path.basename(rowResult.filePath);
            const errStr = rowResult.errorCount > 0 ? chalk.red(String(rowResult.errorCount)) : chalk.green('0');
            console.log(
                `${chalk.bold(shortPath.padEnd(25))} | ` +
                `${String(rowResult.maxAstDepth).padEnd(8)} | ` +
                `${String(rowResult.maxQuantifierNesting).padEnd(9)} | ` +
                `${String(rowResult.quantifiedVarCount).padEnd(10)} | ` +
                `${String(rowResult.maxTemporalNesting).padEnd(8)} | ` +
                `${String(rowResult.maxImplicationNesting).padEnd(8)} | ` +
                `${String(rowResult.maxJoinChainLength).padEnd(8)} | ` +
                `${String(rowResult.transitiveClosureCount).padEnd(7)} | ` +
                `${String(rowResult.overloadedNameCount).padEnd(6)} | ` +
                `${chalk.magenta.bold(String(rowResult.declToConstraintRatio).padEnd(10))} | ` +
                `${chalk.magenta.bold(String(rowResult.cyclomaticComplexity).padEnd(5))} | ` +
                `${errStr}`
            );
        }
        
        results.push(rowResult);

        // Deep cleanup memory
        services.shared.workspace.IndexManager.remove(uri);
        services.shared.workspace.LangiumDocuments.deleteDocument(uri);
    }

    if (format === 'table') {
        console.log(chalk.bold('---------------------------------------------------------------------------------------------------------------------------\n'));
        console.log(chalk.bold('=== STRUCTURAL RESEARCH METRICS SUMMARY ==='));
        console.log(`📁 Total Models Analyzed:     ${results.length}`);
        console.log(`📊 Avg Max AST Depth:        ${results.length > 0 ? (results.reduce((s, r) => s + r.maxAstDepth, 0) / results.length).toFixed(2) : 0}`);
        console.log(`🔍 Avg Quantifier Nesting:   ${results.length > 0 ? (results.reduce((s, r) => s + r.maxQuantifierNesting, 0) / results.length).toFixed(2) : 0}`);
        console.log(`⏳ Avg Temporal Nesting:     ${results.length > 0 ? (results.reduce((s, r) => s + r.maxTemporalNesting, 0) / results.length).toFixed(2) : 0}`);
        console.log(`🔗 Avg Max Join Chain:       ${results.length > 0 ? (results.reduce((s, r) => s + r.maxJoinChainLength, 0) / results.length).toFixed(2) : 0}`);
        console.log(`🌀 Total Transitive Closures: ${results.reduce((s, r) => s + r.transitiveClosureCount, 0)}`);
        console.log(`🔀 Avg Cyclomatic Complexity: ${results.length > 0 ? (results.reduce((s, r) => s + r.cyclomaticComplexity, 0) / results.length).toFixed(2) : 0}`);
    }

    if (format === 'json') {
        const outputString = JSON.stringify(results, null, 2);
        console.log(outputString);
        if (options.output) {
            fs.writeFileSync(options.output, outputString, 'utf-8');
            console.log(chalk.green(`\n✔ Results saved to ${options.output}`));
        }
    }
}

// Direct CLI Invocation
if (process.argv[1]?.includes('structural-analyzer-cli')) {
    const args = process.argv.slice(2);
    const formatIdx = args.indexOf('--format');
    const format = formatIdx !== -1 ? args[formatIdx + 1] : undefined;
    const outputIdx = args.indexOf('--output');
    const output = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

    const filePaths = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]?.startsWith('--')));

    if (filePaths.length > 0) {
        analyzeStructuralAction(filePaths, { format, output }).catch(err => {
            console.error(err);
            process.exit(1);
        });
    } else {
        console.log('Usage: npx tsx scripts/analysis/structural-analyzer-cli.ts <path-to-als-file-or-directory> [--format json|csv|table] [--output <filepath>]');
    }
}
