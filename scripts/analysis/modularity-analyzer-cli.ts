import type { AlloyModule } from 'alloy-language';
import { createAlloyServices } from 'alloy-language';
import { NodeFileSystem } from 'langium/node';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDocuments, findAlloyFiles } from '../../packages/cli/src/util.js';
import { isAstNode } from 'langium';

export interface ModularityMetrics {
    filePath: string;
    fileSize: number;
    lineCount: number;
    importedModuleCount: number;
    crossModuleReferenceCount: number;
    maxPredicateFanIn: number;
    avgPredicateFanIn: number;
    maxPredicateFanOut: number;
    avgPredicateFanOut: number;
    declDependencyGraphDensity: number;
    stronglyConnectedComponentsCount: number;
    maxSccSize: number;
    unusedDeclarationCount: number;
    highlyCoupledFactCount: number;
    maxFactCoupling: number;
    topCentralSignature: string;
    topCentralPredicate: string;
    maxDegreeCentrality: number;
    parseSuccessful: boolean;
    errorCount: number;
}

export function analyzeModularityAndCoupling(ast: AlloyModule, document: any): Omit<ModularityMetrics, 'filePath' | 'fileSize' | 'lineCount' | 'parseSuccessful' | 'errorCount'> {
    const importedModuleCount = ast.import?.length ?? 0;

    // Collect all declarations in this module
    const declarations = new Map<string, any>(); // key -> AST node
    const declKind = new Map<string, string>(); // key -> 'sig' | 'field' | 'pred' | 'fun' | 'fact' | 'assert'

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

    // Traverse nodes to collect references & dependencies
    const dependencyAdj = new Map<string, Set<string>>();
    const incomingRefs = new Map<string, number>();
    for (const key of declarations.keys()) {
        dependencyAdj.set(key, new Set());
        incomingRefs.set(key, 0);
    }

    let crossModuleReferenceCount = 0;
    const currentDocUri = document.uri.toString();

    // Walk AST of each declaration to build call/dependency graph
    for (const [declKey, declNode] of declarations.entries()) {
        function findReferences(node: any, visited = new Set()) {
            if (!node || typeof node !== 'object' || visited.has(node)) return;
            visited.add(node);

            // Cross-reference via Langium ref
            if (node.ref) {
                const targetRef = node.ref;
                if (targetRef.ref) {
                    const targetNode = targetRef.ref;
                    const targetName = targetNode.name;

                    // Check cross-module reference
                    if (targetNode.$document && targetNode.$document.uri.toString() !== currentDocUri) {
                        crossModuleReferenceCount++;
                    }

                    if (targetName && declarations.has(targetName) && targetName !== declKey) {
                        dependencyAdj.get(declKey)?.add(targetName);
                        incomingRefs.set(targetName, (incomingRefs.get(targetName) || 0) + 1);
                    }
                }
            } else if (node.id?.ref?.name || node.qualName?.ref?.name) {
                const refName = node.id?.ref?.name || node.qualName?.ref?.name;
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

    // Call Graph metrics for Predicates/Functions
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

    // Strongly Connected Components (Tarjan's algorithm)
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
    const stronglyConnectedComponentsCount = sccs.filter(s => s.length > 1).length; // Only non-trivial cycles
    const maxSccSize = sccSizes.length > 0 ? Math.max(...sccSizes) : 0;

    // Unused Declarations (declarations with 0 incoming references)
    let unusedDeclarationCount = 0;
    for (const [key, kind] of declKind.entries()) {
        if (kind === 'sig' || kind === 'field' || kind === 'pred' || kind === 'fun') {
            const count = incomingRefs.get(key) || 0;
            if (count === 0 && !key.toLowerCase().includes('main') && !key.toLowerCase().includes('run')) {
                unusedDeclarationCount++;
            }
        }
    }

    // Highly Coupled Facts (facts referencing >= 3 distinct signatures/fields)
    let highlyCoupledFactCount = 0;
    let maxFactCoupling = 0;
    for (const [key, kind] of declKind.entries()) {
        if (kind === 'fact') {
            const refs = dependencyAdj.get(key)?.size || 0;
            if (refs > maxFactCoupling) maxFactCoupling = refs;
            if (refs >= 3) highlyCoupledFactCount++;
        }
    }

    // Centrality of Signatures and Predicates
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

export async function analyzeModularityAction(paths: string[], options: { format?: string; output?: string }): Promise<void> {
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

    const documents = await extractDocuments(allFiles, services);
    const results: ModularityMetrics[] = [];

    for (const document of documents) {
        const filePath = document.uri.fsPath;
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const lineCount = fileContent.split(/\r?\n/).length;

        const ast = document.parseResult?.value as AlloyModule;
        const metrics = analyzeModularityAndCoupling(ast, document);

        const parseErrors = document.parseResult?.parserErrors.length ?? 0;
        const validationErrors = (document.diagnostics ?? []).filter(d => d.severity === 1).length;
        const errorCount = parseErrors + validationErrors;

        results.push({
            filePath,
            fileSize: fileContent.length,
            lineCount,
            ...metrics,
            parseSuccessful: parseErrors === 0,
            errorCount
        });
    }

    const format = (options.format || 'table').toLowerCase();
    let outputString = '';

    if (format === 'json') {
        outputString = JSON.stringify(results, null, 2);
    } else if (format === 'csv') {
        const headers = [
            'filePath', 'lineCount', 'importedModuleCount', 'crossModuleReferenceCount',
            'maxPredicateFanIn', 'avgPredicateFanIn', 'maxPredicateFanOut', 'avgPredicateFanOut',
            'declDependencyGraphDensity', 'stronglyConnectedComponentsCount', 'maxSccSize',
            'unusedDeclarationCount', 'highlyCoupledFactCount', 'maxFactCoupling',
            'topCentralSignature', 'topCentralPredicate', 'maxDegreeCentrality', 'errorCount'
        ];
        const rows = results.map(r => headers.map(h => (r as any)[h]).join(','));
        outputString = [headers.join(','), ...rows].join('\n');
    } else {
        // Table view
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

        for (const r of results) {
            const shortPath = path.basename(r.filePath);
            const errStr = r.errorCount > 0 ? chalk.red(String(r.errorCount)) : chalk.green('0');
            const fanInStr = `${r.maxPredicateFanIn}/${r.avgPredicateFanIn}`;
            const fanOutStr = `${r.maxPredicateFanOut}/${r.avgPredicateFanOut}`;
            console.log(
                `${chalk.bold(shortPath.padEnd(25))} | ` +
                `${String(r.importedModuleCount).padEnd(7)} | ` +
                `${fanInStr.padEnd(16)} | ` +
                `${fanOutStr.padEnd(17)} | ` +
                `${String(r.declDependencyGraphDensity).padEnd(7)} | ` +
                `${String(r.stronglyConnectedComponentsCount).padEnd(4)} | ` +
                `${String(r.unusedDeclarationCount).padEnd(6)} | ` +
                `${String(r.highlyCoupledFactCount).padEnd(13)} | ` +
                `${chalk.magenta.bold(r.topCentralSignature.padEnd(11))} | ` +
                `${chalk.magenta.bold(r.topCentralPredicate.padEnd(12))} | ` +
                `${errStr}`
            );
        }
        console.log(chalk.bold('-----------------------------------------------------------------------------------------------------------------------------------\n'));

        console.log(chalk.bold('=== MODULARITY & COUPLING RESEARCH SUMMARY ==='));
        console.log(`📁 Total Models Analyzed:             ${results.length}`);
        console.log(`📦 Total Imported Modules:           ${results.reduce((s, r) => s + r.importedModuleCount, 0)}`);
        console.log(`🌐 Total Cross-Module References:    ${results.reduce((s, r) => s + r.crossModuleReferenceCount, 0)}`);
        console.log(`🕸️ Avg Graph Density:                 ${(results.reduce((s, r) => s + r.declDependencyGraphDensity, 0) / results.length).toFixed(3)}`);
        console.log(`🔄 Total Recursive SCCs:             ${results.reduce((s, r) => s + r.stronglyConnectedComponentsCount, 0)}`);
        console.log(`⚡ Total Highly Coupled Facts:       ${results.reduce((s, r) => s + r.highlyCoupledFactCount, 0)}`);
    }

    if (format === 'json' || format === 'csv') {
        console.log(outputString);
    }

    if (options.output) {
        fs.writeFileSync(options.output, outputString || JSON.stringify(results, null, 2), 'utf-8');
        console.log(chalk.green(`\n✔ Results saved to ${options.output}`));
    }
}

// Direct CLI Invocation
if (process.argv[1]?.includes('modularity-analyzer-cli')) {
    const args = process.argv.slice(2);
    const formatIdx = args.indexOf('--format');
    const format = formatIdx !== -1 ? args[formatIdx + 1] : undefined;
    const outputIdx = args.indexOf('--output');
    const output = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

    const filePaths = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]?.startsWith('--')));

    if (filePaths.length > 0) {
        analyzeModularityAction(filePaths, { format, output }).catch(err => {
            console.error(err);
            process.exit(1);
        });
    } else {
        console.log('Usage: npx tsx scripts/analysis/modularity-analyzer-cli.ts <path-to-als-file-or-directory> [--format json|csv|table] [--output <filepath>]');
    }
}
