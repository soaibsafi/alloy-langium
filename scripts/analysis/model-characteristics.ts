/**
 * @file model-characteristics.ts
 * @description Modular Analyzer for Extracting Empirical Model Characteristics & Structural Metrics from Alloy Specifications.
 * 
 * This module provides both a programmatic API and a command-line interface (CLI) to compute
 * detailed empirical characteristics of Alloy specifications, including file stats, declaration counts,
 * expression frequencies, call graphs, and structural AST distribution metrics (max, median, average).
 * 
 * Features:
 * - Fully modular architecture via `CharacteristicExtractor` functions.
 * - `--include-imported` flag / `includeImported` option to toggle whether imported standard module calls are counted.
 * - Programmatic API suitable for Node.js/TypeScript imports or Python subprocess invocation.
 * - CLI support for formatted tables, JSON, and CSV export.
 */

import type { AlloyModule } from 'alloy-language';
import { createAlloyServices } from 'alloy-language';
import { NodeFileSystem } from 'langium/node';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { isAstNode, URI, AstUtils, type Reference } from 'langium';
import { findAlloyFiles } from '../../packages/cli/src/util.js';

/**
 * Interface representing all empirical metrics extracted from an Alloy specification.
 */
export interface ModelCharacteristics {
    /** File path of the analyzed specification */
    filePath: string;
    /** Total number of raw lines in the file */
    modelLength: number;
    /** Number of non-empty code lines (excluding comments and blank lines) */
    lineCount: number;
    /** Number of comment lines (single-line //, --, or multi-line block comments) */
    commentsCount: number;
    /** Execution time taken to parse the specification (in milliseconds) */
    parseTime: number;
    /** Execution time taken by the Langium document builder & validation engine (in milliseconds) */
    validationTime: number;
    /** True if the document parsed without syntax/parser errors */
    parseSuccessful: boolean;
    /** Total count of syntax parser errors + semantic validation errors */
    errorCount: number;

    // --- Signature Counts ---
    /** Total number of signatures declared in the specification */
    sigCount: number;
    /** Number of top-level signatures (not extending or subsetting another signature) */
    topLevelSigCount: number;
    /** Number of subset signatures declared with `in` (e.g., `sig A in B`) */
    subsetSigCount: number;
    /** Number of extending signatures declared with `extends` (e.g., `sig A extends B`) */
    extendsSigCount: number;
    /** Number of signatures with `one` multiplicity (`one sig A`) */
    oneSigCount: number;
    /** Number of signatures with `lone` multiplicity (`lone sig A`) */
    loneSigCount: number;
    /** Number of signatures with `some` multiplicity (`some sig A`) */
    someSigCount: number;
    /** Number of abstract signatures declared with `abstract` */
    abstractSigCount: number;
    /** Number of dynamic/mutable signatures declared with `var` in temporal models */
    varSigCount: number;
    
    // --- Field Counts ---
    /** Total number of field declarations inside signatures */
    fieldCount: number;
    /** Number of signatures containing at least one field */
    sigWithFieldCount: number;
    /** Number of dynamic/mutable fields declared with `var` */
    varFieldCount: number;

    // --- Enum Counts ---
    /** Total number of enum declarations (`enum Name { ... }`) */
    enumCount: number;

    // --- Fact Counts ---
    /** Number of standalone fact blocks (`fact { ... }` or `fact Name { ... }`) */
    factCount: number;
    /** Number of inline signature facts declared inside signature bodies */
    sigFactCount: number;
    
    // --- Predicate Metrics ---
    /** Number of predicate declarations (`pred name[...] { ... }`) */
    predDeclCount: number;
    /** Total count of predicate calls/invocations across the specification */
    predCallCount: number;

    // --- Function Metrics ---
    /** Number of function declarations (`fun name[...]: Type { ... }`) */
    funcDeclCount: number;
    /** Total count of function calls/invocations across the specification */
    funcCallCount: number;

    // --- Assertion Metrics ---
    /** Number of assertion declarations (`assert name { ... }`) */
    assertDeclCount: number;
    /** Number of assertion checks executed by `check` commands */
    assertCheckCount: number;
    
    // --- Command Counts ---
    /** Number of `run` commands in the specification */
    runCommandCount: number;
    /** Number of `check` commands in the specification */
    checkCommandCount: number;

    // --- Temporal & Variable Metrics ---
    /** Total occurrences of temporal operators (`always`, `eventually`, `after`, `before`, `until`, etc.) */
    temporalOperatorCount: number;
    /** Total count of `var` keywords across signatures, fields, and variable declarations */
    varCount: number;

    // --- Expression & Module Metrics ---
    /** Number of set cardinality expressions (`#A`) */
    setCardinalityCount: number;
    /** Number of transitive closure expressions (`^A`, `*A`, `.^A`, `.*A`) */
    transitiveClosureCount: number;
    /** Number of `open` statements importing user-defined modules */
    openUserDefinedCount: number;
    /** Number of `open` statements importing built-in standard modules (`util/ordering`, `util/boolean`, etc.) */
    openBuiltinCount: number;
    
    // --- Structural AST Distribution Metrics ---
    /** Maximum AST tree depth from module root to any leaf node */
    maxAstDepth: number;
    /** Median AST tree depth across all leaf paths */
    medianAstDepth: number;
    /** Average AST tree depth across all leaf paths */
    avgAstDepth: number;

    // --- Quantifier Nesting Distribution ---
    /** Maximum nesting depth of quantifiers (`all`, `some`, `no`, `lone`, `one`, `sum`, `{...}`) */
    maxQuantifierNesting: number;
    /** Median nesting depth of quantifiers */
    medianQuantifierNesting: number;
    /** Average nesting depth of quantifiers */
    avgQuantifierNesting: number;

    // --- Temporal Operator Nesting Distribution ---
    /** Maximum nesting depth of temporal operators */
    maxTemporalNesting: number;
    /** Median nesting depth of temporal operators */
    medianTemporalNesting: number;
    /** Average nesting depth of temporal operators */
    avgTemporalNesting: number;

    // --- Implication Nesting Distribution ---
    /** Maximum nesting depth of implications (`=>`, `implies`, `<=>`, `iff`) */
    maxImplicationNesting: number;
    /** Median nesting depth of implications */
    medianImplicationNesting: number;
    /** Average nesting depth of implications */
    avgImplicationNesting: number;
    
    // --- Join Chain Length Distribution ---
    /** Maximum length of relational join chains (e.g., `a.b.c.d`) */
    maxJoinChainLength: number;
    /** Median length of relational join chains */
    medianJoinChainLength: number;
    /** Average length of relational join chains */
    avgJoinChainLength: number;
}

/**
 * Context object passed to each modular characteristic extractor.
 * Provides access to the file path, content, Langium document, parsed AST, and configuration flags.
 */
export interface ExtractionContext {
    /** File path of the model specification */
    filePath: string;
    /** Raw source code content of the model file */
    fileContent: string;
    /** Parsed Langium Document object */
    document: any;
    /** Root AST node (`AlloyModule`) */
    ast: AlloyModule;
    /** Parse duration in milliseconds */
    parseTime: number;
    /** Validation duration in milliseconds */
    validationTime: number;
    /** If true, include calls/references to external/built-in imported modules (default: false) */
    includeImported: boolean;
}

/**
 * Interface for modular characteristic extractors.
 * Allows adding or removing custom metrics extractors independently.
 */
export interface CharacteristicExtractor {
    /** Unique name of the extractor */
    name: string;
    /** Function that receives the extraction context and returns a partial set of metrics */
    extract: (context: ExtractionContext) => Partial<ModelCharacteristics>;
}

/** Set of recognized temporal operator keywords in Electrum / Alloy 6 */
const TEMPORAL_KEYWORDS = new Set([
    'always', 'eventually', 'after', 'before', 'historically',
    'once', 'until', 'releases', 'since', 'triggered'
]);

/**
 * Helper utility to calculate maximum, median, and average values from a numerical dataset.
 * 
 * @param arr Array of numerical values
 * @returns Object containing rounded max, median, and avg metrics
 */
function calcStats(arr: number[]): { max: number; median: number; avg: number } {
    if (arr.length === 0) return { max: 0, median: 0, avg: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const max = sorted[sorted.length - 1];
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = Math.round((sum / sorted.length) * 100) / 100;

    let median = 0;
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        median = Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
    } else {
        median = sorted[mid];
    }
    return { max, median, avg };
}

/**
 * Extractor 1: Basic File, Line, Comment, and Parser Timing Metrics.
 */
export function extractFileMetrics(ctx: ExtractionContext): Partial<ModelCharacteristics> {
    const lines = ctx.fileContent.split(/\r?\n/);
    const modelLength = lines.length;
    let commentsCount = 0;
    let codeLinesCount = 0;
    let inMultiComment = false;

    lines.forEach(line => {
        const trimmed = line.trim();
        if (inMultiComment) {
            commentsCount++;
            if (trimmed.includes('*/')) inMultiComment = false;
        } else if (trimmed.startsWith('/*')) {
            commentsCount++;
            if (!trimmed.endsWith('*/') || trimmed === '/*') inMultiComment = true;
        } else if (trimmed.startsWith('//') || trimmed.startsWith('--')) {
            commentsCount++;
        } else if (trimmed.length > 0) {
            codeLinesCount++;
        }
    });

    const parseErrors = ctx.document.parseResult?.parserErrors.length ?? 0;
    const validationErrors = (ctx.document.diagnostics ?? []).filter((d: any) => d.severity === 1).length;

    return {
        filePath: ctx.filePath,
        modelLength,
        lineCount: codeLinesCount,
        commentsCount,
        parseTime: ctx.parseTime,
        validationTime: ctx.validationTime,
        parseSuccessful: parseErrors === 0,
        errorCount: parseErrors + validationErrors
    };
}

/**
 * Extractor 2: Signature Declarations and Multiplicity Metrics.
 */
export function extractSigMetrics(ctx: ExtractionContext): Partial<ModelCharacteristics> {
    let sigCount = 0;
    let topLevelSigCount = 0;
    let subsetSigCount = 0;
    let extendsSigCount = 0;
    let oneSigCount = 0;
    let loneSigCount = 0;
    let someSigCount = 0;
    let abstractSigCount = 0;
    let varSigCount = 0;

    function processSig(s: any) {
        sigCount++;
        const ext = s.sigExt;
        if (!ext) {
            topLevelSigCount++;
        } else if (ext.keyword === 'extends') {
            extendsSigCount++;
        } else if (ext.keyword === 'in') {
            subsetSigCount++;
        } else {
            topLevelSigCount++;
        }

        if (s.mult === 'one' || s.isOne) oneSigCount++;
        else if (s.mult === 'lone' || s.isLone) loneSigCount++;
        else if (s.mult === 'some' || s.isSome) someSigCount++;

        const prefix = s.$cstNode?.text.substring(0, s.$cstNode.text.indexOf('sig')) || '';
        if (s.abstract || s.isAbstract || prefix.includes('abstract')) abstractSigCount++;
        if (s.var || s.isVar || prefix.includes('var')) varSigCount++;
    }

    if (ctx.ast?.paragraph) {
        for (const p of ctx.ast.paragraph) {
            if (p.$type === 'SigDecl') {
                processSig(p);
                if (p.additionalSigs) {
                    for (const add of p.additionalSigs) {
                        // Inherit properties from parent SigDecl
                        add.sigExt = p.sigExt;
                        add.mult = p.mult;
                        add.isOne = p.isOne;
                        add.isLone = p.isLone;
                        add.isSome = p.isSome;
                        add.abstract = p.abstract;
                        add.isAbstract = p.isAbstract;
                        add.var = p.var;
                        add.isVar = p.isVar;
                        if (!add.$cstNode) add.$cstNode = p.$cstNode;
                        
                        processSig(add);
                    }
                }
            }
        }
    }

    return {
        sigCount,
        topLevelSigCount,
        subsetSigCount,
        extendsSigCount,
        oneSigCount,
        loneSigCount,
        someSigCount,
        abstractSigCount,
        varSigCount
    };
}

/**
 * Extractor 3: Signature Fields and Mutable Field Metrics.
 */
export function extractFieldMetrics(ctx: ExtractionContext): Partial<ModelCharacteristics> {
    let fieldCount = 0;
    let sigWithFieldCount = 0;
    let varFieldCount = 0;

    if (ctx.ast?.paragraph) {
        for (const p of ctx.ast.paragraph) {
            if (p.$type === 'SigDecl') {
                if (p.fields && p.fields.length > 0) {
                    sigWithFieldCount++;
                    for (const f of p.fields) {
                        let count = 1;
                        if (f.decl && f.decl.additionalNames) {
                            count += f.decl.additionalNames.length;
                        }
                        fieldCount += count;
                        
                        const fPrefix = f.$cstNode?.text.substring(0, 10) || '';
                        if ((f as any).var || (f as any).isVar || fPrefix.includes('var')) {
                            varFieldCount += count;
                        }
                    }
                }
            }
        }
    }

    return {
        fieldCount,
        sigWithFieldCount,
        varFieldCount
    };
}

/**
 * Extractor 4: Enum Declaration Metrics.
 */
export function extractEnumMetrics(ctx: ExtractionContext): Partial<ModelCharacteristics> {
    let enumCount = 0;
    if (ctx.ast?.paragraph) {
        for (const p of ctx.ast.paragraph) {
            if (p.$type === 'EnumDecl') {
                enumCount++;
            }
        }
    }
    return { enumCount };
}

/**
 * Extractor 5: Standalone and Signature Inline Fact Metrics.
 */
export function extractFactMetrics(ctx: ExtractionContext): Partial<ModelCharacteristics> {
    let factCount = 0;
    let sigFactCount = 0;

    if (ctx.ast?.paragraph) {
        for (const p of ctx.ast.paragraph) {
            if (p.$type === 'FactDecl') {
                factCount++;
            } else if (p.$type === 'SigDecl') {
                if ((p as any).sigFacts) {
                    sigFactCount += (p as any).sigFacts.length;
                } else if (p.block) {
                    sigFactCount += 1;
                }
            }
        }
    }

    return {
        factCount,
        sigFactCount
    };
}

/**
 * Extractor 6: Predicates, Functions, Assertions, Commands, and Call References.
 * Respects `ctx.includeImported` flag to include or exclude external/built-in module calls.
 */
export function extractPredFuncAssertCmdMetrics(ctx: ExtractionContext): Partial<ModelCharacteristics> {
    let predDeclCount = 0;
    let predCallCount = 0;
    let funcDeclCount = 0;
    let funcCallCount = 0;
    let assertDeclCount = 0;
    let assertCheckCount = 0;
    let runCommandCount = 0;
    let checkCommandCount = 0;

    if (ctx.ast?.paragraph) {
        for (const p of ctx.ast.paragraph) {
            if (p.$type === 'PredDecl') {
                predDeclCount++;
            } else if (p.$type === 'FunDecl') {
                funcDeclCount++;
            } else if (p.$type === 'AssertDecl') {
                assertDeclCount++;
            } else if (p.$type === 'CmdDecl') {
                if (p.kind === 'run') runCommandCount++;
                else if (p.kind === 'check') {
                    checkCommandCount++;
                    if (p.predicate || p.name) assertCheckCount++;
                }
            }
        }

        // Count exact calls/references via Langium's AstUtils
        if (ctx.ast) {
            const currentDocUri = ctx.document.uri.toString();
            for (const node of AstUtils.streamAllContents(ctx.ast)) {
                for (const refInfo of AstUtils.streamReferences(node)) {
                    const ref = refInfo.reference as Reference;
                    const target = ref?.ref;
                    if (target) {
                        const targetDoc = AstUtils.getDocument(target);
                        const targetDocUri = targetDoc?.uri?.toString();
                        const isImported = Boolean(targetDocUri && targetDocUri !== currentDocUri);
                        if (!ctx.includeImported && isImported) {
                            continue; // Skip imported targets when includeImported is false
                        }
                        const targetType = target.$type;
                        if (targetType === 'PredDecl') {
                            predCallCount++;
                        } else if (targetType === 'FunDecl') {
                            funcCallCount++;
                        }
                    }
                }
            }
        }
    }

    return {
        predDeclCount,
        predCallCount,
        funcDeclCount,
        funcCallCount,
        assertDeclCount,
        assertCheckCount,
        runCommandCount,
        checkCommandCount
    };
}

/**
 * Extractor 7: Temporal Operator Occurrences and Variable Keyword Metrics.
 */
export function extractTemporalAndVarMetrics(ctx: ExtractionContext): Partial<ModelCharacteristics> {
    let temporalOperatorCount = 0;
    let varCount = 0;

    function countTempAndVar(node: any, visited = new Set()) {
        if (!node || typeof node !== 'object' || visited.has(node)) return;
        visited.add(node);

        const type = node.$type;
        if (node.isVar || node.var) varCount++;

        if (type === 'BinaryTemporalExpr') {
            temporalOperatorCount++;
        } else if (type === 'UnaryLogicalExpr') {
            let nodeText = node.$cstNode?.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|--[^\n\r]*/g, '').trim() || '';
            let prefix = nodeText.split(/[\s(]+/)[0];
            if (TEMPORAL_KEYWORDS.has(prefix) || (typeof node.op === 'string' && TEMPORAL_KEYWORDS.has(node.op))) {
                temporalOperatorCount++;
            }
        }

        for (const k in node) {
            if (Object.prototype.hasOwnProperty.call(node, k) && !k.startsWith('$') && k !== 'container') {
                const val = node[k];
                if (Array.isArray(val)) val.forEach(v => countTempAndVar(v, visited));
                else if (typeof val === 'object') countTempAndVar(val, visited);
            }
        }
    }

    if (ctx.ast) countTempAndVar(ctx.ast);

    return {
        temporalOperatorCount,
        varCount
    };
}

/**
 * Extractor 8: Set Cardinality (`#`), Transitive Closures (`^`, `*`), and Module Imports.
 */
export function extractOtherExprMetrics(ctx: ExtractionContext): Partial<ModelCharacteristics> {
    let setCardinalityCount = 0;
    let transitiveClosureCount = 0;
    let openUserDefinedCount = 0;
    let openBuiltinCount = 0;

    if (ctx.ast?.import) {
        for (const imp of ctx.ast.import) {
            let pathStr = '';
            if (imp.qualName) {
                if (typeof imp.qualName === 'string') pathStr = imp.qualName;
                else if (imp.qualName.names) pathStr = [...imp.qualName.names, imp.qualName.name].filter(Boolean).join('/');
                else if (imp.qualName.name) pathStr = imp.qualName.name;
            }
            if (pathStr.startsWith('util/') || pathStr.startsWith('util')) {
                openBuiltinCount++;
            } else {
                openUserDefinedCount++;
            }
        }
    }

    function countOtherExpr(node: any, visited = new Set()) {
        if (!node || typeof node !== 'object' || visited.has(node)) return;
        visited.add(node);

        const type = node.$type;
        
        let nodeText = '';
        if (node.$cstNode) {
            nodeText = node.$cstNode.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|--[^\n\r]*/g, '').trim();
        }

        if (type === 'CardinalityExpr' || node.op === '#') {
            setCardinalityCount++;
        }

        if (type === 'UnaryExpr' && (nodeText.startsWith('^') || nodeText.startsWith('*') || node.op === '^' || node.op === '*')) {
            transitiveClosureCount++;
        }

        if (type === 'DotJoinExpr') {
            let remaining = nodeText;
            if (node.left && node.left.$cstNode && node.$cstNode) {
                remaining = node.$cstNode.text.substring(node.left.$cstNode.text.length)
                    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|--[^\n\r]*/g, '').trim();
            }
            if (remaining.startsWith('.^') || remaining.startsWith('.*') || node.op === '.^' || node.op === '.*') {
                transitiveClosureCount++;
            }
        }

        for (const k in node) {
            if (Object.prototype.hasOwnProperty.call(node, k) && !k.startsWith('$') && k !== 'container') {
                const val = node[k];
                if (Array.isArray(val)) val.forEach(v => countOtherExpr(v, visited));
                else if (typeof val === 'object') countOtherExpr(val, visited);
            }
        }
    }

    if (ctx.ast) countOtherExpr(ctx.ast);

    return {
        setCardinalityCount,
        transitiveClosureCount,
        openUserDefinedCount,
        openBuiltinCount
    };
}

/**
 * Extractor 9: Structural AST Depths, Quantifiers, Temporal & Implication Nesting Distributions.
 */
export function extractStructuralMetrics(ctx: ExtractionContext): Partial<ModelCharacteristics> {
    const astDepths: number[] = [];
    const quantNestings: number[] = [];
    const tempNestings: number[] = [];
    const implNestings: number[] = [];
    const joinChainLengths: number[] = [];

    function walk(
        node: any,
        depth: number,
        quantN: number,
        tempN: number,
        implN: number,
        visited = new Set()
    ): number {
        if (!node || typeof node !== 'object' || visited.has(node)) return depth;
        visited.add(node);

        let currQuantN = quantN;
        let currTempN = tempN;
        let currImplN = implN;

        const type = node.$type;

        if (type === 'QuantExpr' || type === 'SetExpr') {
            currQuantN++;
            quantNestings.push(currQuantN);
        }

        let isTemp = type === 'BinaryTemporalExpr';
        if (type === 'UnaryLogicalExpr') {
            let nodeText = node.$cstNode?.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|--[^\n\r]*/g, '').trim() || '';
            let prefix = nodeText.split(/[\s(]+/)[0];
            if (TEMPORAL_KEYWORDS.has(prefix) || (typeof node.op === 'string' && TEMPORAL_KEYWORDS.has(node.op))) {
                isTemp = true;
            }
        }
        if (isTemp) {
            currTempN++;
            tempNestings.push(currTempN);
        }

        if (type === 'ImplicationExpr' || type === 'BiImplicationExpr') {
            currImplN++;
            implNestings.push(currImplN);
        }

        if (type === 'DotJoinExpr') {
            let chainLen = 1;
            let curr = node;
            while (curr && curr.$type === 'DotJoinExpr') {
                chainLen++;
                curr = curr.right;
            }
            joinChainLengths.push(chainLen);
        }

        let maxChildDepth = depth;
        let isLeaf = true;

        for (const k in node) {
            if (Object.prototype.hasOwnProperty.call(node, k) && !k.startsWith('$') && k !== 'container') {
                const val = node[k];
                if (Array.isArray(val)) {
                    for (const item of val) {
                        if (item && typeof item === 'object' && isAstNode(item)) {
                            isLeaf = false;
                            const d = walk(item, depth + 1, currQuantN, currTempN, currImplN, visited);
                            if (d > maxChildDepth) maxChildDepth = d;
                        }
                    }
                } else if (val && typeof val === 'object' && isAstNode(val)) {
                    isLeaf = false;
                    const d = walk(val, depth + 1, currQuantN, currTempN, currImplN, visited);
                    if (d > maxChildDepth) maxChildDepth = d;
                }
            }
        }

        if (isLeaf) {
            astDepths.push(depth);
        }

        return maxChildDepth;
    }

    if (ctx.ast) walk(ctx.ast, 1, 0, 0, 0);

    const astStats = calcStats(astDepths);
    const quantStats = calcStats(quantNestings);
    const tempStats = calcStats(tempNestings);
    const implStats = calcStats(implNestings);
    const joinStats = calcStats(joinChainLengths);

    return {
        maxAstDepth: astStats.max,
        medianAstDepth: astStats.median,
        avgAstDepth: astStats.avg,

        maxQuantifierNesting: quantStats.max,
        medianQuantifierNesting: quantStats.median,
        avgQuantifierNesting: quantStats.avg,

        maxTemporalNesting: tempStats.max,
        medianTemporalNesting: tempStats.median,
        avgTemporalNesting: tempStats.avg,

        maxImplicationNesting: implStats.max,
        medianImplicationNesting: implStats.median,
        avgImplicationNesting: implStats.avg,

        maxJoinChainLength: joinStats.max,
        medianJoinChainLength: joinStats.median,
        avgJoinChainLength: joinStats.avg
    };
}

/**
 * Array of default characteristic extractors executed during model analysis.
 * Users can easily add or remove custom extractors to extend analysis capabilities.
 */
export const DEFAULT_EXTRACTORS: CharacteristicExtractor[] = [
    { name: 'fileMetrics', extract: extractFileMetrics },
    { name: 'sigMetrics', extract: extractSigMetrics },
    { name: 'fieldMetrics', extract: extractFieldMetrics },
    { name: 'enumMetrics', extract: extractEnumMetrics },
    { name: 'factMetrics', extract: extractFactMetrics },
    { name: 'predFuncAssertCmdMetrics', extract: extractPredFuncAssertCmdMetrics },
    { name: 'temporalAndVarMetrics', extract: extractTemporalAndVarMetrics },
    { name: 'otherExprMetrics', extract: extractOtherExprMetrics },
    { name: 'structuralMetrics', extract: extractStructuralMetrics }
];

/**
 * Programmatic API to analyze a single model file or raw source content string.
 * Suitable for direct import into TypeScript/JavaScript modules or calling from Python subprocesses.
 * 
 * @param filePath Path to the Alloy specification file
 * @param fileContent Optional source code content string (if omitted, read from file)
 * @param options Configuration options (`includeImported`, custom `extractors`)
 * @returns Promise resolving to the complete ModelCharacteristics object
 */
export async function analyzeModel(
    filePath: string,
    fileContent?: string,
    options: {
        includeImported?: boolean;
        extractors?: CharacteristicExtractor[];
    } = {}
): Promise<ModelCharacteristics> {
    const { includeImported = false, extractors = DEFAULT_EXTRACTORS } = options;

    const alloyServices = createAlloyServices(NodeFileSystem);
    await alloyServices.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const services = alloyServices.Alloy;

    const content = fileContent ?? fs.readFileSync(filePath, 'utf-8');
    const uri = URI.file(path.resolve(filePath));

    const parseStart = performance.now();
    const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(uri);
    const parseTime = Math.round((performance.now() - parseStart) * 100) / 100;

    const valStart = performance.now();
    await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
    const validationTime = Math.round((performance.now() - valStart) * 100) / 100;

    const ast = document.parseResult?.value as AlloyModule;
    const ctx: ExtractionContext = {
        filePath,
        fileContent: content,
        document,
        ast,
        parseTime,
        validationTime,
        includeImported
    };

    let result: Partial<ModelCharacteristics> = {};
    for (const ext of extractors) {
        const partial = ext.extract(ctx);
        result = { ...result, ...partial };
    }

    return result as ModelCharacteristics;
}

/**
 * Programmatic & CLI Runner function to analyze multiple files or directories.
 * 
 * @param paths Array of file paths or directory paths to analyze
 * @param options Output format ('table', 'json', 'csv'), output file path, includeImported flag, and custom extractors
 * @returns Promise resolving to an array of ModelCharacteristics
 */
export async function analyzeModels(
    paths: string[],
    options: { format?: string; output?: string; includeImported?: boolean; extractors?: CharacteristicExtractor[] } = {}
): Promise<ModelCharacteristics[]> {
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
        return [];
    }

    const { includeImported = false, extractors = DEFAULT_EXTRACTORS } = options;
    const results: ModelCharacteristics[] = [];

    for (const f of allFiles) {
        const metrics = await analyzeModel(f, undefined, { includeImported, extractors });
        results.push(metrics);
    }

    const format = (options.format || 'table').toLowerCase();
    let outputString = '';

    if (format === 'json') {
        outputString = JSON.stringify(results, null, 2);
    } else if (format === 'csv') {
        if (results.length > 0) {
            const headers = Object.keys(results[0]);
            const rows = results.map(r => headers.map(h => JSON.stringify((r as any)[h] ?? '')).join(','));
            outputString = [headers.join(','), ...rows].join('\n');
        }
    } else {
        // Formatted Console Table View
        console.log(chalk.bold('-----------------------------------------------------------------------------------------------------------------------------------------'));
        console.log(
            `${chalk.cyan.bold('File')} | ` +
            `${chalk.yellow('Lines')} | ` +
            `${chalk.yellow('Sigs')} | ` +
            `${chalk.yellow('Fields')} | ` +
            `${chalk.yellow('Facts')} | ` +
            `${chalk.yellow('Preds')} | ` +
            `${chalk.yellow('Funs')} | ` +
            `${chalk.yellow('Asserts')} | ` +
            `${chalk.yellow('Cmds')} | ` +
            `${chalk.magenta.bold('AST (Max/Med/Avg)')} | ` +
            `${chalk.green('Errors')}`
        );
        console.log(chalk.bold('-----------------------------------------------------------------------------------------------------------------------------------------'));

        for (const r of results) {
            const shortPath = path.basename(r.filePath);
            const errStr = r.errorCount > 0 ? chalk.red(String(r.errorCount)) : chalk.green('0');
            const astStr = `${r.maxAstDepth}/${r.medianAstDepth}/${r.avgAstDepth}`;
            console.log(
                `${chalk.bold(shortPath.padEnd(25))} | ` +
                `${String(r.modelLength).padEnd(5)} | ` +
                `${String(r.sigCount).padEnd(4)} | ` +
                `${String(r.fieldCount).padEnd(6)} | ` +
                `${String(r.factCount).padEnd(5)} | ` +
                `${String(r.predDeclCount).padEnd(5)} | ` +
                `${String(r.funcDeclCount).padEnd(4)} | ` +
                `${String(r.assertDeclCount).padEnd(7)} | ` +
                `${String(r.runCommandCount + r.checkCommandCount).padEnd(4)} | ` +
                `${chalk.magenta.bold(astStr.padEnd(17))} | ` +
                `${errStr}`
            );
        }
        console.log(chalk.bold('-----------------------------------------------------------------------------------------------------------------------------------------\n'));

        console.log(chalk.bold('=== MODEL CHARACTERISTICS SUMMARY ==='));
        console.log(`📁 Total Models Analyzed:     ${results.length}`);
        console.log(`🔷 Total Signatures:          ${results.reduce((s, r) => s + r.sigCount, 0)}`);
        console.log(`🌿 Total Fields:              ${results.reduce((s, r) => s + r.fieldCount, 0)}`);
        console.log(`📜 Total Facts:               ${results.reduce((s, r) => s + r.factCount, 0)}`);
        console.log(`🔶 Total Predicates:          ${results.reduce((s, r) => s + r.predDeclCount, 0)}`);
        console.log(`🌐 Included Imported Module Calls: ${includeImported ? 'YES' : 'NO (Local-only)'}`);
        console.log(`⏱️ Avg Parse Time:            ${(results.reduce((s, r) => s + r.parseTime, 0) / results.length).toFixed(2)} ms`);
    }

    if (format === 'json' || format === 'csv') {
        console.log(outputString);
    }

    if (options.output) {
        fs.writeFileSync(options.output, outputString || JSON.stringify(results, null, 2), 'utf-8');
        console.log(chalk.green(`\n✔ Results saved to ${options.output}`));
    }

    return results;
}

// Standalone CLI Execution Entry Point
if (process.argv[1]?.includes('model-characteristics')) {
    const args = process.argv.slice(2);
    const formatIdx = args.indexOf('--format');
    const format = formatIdx !== -1 ? args[formatIdx + 1] : undefined;
    const outputIdx = args.indexOf('--output');
    const output = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
    const includeImported = args.includes('--include-imported');

    const filePaths = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]?.startsWith('--')));

    if (filePaths.length > 0) {
        analyzeModels(filePaths, { format, output, includeImported }).catch(err => {
            console.error(err);
            process.exit(1);
        });
    } else {
        console.log('Usage: npx tsx scripts/analysis/model-characteristics.ts <path> [--include-imported] [--format json|csv|table] [--output <filepath>]');
    }
}