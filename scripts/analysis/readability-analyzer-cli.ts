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

export interface ReadabilityMetrics {
    filePath: string;
    fileSize: number;
    lineCount: number;
    commentLines: number;
    commentDensity: number;
    avgIdentifierLength: number;
    dominantNamingStyle: string;
    namingConsistencyPercentage: number;
    undocumentedDeclPercentage: number;
    unnamedFactRatio: number;
    duplicateExprCount: number;
    formattingConsistencyScore: number;
    parseSuccessful: boolean;
    errorCount: number;
}

export function analyzeReadabilityAndDocumentation(ast: AlloyModule, fileContent: string): Omit<ReadabilityMetrics, 'filePath' | 'fileSize' | 'lineCount' | 'parseSuccessful' | 'errorCount'> {
    const lines = fileContent.split(/\r?\n/);
    const lineCount = lines.length;

    // 1. Comment Density
    let commentLines = 0;
    let inMultiComment = false;

    lines.forEach(line => {
        const trimmed = line.trim();
        if (inMultiComment) {
            commentLines++;
            if (trimmed.includes('*/')) {
                inMultiComment = false;
            }
        } else if (trimmed.startsWith('/*')) {
            commentLines++;
            if (!trimmed.endsWith('*/') || trimmed === '/*') {
                inMultiComment = true;
            }
        } else if (trimmed.startsWith('//') || trimmed.startsWith('--')) {
            commentLines++;
        }
    });

    const commentDensity = lineCount > 0 ? Math.round((commentLines / lineCount) * 10000) / 100 : 0;

    // 2. Identifier Length & Naming Style Consistency
    const identifiers: string[] = [];
    let totalDeclarations = 0;
    let undocumentedDeclarations = 0;
    let namedFactCount = 0;
    let unnamedFactCount = 0;

    function getPrecedingComment(lineIdx: number): boolean {
        let curr = lineIdx - 1;
        while (curr >= 0) {
            const l = lines[curr].trim();
            if (l.length === 0) {
                curr--;
                continue;
            }
            if (l.startsWith('//') || l.startsWith('--') || l.endsWith('*/')) {
                return true;
            }
            break;
        }
        return false;
    }

    if (ast && ast.paragraph) {
        ast.paragraph.forEach((p: any, idx: number) => {
            const hasDoc = p.$cstNode ? getPrecedingComment(p.$cstNode.range.start.line) : false;

            switch (p.$type) {
                case 'SigDecl':
                    totalDeclarations++;
                    if (!hasDoc) undocumentedDeclarations++;
                    if (p.name) identifiers.push(p.name);
                    if (p.fields) {
                        p.fields.forEach((f: any) => {
                            if (f.decl?.name?.name) identifiers.push(f.decl.name.name);
                        });
                    }
                    break;
                case 'PredDecl':
                case 'FunDecl':
                    totalDeclarations++;
                    if (!hasDoc) undocumentedDeclarations++;
                    if (p.name) identifiers.push(p.name);
                    break;
                case 'FactDecl':
                    if (p.name) {
                        namedFactCount++;
                        identifiers.push(p.name);
                    } else {
                        unnamedFactCount++;
                    }
                    totalDeclarations++;
                    if (!hasDoc) undocumentedDeclarations++;
                    break;
                case 'AssertDecl':
                    totalDeclarations++;
                    if (!hasDoc) undocumentedDeclarations++;
                    if (p.name) identifiers.push(p.name);
                    break;
            }
        });
    }

    const totalFacts = namedFactCount + unnamedFactCount;
    const unnamedFactRatio = totalFacts > 0 ? Math.round((unnamedFactCount / totalFacts) * 100) / 100 : 0;
    const undocumentedDeclPercentage = totalDeclarations > 0 ? Math.round((undocumentedDeclarations / totalDeclarations) * 100) / 100 : 0;

    const avgIdentifierLength = identifiers.length > 0
        ? Math.round((identifiers.reduce((s, id) => s + id.length, 0) / identifiers.length) * 100) / 100
        : 0;

    // Naming Style Classifier
    let camelCount = 0;
    let pascalCount = 0;
    let snakeCount = 0;

    identifiers.forEach(id => {
        if (/^[a-z][a-zA-Z0-9]*$/.test(id) && /[A-Z]/.test(id)) camelCount++;
        else if (/^[A-Z][a-zA-Z0-9]*$/.test(id)) pascalCount++;
        else if (/^[a-z0-9_]+$/.test(id) && id.includes('_')) snakeCount++;
    });

    let dominantNamingStyle = 'Mixed';
    let maxStyleCount = Math.max(camelCount, pascalCount, snakeCount);
    if (maxStyleCount > 0) {
        if (maxStyleCount === camelCount) dominantNamingStyle = 'camelCase';
        else if (maxStyleCount === pascalCount) dominantNamingStyle = 'PascalCase';
        else if (maxStyleCount === snakeCount) dominantNamingStyle = 'snake_case';
    }

    const namingConsistencyPercentage = identifiers.length > 0
        ? Math.round((maxStyleCount / identifiers.length) * 100)
        : 100;

    // 3. Repeated / Duplicate Expression Detection
    const exprSubtrees = new Map<string, number>();
    function hashAstSubtree(node: any, visitedNodes = new Set()): string | null {
        if (!node || typeof node !== 'object' || visitedNodes.has(node)) return null;
        visitedNodes.add(node);

        if (node.$type && typeof node.$type === 'string' && node.$type.endsWith('Expr')) {
            const key = `${node.$type}:${node.$cstNode?.text || ''}`;
            if (key.length > 10) {
                exprSubtrees.set(key, (exprSubtrees.get(key) || 0) + 1);
            }
        }
        for (const k in node) {
            if (Object.prototype.hasOwnProperty.call(node, k) && !k.startsWith('$') && k !== 'container') {
                const val = node[k];
                if (Array.isArray(val)) {
                    val.forEach(item => {
                        if (item && typeof item === 'object' && isAstNode(item)) {
                            hashAstSubtree(item, visitedNodes);
                        }
                    });
                } else if (val && typeof val === 'object' && isAstNode(val)) {
                    hashAstSubtree(val, visitedNodes);
                }
            }
        }
        return null;
    }

    if (ast) hashAstSubtree(ast);

    let duplicateExprCount = 0;
    for (const [, count] of exprSubtrees.entries()) {
        if (count > 1) duplicateExprCount++;
    }

    // 4. Formatting Consistency (Indentation Uniformity)
    let space2 = 0;
    let space4 = 0;
    let tabs = 0;

    lines.forEach(line => {
        if (line.startsWith('\t')) tabs++;
        else if (line.startsWith('    ')) space4++;
        else if (line.startsWith('  ')) space2++;
    });

    const maxIndent = Math.max(space2, space4, tabs);
    const totalIndentLines = space2 + space4 + tabs;
    const formattingConsistencyScore = totalIndentLines > 0
        ? Math.round((maxIndent / totalIndentLines) * 100)
        : 100;

    return {
        commentLines,
        commentDensity,
        avgIdentifierLength,
        dominantNamingStyle,
        namingConsistencyPercentage,
        undocumentedDeclPercentage,
        unnamedFactRatio,
        duplicateExprCount,
        formattingConsistencyScore
    };
}

export async function analyzeReadabilityAction(paths: string[], options: { format?: string; output?: string }): Promise<void> {
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

    console.log(chalk.bold(`📖 Analyzing Readability and Documentation Quality for ${allFiles.length} File(s)...\n`));

    const format = (options.format || 'table').toLowerCase();

    if (format === 'csv') {
        const headers = [
            'filePath', 'lineCount', 'commentLines', 'commentDensity', 'avgIdentifierLength',
            'dominantNamingStyle', 'namingConsistencyPercentage', 'undocumentedDeclPercentage',
            'unnamedFactRatio', 'duplicateExprCount', 'formattingConsistencyScore', 'errorCount'
        ];
        const headerRow = headers.join(',');
        console.log(headerRow);
        if (options.output) fs.writeFileSync(options.output, headerRow + '\n', 'utf-8');
    } else if (format === 'table') {
        console.log(chalk.bold('-----------------------------------------------------------------------------------------------------------------------------------'));
        console.log(
            `${chalk.cyan.bold('File')} | ` +
            `${chalk.yellow('Lines')} | ` +
            `${chalk.yellow('Comment %')} | ` +
            `${chalk.yellow('Avg Id Len')} | ` +
            `${chalk.yellow('Naming Style')} | ` +
            `${chalk.yellow('Style %')} | ` +
            `${chalk.yellow('Undoc %')} | ` +
            `${chalk.yellow('Anon Facts')} | ` +
            `${chalk.magenta.bold('Dup Exprs')} | ` +
            `${chalk.magenta.bold('Format Score')} | ` +
            `${chalk.green('Errors')}`
        );
        console.log(chalk.bold('-----------------------------------------------------------------------------------------------------------------------------------'));
    }

    const results: ReadabilityMetrics[] = [];
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
        const metrics = analyzeReadabilityAndDocumentation(ast, fileContent);

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
                'filePath', 'lineCount', 'commentLines', 'commentDensity', 'avgIdentifierLength',
                'dominantNamingStyle', 'namingConsistencyPercentage', 'undocumentedDeclPercentage',
                'unnamedFactRatio', 'duplicateExprCount', 'formattingConsistencyScore', 'errorCount'
            ];
            const rowStr = headers.map(h => (rowResult as any)[h]).join(',');
            console.log(rowStr);
            if (options.output) fs.appendFileSync(options.output, rowStr + '\n', 'utf-8');
        } else if (format === 'table') {
            const shortPath = path.basename(rowResult.filePath);
            const errStr = rowResult.errorCount > 0 ? chalk.red(String(rowResult.errorCount)) : chalk.green('0');
            console.log(
                `${chalk.bold(shortPath.padEnd(25))} | ` +
                `${String(rowResult.lineCount).padEnd(5)} | ` +
                `${(String(rowResult.commentDensity) + '%').padEnd(9)} | ` +
                `${String(rowResult.avgIdentifierLength).padEnd(10)} | ` +
                `${rowResult.dominantNamingStyle.padEnd(12)} | ` +
                `${(String(rowResult.namingConsistencyPercentage) + '%').padEnd(7)} | ` +
                `${(String(rowResult.undocumentedDeclPercentage * 100) + '%').padEnd(7)} | ` +
                `${(String(rowResult.unnamedFactRatio * 100) + '%').padEnd(10)} | ` +
                `${chalk.magenta.bold(String(rowResult.duplicateExprCount).padEnd(9))} | ` +
                `${chalk.magenta.bold((String(rowResult.formattingConsistencyScore) + '%').padEnd(12))} | ` +
                `${errStr}`
            );
        }

        results.push(rowResult);

        // Deep cleanup memory
        services.shared.workspace.IndexManager.remove(uri);
        services.shared.workspace.LangiumDocuments.deleteDocument(uri);
    }

    if (format === 'table') {
        console.log(chalk.bold('-----------------------------------------------------------------------------------------------------------------------------------\n'));
        console.log(chalk.bold('=== READABILITY & DOCUMENTATION RESEARCH SUMMARY ==='));
        console.log(`📁 Total Models Analyzed:            ${results.length}`);
        console.log(`📝 Avg Comment Density:             ${results.length > 0 ? (results.reduce((s, r) => s + r.commentDensity, 0) / results.length).toFixed(2) : 0}%`);
        console.log(`🏷️ Avg Identifier Length:           ${results.length > 0 ? (results.reduce((s, r) => s + r.avgIdentifierLength, 0) / results.length).toFixed(2) : 0} chars`);
        console.log(`❓ Avg Undocumented Declarations:   ${results.length > 0 ? ((results.reduce((s, r) => s + r.undocumentedDeclPercentage, 0) / results.length) * 100).toFixed(1) : 0}%`);
        console.log(`⚠️ Avg Anonymous Facts Ratio:       ${results.length > 0 ? ((results.reduce((s, r) => s + r.unnamedFactRatio, 0) / results.length) * 100).toFixed(1) : 0}%`);
        console.log(`✨ Avg Formatting Consistency:      ${results.length > 0 ? (results.reduce((s, r) => s + r.formattingConsistencyScore, 0) / results.length).toFixed(1) : 0}%`);
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
if (process.argv[1]?.includes('readability-analyzer-cli')) {
    const args = process.argv.slice(2);
    const formatIdx = args.indexOf('--format');
    const format = formatIdx !== -1 ? args[formatIdx + 1] : undefined;
    const outputIdx = args.indexOf('--output');
    const output = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

    const filePaths = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]?.startsWith('--')));

    if (filePaths.length > 0) {
        analyzeReadabilityAction(filePaths, { format, output }).catch(err => {
            console.error(err);
            process.exit(1);
        });
    } else {
        console.log('Usage: npx tsx scripts/analysis/readability-analyzer-cli.ts <path-to-als-file-or-directory> [--format json|csv|table] [--output <filepath>]');
    }
}
