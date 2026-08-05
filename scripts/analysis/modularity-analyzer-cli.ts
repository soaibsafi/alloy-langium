/**
 * @file modularity-analyzer-cli.ts
 * @description Modularity, Coupling, Call Graph, and Centrality Analyzer for Alloy Specifications.
 * 
 * Computes software architecture & formal specification quality metrics:
 * - Module imports and cross-module reference counts.
 * - Call Graph Fan-In and Fan-Out for predicates and functions.
 * - Declaration Dependency Graph Density.
 * - Strongly Connected Components (SCCs) via Tarjan's algorithm to detect recursion cycles.
 * - Unused declaration analysis.
 * - Fact coupling (facts bound to multiple signatures/fields).
 * - Signature and Predicate degree centrality.
 * 
 * Features:
 * - Direct execution via CLI (`npx tsx scripts/analysis/modularity-analyzer-cli.ts <path>`).
 * - `--include-imported` flag to toggle inclusion of imported standard module references.
 * - Format output in Table, JSON, or CSV.
 */

import type { AlloyModule } from 'alloy-language';
import { createAlloyServices } from 'alloy-language';
import { NodeFileSystem } from 'langium/node';
import { URI, isAstNode, AstUtils } from 'langium';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { findAlloyFiles } from '../../packages/cli/src/util.js';

/**
 * Interface representing modularity, coupling, call graph, and centrality metrics.
 */
export interface ModularityMetrics {
    /** File path of the analyzed specification */
    filePath: string;
    /** File size in bytes */
    fileSize: number;
    /** Source file line count */
    lineCount: number;
    /** Number of imported modules (`open ...`) */
    importedModuleCount: number;
    /** Number of references pointing across module boundaries */
    crossModuleReferenceCount: number;
    /** Maximum predicate/function call graph Fan-In (in-degree) */
    maxPredicateFanIn: number;
    /** Average predicate/function call graph Fan-In */
    avgPredicateFanIn: number;
    /** Maximum predicate/function call graph Fan-Out (out-degree) */
    maxPredicateFanOut: number;
    /** Average predicate/function call graph Fan-Out */
    avgPredicateFanOut: number;
    /** Declaration dependency graph density (E / [V * (V - 1)]) */
    declDependencyGraphDensity: number;
    /** Number of non-trivial Strongly Connected Components (recursive/mutually-recursive cycles) */
    stronglyConnectedComponentsCount: number;
    /** Maximum node count in any single SCC */
    maxSccSize: number;
    /** Number of declared elements (sigs, fields, preds) with zero incoming references */
    unusedDeclarationCount: number;
    /** Number of fact declarations referencing 3 or more distinct signatures/fields */
    highlyCoupledFactCount: number;
    /** Maximum number of signatures/fields referenced by a single fact */
    maxFactCoupling: number;
    /** Name of the signature with the highest degree centrality */
    topCentralSignature: string;
    /** Name of the predicate/function with the highest degree centrality */
    topCentralPredicate: string;
    /** Highest degree centrality score normalized by (V - 1) */
    maxDegreeCentrality: number;
    /** True if the specification parsed without syntax errors */
    parseSuccessful: boolean;
    /** Total count of syntax parser errors + semantic validation errors */
    errorCount: number;
}

/**
 * Analyzes modularity, coupling, call graphs, recursion cycles, and centrality for an Alloy AST.
 * 
 * @param ast Root AlloyModule AST node
 * @param document Parsed Langium Document object
 * @param options Configuration options (`includeImported`: default false)
 * @returns Computed modularity and coupling metrics
 */
export function analyzeModularityAndCoupling(
    ast: AlloyModule,
    document: any,
    options: { includeImported?: boolean } = {}
): Omit<ModularityMetrics, 'filePath' | 'fileSize' | 'lineCount' | 'parseSuccessful' | 'errorCount'> {
    const { includeImported = false } = options;
    const importedModuleCount = ast.import?.length ?? 0;

    // Collect all declarations in this module
    const declarations = new Map<string, any>();
    const declKind = new Map<string, string>();

    if (ast && ast.paragraph) {
        for (let i = 0; i < ast.paragraph.length; i++) {
            const p = ast.paragraph[i];
            switch (p.$type) {
                case 'SigDecl': {
                    const sigName = p.name ?? `Sig_${i}`;
                    declarations.set(sigName, p);
                    declKind.set(sigName, 'sig');
                    if (p.fields) {
                        for (const f of p.fields) {
                            if (f.decl?.name?.name) {
                                const fieldName = `${sigName}.${f.decl.name.name}`;
                                declarations.set(fieldName, f);
                                declKind.set(fieldName, 'field');
                            }
                        }
                    }
                    break;
                }
                case 'PredDecl': {
                    const name = p.name ?? `Pred_${i}`;
                    declarations.set(name, p);
                    declKind.set(name, 'pred');
                    break;
                }
                case 'FunDecl': {
                    const name = p.name ?? `Fun_${i}`;
                    declarations.set(name, p);
                    declKind.set(name, 'fun');
                    break;
                }
                case 'FactDecl': {
                    const name = p.name ?? `Fact_${i}`;
                    declarations.set(name, p);
                    declKind.set(name, 'fact');
                    break;
                }
                case 'AssertDecl': {
                    const name = p.name ?? `Assert_${i}`;
                    declarations.set(name, p);
                    declKind.set(name, 'assert');
                    break;
                }
            }
        }
    }

    const dependencyAdj = new Map<string, Set<string>>();
    const incomingRefs = new Map<string, number>();
    for (const key of declarations.keys()) {
        dependencyAdj.set(key, new Set());
        incomingRefs.set(key, 0);
    }

    let crossModuleReferenceCount = 0;
    const currentDocUri = document.uri.toString();

    // Walk AST to build call and dependency graphs
    for (const [declKey, declNode] of declarations.entries()) {
        function findReferences(node: any, visited = new Set()) {
            if (!node || typeof node !== 'object' || visited.has(node)) return;
            visited.add(node);

            if (node.ref) {
                const targetRef = node.ref;
                if (targetRef.ref) {
                    const targetNode = targetRef.ref;
                    const targetName = targetNode.name;
                    const targetDoc = AstUtils.getDocument(targetNode);
                    const isImported = Boolean(targetDoc && targetDoc.uri.toString() !== currentDocUri);

                    if (isImported) {
                        crossModuleReferenceCount++;
                    }

                    if (!includeImported && isImported) {
                        return;
                    }

                    if (targetName && declarations.has(targetName) && targetName !== declKey) {
                        dependencyAdj.get(declKey)?.add(targetName);
                        incomingRefs.set(targetName, (incomingRefs.get(targetName) || 0) + 1);
                    }
                }
            } else if (node.id?.ref?.name || node.qualName?.ref?.name) {
                const refName = node.id?.ref?.name || node.qualName?.ref?.name;
                const targetNode = node.id?.ref || node.qualName?.ref;
                const targetDoc = targetNode ? AstUtils.getDocument(targetNode) : undefined;
                const isImported = Boolean(targetDoc && targetDoc.uri.toString() !== currentDocUri);

                if (!includeImported && isImported) {
                    return;
                }

                if (refName && declarations.has(refName) && refName !== declKey) {
                    dependencyAdj.get(declKey)?.add(refName);
                    incomingRefs.set(refName, (incomingRefs.get(refName) || 0) + 1);
                }
            }

            for (const k in node) {
                if (Object.prototype.hasOwnProperty.call(node, k) && k !== '$container' && k !== '$type') {
                    const child = node[k];
                    if (Array.isArray(child)) {
                        child.forEach(item => { if (item && typeof item === 'object' && isAstNode(item)) findReferences(item, visited); });
                    } else if (child && typeof child === 'object' && isAstNode(child)) {
                        findReferences(child, visited);
                    }
                }
            }
        }

        findReferences(declNode);
    }

    // Call Graph metrics for Predicates & Functions
    const callableKeys = Array.from(declarations.keys()).filter(k => declKind.get(k) === 'pred' || declKind.get(k) === 'fun');
    const fanIn = new Map<string, number>();
    const fanOut = new Map<string, number>();

    for (const c of callableKeys) {
        fanIn.set(c, 0);
        fanOut.set(c, 0);
    }

    for (const c of callableKeys) {
        const callees = dependencyAdj.get(c) || new Set();
        let outCount = 0;
        for (const callee of callees) {
            if (declKind.get(callee) === 'pred' || declKind.get(callee) === 'fun') {
                outCount++;
                fanIn.set(callee, (fanIn.get(callee) || 0) + 1);
            }
        }
        fanOut.set(c, outCount);
    }

    const fanInValues = Array.from(fanIn.values());
    const fanOutValues = Array.from(fanOut.values());

    const maxPredicateFanIn = fanInValues.length > 0 ? Math.max(...fanInValues) : 0;
    const avgPredicateFanIn = fanInValues.length > 0 ? Math.round((fanInValues.reduce((a, b) => a + b, 0) / fanInValues.length) * 100) / 100 : 0;
    const maxPredicateFanOut = fanOutValues.length > 0 ? Math.max(...fanOutValues) : 0;
    const avgPredicateFanOut = fanOutValues.length > 0 ? Math.round((fanOutValues.reduce((a, b) => a + b, 0) / fanOutValues.length) * 100) / 100 : 0;

    // Declaration Dependency Graph Density
    const totalNodes = declarations.size;
    let totalEdges = 0;
    for (const [, targets] of dependencyAdj.entries()) {
        totalEdges += targets.size;
    }
    const declDependencyGraphDensity = totalNodes > 1 ? Math.round((totalEdges / (totalNodes * (totalNodes - 1))) * 1000) / 1000 : 0;

    // Tarjan's Strongly Connected Components (SCCs) Algorithm
    const nodeKeys = Array.from(declarations.keys());
    let index = 0;
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const sccs: string[][] = [];

    function strongConnect(nodeKey: string) {
        indices.set(nodeKey, index);
        lowlink.set(nodeKey, index);
        index++;
        stack.push(nodeKey);
        onStack.add(nodeKey);

        const neighbors = dependencyAdj.get(nodeKey) || new Set();
        for (const neighbor of neighbors) {
            if (!indices.has(neighbor)) {
                strongConnect(neighbor);
                lowlink.set(nodeKey, Math.min(lowlink.get(nodeKey)!, lowlink.get(neighbor)!));
            } else if (onStack.has(neighbor)) {
                lowlink.set(nodeKey, Math.min(lowlink.get(nodeKey)!, indices.get(neighbor)!));
            }
        }

        if (lowlink.get(nodeKey) === indices.get(nodeKey)) {
            const scc: string[] = [];
            let w: string;
            do {
                w = stack.pop()!;
                onStack.delete(w);
                scc.push(w);
            } while (w !== nodeKey);
            sccs.push(scc);
        }
    }

    for (const key of nodeKeys) {
        if (!indices.has(key)) {
            strongConnect(key);
        }
    }

    const sccSizes = sccs.map(s => s.length);
    const stronglyConnectedComponentsCount = sccs.filter(s => s.length > 1).length;
    const maxSccSize = sccSizes.length > 0 ? Math.max(...sccSizes) : 0;

    // Unused Declarations (0 incoming references)
    let unusedDeclarationCount = 0;
    for (const [key, kind] of declKind.entries()) {
        if (kind === 'sig' || kind === 'field' || kind === 'pred' || kind === 'fun') {
            const count = incomingRefs.get(key) || 0;
            if (count === 0 && !key.toLowerCase().includes('main') && !key.toLowerCase().includes('run')) {
                unusedDeclarationCount++;
            }
        }
    }

    // Highly Coupled Facts
    let highlyCoupledFactCount = 0;
    let maxFactCoupling = 0;
    for (const [key, kind] of declKind.entries()) {
        if (kind === 'fact') {
            const refs = dependencyAdj.get(key)?.size || 0;
            if (refs > maxFactCoupling) maxFactCoupling = refs;
            if (refs >= 3) highlyCoupledFactCount++;
        }
    }

    // Degree Centrality
    let topCentralSignature = 'None';
    let topCentralPredicate = 'None';
    let maxSigDegree = -1;
    let maxPredDegree = -1;

    for (const [key, kind] of declKind.entries()) {
        const outDeg = dependencyAdj.get(key)?.size || 0;
        const inDeg = incomingRefs.get(key) || 0;
        const degree = outDeg + inDeg;

        if (kind === 'sig' && degree > maxSigDegree) {
            maxSigDegree = degree;
            topCentralSignature = key;
        } else if ((kind === 'pred' || kind === 'fun') && degree > maxPredDegree) {
            maxPredDegree = degree;
            topCentralPredicate = key;
        }
    }

    const maxDegree = Math.max(maxSigDegree, maxPredDegree, 0);
    const maxDegreeCentrality = totalNodes > 1 ? Math.round((maxDegree / (totalNodes - 1)) * 100) / 100 : 0;

    return {
        importedModuleCount,
        crossModuleReferenceCount,
        maxPredicateFanIn,
        avgPredicateFanIn,
        maxPredicateFanOut,
        avgPredicateFanOut,
        declDependencyGraphDensity,
        stronglyConnectedComponentsCount,
        maxSccSize,
        unusedDeclarationCount,
        highlyCoupledFactCount,
        maxFactCoupling,
        topCentralSignature,
        topCentralPredicate,
        maxDegreeCentrality
    };
}

/**
 * Main action runner to analyze modularity for given file or directory paths.
 * 
 * @param paths Array of file or directory paths
 * @param options Output format ('table', 'json', 'csv'), output file path, and includeImported flag
 */
export async function analyzeModularityAction(paths: string[], options: { format?: string; output?: string; includeImported?: boolean } = {}): Promise<void> {
    const { includeImported = false } = options;
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

    console.log(chalk.bold(`🧩 Analyzing Modularity and Coupling for ${allFiles.length} Specification File(s)...\n`));

    const format = (options.format || 'table').toLowerCase();

    if (format === 'csv') {
        const headers = [
            'filePath', 'lineCount', 'importedModuleCount', 'crossModuleReferenceCount',
            'maxPredicateFanIn', 'avgPredicateFanIn', 'maxPredicateFanOut', 'avgPredicateFanOut',
            'declDependencyGraphDensity', 'stronglyConnectedComponentsCount', 'maxSccSize',
            'unusedDeclarationCount', 'highlyCoupledFactCount', 'maxFactCoupling',
            'topCentralSignature', 'topCentralPredicate', 'maxDegreeCentrality', 'errorCount'
        ];
        const headerRow = headers.join(',');
        console.log(headerRow);
        if (options.output) fs.writeFileSync(options.output, headerRow + '\n', 'utf-8');
    } else if (format === 'table') {
        console.log(chalk.bold('-----------------------------------------------------------------------------------------------------------------------------------'));
        console.log(
            `${chalk.cyan.bold('File')} | ` +
            `${chalk.yellow('Imports')} | ` +
            `${chalk.yellow('Fan-In (Max/Avg)')} | ` +
            `${chalk.yellow('Fan-Out (Max/Avg)')} | ` +
            `${chalk.yellow('Density')} | ` +
            `${chalk.yellow('SCCs')} | ` +
            `${chalk.yellow('Unused')} | ` +
            `${chalk.yellow('Coupled Facts')} | ` +
            `${chalk.magenta.bold('Central Sig')} | ` +
            `${chalk.magenta.bold('Central Pred')} | ` +
            `${chalk.green('Errors')}`
        );
        console.log(chalk.bold('-----------------------------------------------------------------------------------------------------------------------------------'));
    }

    const results: ModularityMetrics[] = [];

    for (const filePath of allFiles) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const lineCount = fileContent.split(/\r?\n/).length;

        const uri = URI.file(path.resolve(filePath));
        const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(uri);
        await services.shared.workspace.DocumentBuilder.build([document], { validation: true });

        const ast = document.parseResult?.value as AlloyModule;
        const metrics = analyzeModularityAndCoupling(ast, document, { includeImported });

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
                'filePath', 'lineCount', 'importedModuleCount', 'crossModuleReferenceCount',
                'maxPredicateFanIn', 'avgPredicateFanIn', 'maxPredicateFanOut', 'avgPredicateFanOut',
                'declDependencyGraphDensity', 'stronglyConnectedComponentsCount', 'maxSccSize',
                'unusedDeclarationCount', 'highlyCoupledFactCount', 'maxFactCoupling',
                'topCentralSignature', 'topCentralPredicate', 'maxDegreeCentrality', 'errorCount'
            ];
            const rowStr = headers.map(h => (rowResult as any)[h]).join(',');
            console.log(rowStr);
            if (options.output) fs.appendFileSync(options.output, rowStr + '\n', 'utf-8');
        } else if (format === 'table') {
            const shortPath = path.basename(rowResult.filePath);
            const errStr = rowResult.errorCount > 0 ? chalk.red(String(rowResult.errorCount)) : chalk.green('0');
            const fanInStr = `${rowResult.maxPredicateFanIn}/${rowResult.avgPredicateFanIn}`;
            const fanOutStr = `${rowResult.maxPredicateFanOut}/${rowResult.avgPredicateFanOut}`;
            console.log(
                `${chalk.bold(shortPath.padEnd(25))} | ` +
                `${String(rowResult.importedModuleCount).padEnd(7)} | ` +
                `${fanInStr.padEnd(16)} | ` +
                `${fanOutStr.padEnd(17)} | ` +
                `${String(rowResult.declDependencyGraphDensity).padEnd(7)} | ` +
                `${String(rowResult.stronglyConnectedComponentsCount).padEnd(4)} | ` +
                `${String(rowResult.unusedDeclarationCount).padEnd(6)} | ` +
                `${String(rowResult.highlyCoupledFactCount).padEnd(13)} | ` +
                `${chalk.magenta.bold(rowResult.topCentralSignature.padEnd(11))} | ` +
                `${chalk.magenta.bold(rowResult.topCentralPredicate.padEnd(12))} | ` +
                `${errStr}`
            );
        }

        results.push(rowResult);

        // Memory cleanup
        services.shared.workspace.IndexManager.remove(uri);
        services.shared.workspace.LangiumDocuments.deleteDocument(uri);
    }

    if (format === 'table') {
        console.log(chalk.bold('-----------------------------------------------------------------------------------------------------------------------------------\n'));
        console.log(chalk.bold('=== MODULARITY & COUPLING RESEARCH SUMMARY ==='));
        console.log(`📁 Total Models Analyzed:             ${results.length}`);
        console.log(`📦 Total Imported Modules:           ${results.reduce((s, r) => s + r.importedModuleCount, 0)}`);
        console.log(`🌐 Total Cross-Module References:    ${results.reduce((s, r) => s + r.crossModuleReferenceCount, 0)}`);
        console.log(`🕸️ Avg Graph Density:                 ${results.length > 0 ? (results.reduce((s, r) => s + r.declDependencyGraphDensity, 0) / results.length).toFixed(3) : 0}`);
        console.log(`🔄 Total Recursive SCCs:             ${results.reduce((s, r) => s + r.stronglyConnectedComponentsCount, 0)}`);
        console.log(`⚡ Total Highly Coupled Facts:       ${results.reduce((s, r) => s + r.highlyCoupledFactCount, 0)}`);
    }

    if (format === 'json') {
        const outputString = JSON.stringify(results, null, 2);
        console.log(outputString);
        if (options.output) {
            fs.writeFileSync(options.output, outputString, 'utf-8');
        }
    }
}

// Automatically run analyzeModularityAction when called directly from CLI
if (process.argv[1]?.includes('modularity-analyzer-cli')) {
    const args = process.argv.slice(2);
    const formatIdx = args.indexOf('--format');
    const format = formatIdx !== -1 ? args[formatIdx + 1] : undefined;
    const outputIdx = args.indexOf('--output');
    const output = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
    const includeImported = args.includes('--include-imported');

    const filePaths = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]?.startsWith('--')));

    if (filePaths.length > 0) {
        analyzeModularityAction(filePaths, { format, output, includeImported }).catch(err => {
            console.error(err);
            process.exit(1);
        });
    } else {
        console.log('Usage: npx tsx scripts/analysis/modularity-analyzer-cli.ts <path-to-als-file-or-directory> [--include-imported] [--format json|csv|table] [--output <filepath>]');
    }
}
