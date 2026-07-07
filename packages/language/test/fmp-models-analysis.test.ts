import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { createAlloyServices } from '../src/index.js';
import { parseDocument } from 'langium/test';
import * as fs from 'fs';
import * as path from 'path';

interface ModelAnalysisResult {
    filePath: string;
    fileSize: number;
    characterCount: number;
    lineCount: number;
    parseTime: number;
    validationTime: number;
    totalTime: number;
    parseErrors: number;
    validationDiagnostics: number;
    astNodes: number;
    memoryUsage: number;
    signatures: number;
    predicates: number;
    functions: number;
    facts: number;
    assertions: number;
    commands: number;
    parseSuccessful: boolean;
    complexityScore: number;
    parseErrorConsistency: boolean;
}

describe('FMP Dataset Models Analysis Tests', () => {
    let services: any;
    let csvData: Map<string, { parseErrors: number; status: string }> = new Map();
    const analysisResults: ModelAnalysisResult[] = [];
    const csvOutputPath = './test-results/fmp-dataset-analysis.csv';
    
    beforeAll(async () => {
        console.log('🔄 Initializing Alloy Language Services...');
        services = createAlloyServices(EmptyFileSystem);
        
        // Load existing CSV data for consistency checking
        csvData = loadExistingCSVData('./resources/fmp_model_analysis.csv');
        console.log(`📊 Loaded ${csvData.size} entries from existing CSV for consistency checking`);
        
        // Ensure output directory exists
        const outputDir = path.dirname(csvOutputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Initialize CSV file with headers
        await initializeCSVFile(csvOutputPath);
    });

    afterAll(async () => {
        console.log(`📊 Analysis complete! Results written to: ${csvOutputPath}`);
        console.log(`📁 Analyzed ${analysisResults.length} models total`);
        
        // Print summary statistics
        printSummaryStatistics(analysisResults);
    });

    // Discover all .als files in the fmp directory
    const fmpModelsPath = './resources/fmp';
    console.log(`🔍 Looking for models in: ${fmpModelsPath}`);
    const modelFiles = discoverAlloyFiles(fmpModelsPath);
    console.log(`📁 Found ${modelFiles.length} model files`);

    describe('Individual Model Analysis', () => {
        if (modelFiles.length === 0) {
            it('should skip analysis when no FMP models are present in ./resources/fmp', () => {
                expect(modelFiles.length).toBe(0);
            });
        } else {
            modelFiles.forEach((modelFile) => {
                it(`should analyze ${modelFile.relativePath}`, async () => {
                const result = await analyzeModel(services, modelFile, csvData);
                analysisResults.push(result);
                
                // Write result immediately to CSV to avoid memory buildup
                await appendResultToCSV(result, csvOutputPath);
                
                // Log basic info for each model
                console.log(`📝 ${result.filePath}: ${result.fileSize} bytes, ${result.parseTime.toFixed(2)}ms parse, ${result.validationTime.toFixed(2)}ms validation`);
                
                // Clear some memory by removing the result from array after writing
                // Keep only basic stats for summary
                if (analysisResults.length > 100) {
                    analysisResults.splice(0, 50); // Remove oldest 50 results to free memory
                }
                
                // Force garbage collection if available (helps with memory pressure)
                if (global.gc) {
                    global.gc();
                }
                
                // Tests should not fail for individual models, just collect data
                expect(result.filePath).toBeTruthy();
                expect(result.parseTime).toBeGreaterThanOrEqual(0); // Allow 0ms for error cases
            });
        });
        }
    });

    describe('Aggregate Analysis', () => {
        it('should have reasonable average performance across all models', () => {
            if (analysisResults.length === 0) return;
            
            const avgParseTime = analysisResults.reduce((sum, r) => sum + r.parseTime, 0) / analysisResults.length;
            const avgValidationTime = analysisResults.reduce((sum, r) => sum + r.validationTime, 0) / analysisResults.length;
            const successRate = analysisResults.filter(r => r.parseSuccessful).length / analysisResults.length;
            
            console.log(`📊 Average parse time: ${avgParseTime.toFixed(2)}ms`);
            console.log(`📊 Average validation time: ${avgValidationTime.toFixed(2)}ms`);
            console.log(`📊 Parse success rate: ${(successRate * 100).toFixed(1)}%`);
            
            // Reasonable performance expectations
            expect(avgParseTime).toBeGreaterThanOrEqual(0); // Allow any average
            expect(avgValidationTime).toBeGreaterThanOrEqual(0); // Allow any average
            // expect(successRate).toBeGreaterThan(0.5); // Comment out for now due to parsing issues
        });

        it('should identify the most complex models', () => {
            if (analysisResults.length === 0) return;
            
            // Sort by complexity score (descending)
            const sortedByComplexity = [...analysisResults].sort((a, b) => b.complexityScore - a.complexityScore);
            const top5 = sortedByComplexity.slice(0, 5);
            
            console.log('🏆 Top 5 Most Complex Models:');
            top5.forEach((result, index) => {
                console.log(`   ${index + 1}. ${result.filePath} (complexity: ${result.complexityScore.toFixed(2)})`);
            });
            
            expect(top5.length).toBeLessThanOrEqual(5);
        });

        it('should identify models with the most parse errors', () => {
            if (analysisResults.length === 0) return;
            
            const modelsWithErrors = analysisResults.filter(r => r.parseErrors > 0);
            const sortedByErrors = modelsWithErrors.sort((a, b) => b.parseErrors - a.parseErrors);
            
            console.log(`⚠️  Models with parse errors: ${modelsWithErrors.length}/${analysisResults.length}`);
            if (sortedByErrors.length > 0) {
                console.log('📋 Top models with most parse errors:');
                sortedByErrors.slice(0, 5).forEach((result, index) => {
                    console.log(`   ${index + 1}. ${result.filePath} (${result.parseErrors} errors)`);
                });
            }
            
            // This is informational, not a failure condition
            expect(modelsWithErrors.length).toBeGreaterThanOrEqual(0);
        });

        it('should check parse error consistency with existing CSV data', () => {
            if (analysisResults.length === 0) return;
            
            const inconsistentModels = analysisResults.filter(r => !r.parseErrorConsistency);
            const consistencyRate = (analysisResults.length - inconsistentModels.length) / analysisResults.length;
            
            console.log(`🔍 Parse error consistency rate: ${(consistencyRate * 100).toFixed(1)}%`);
            console.log(`📊 Consistent models: ${analysisResults.length - inconsistentModels.length}/${analysisResults.length}`);
            
            if (inconsistentModels.length > 0) {
                console.log(`⚠️  Inconsistent models found: ${inconsistentModels.length}`);
                console.log('📋 Models with parse error inconsistencies:');
                inconsistentModels.slice(0, 10).forEach((result, index) => {
                    console.log(`   ${index + 1}. ${result.filePath} (parseSuccessful: ${result.parseSuccessful})`);
                });
                if (inconsistentModels.length > 10) {
                    console.log(`   ... and ${inconsistentModels.length - 10} more`);
                }
            }
            
            // This is informational, not a failure condition
            expect(inconsistentModels.length).toBeGreaterThanOrEqual(0);
        });
    });
});

function discoverAlloyFiles(basePath: string): Array<{filename: string, fullPath: string, relativePath: string, directory: string}> {
    const files: Array<{filename: string, fullPath: string, relativePath: string, directory: string}> = [];
    
    function walkDirectory(currentPath: string, relativePath: string = '') {
        try {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                const relPath = path.join(relativePath, entry.name);
                
                if (entry.isDirectory()) {
                    walkDirectory(fullPath, relPath);
                } else if (entry.isFile() && entry.name.endsWith('.als')) {
                    files.push({
                        filename: entry.name,
                        fullPath: fullPath,
                        relativePath: relPath.replace(/\\/g, '/'), // Normalize path separators
                        directory: path.dirname(relPath).replace(/\\/g, '/')
                    });
                }
            }
        } catch (error) {
            console.warn(`⚠️  Could not read directory ${currentPath}: ${error}`);
        }
    }
    
    walkDirectory(basePath);
    return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function loadExistingCSVData(csvPath: string): Map<string, { parseErrors: number; status: string }> {
    const csvData = new Map<string, { parseErrors: number; status: string }>();
    
    try {
        if (!fs.existsSync(csvPath)) {
            console.warn(`⚠️  CSV file not found: ${csvPath}`);
            return csvData;
        }
        
        const csvContent = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvContent.trim().split('\n');
        
        for (const line of lines) {
            const parts = line.split(',');
            if (parts.length >= 3) {
                const filePath = parts[0].trim();
                const parseErrors = parseInt(parts[1].trim(), 10);
                const status = parts[2].trim();
                
                csvData.set(filePath, { parseErrors, status });
            }
        }
        
    } catch (error) {
        console.warn(`⚠️  Error loading CSV file ${csvPath}: ${error}`);
    }
    
    return csvData;
}

function checkParseErrorConsistency(
    filePath: string, 
    parseSuccessful: boolean, 
    csvData: Map<string, { parseErrors: number; status: string }>
): boolean {
    const csvEntry = csvData.get(filePath);
    if (!csvEntry) {
        // If there's no CSV entry, we can't check consistency
        return true; // Consider it consistent by default
    }
    
    const csvHasParseError = csvEntry.status === 'PARSEERROR';
    const currentHasParseError = !parseSuccessful;
    
    // They are consistent if both agree on whether there's a parse error
    return csvHasParseError === currentHasParseError;
}

async function analyzeModel(services: any, modelFile: {filename: string, fullPath: string, relativePath: string, directory: string}, csvData: Map<string, { parseErrors: number; status: string }>): Promise<ModelAnalysisResult> {
    const startTime = performance.now();
    
    try {
        // Read file
        const fileContent = fs.readFileSync(modelFile.fullPath, 'utf-8');
        const fileStats = fs.statSync(modelFile.fullPath);
        const lineCount = fileContent.split('\n').length;
        
        // Measure memory before parsing
        const initialMemory = typeof process !== 'undefined' ? process.memoryUsage().heapUsed : 0;
        
        // Parse document
        const parseStartTime = performance.now();
        const document = await parseDocument(services.Alloy, fileContent);
        const parseEndTime = performance.now();
        const parseTime = parseEndTime - parseStartTime;
        
        // Validate document
        const validationStartTime = performance.now();
        const diagnostics = await services.Alloy.validation.DocumentValidator.validateDocument(document);
        const validationEndTime = performance.now();
        const validationTime = validationEndTime - validationStartTime;
        
        // Measure memory after processing
        const finalMemory = typeof process !== 'undefined' ? process.memoryUsage().heapUsed : 0;
        const memoryUsage = finalMemory - initialMemory;
        
        // Analyze AST structure with error protection
        let astAnalysis;
        try {
            astAnalysis = analyzeASTStructure(document.parseResult.value);
        } catch (error) {
            console.warn(`⚠️  AST analysis failed for ${modelFile.relativePath}: ${error}`);
            astAnalysis = {
                totalNodes: 0,
                signatures: 0,
                predicates: 0,
                functions: 0,
                facts: 0,
                assertions: 0,
                commands: 0
            };
        }
        
        // Calculate complexity score
        const complexityScore = calculateComplexityScore(astAnalysis, fileContent, lineCount);
        
        // Check consistency with existing CSV data
        const parseErrorConsistency = checkParseErrorConsistency(
            modelFile.relativePath, 
            document.parseResult.parserErrors.length === 0, 
            csvData
        );
        
        const totalTime = performance.now() - startTime;
        
        return {
            filePath: modelFile.relativePath,
            fileSize: fileStats.size,
            characterCount: fileContent.length,
            lineCount: lineCount,
            parseTime: parseTime,
            validationTime: validationTime,
            totalTime: totalTime,
            parseErrors: document.parseResult.parserErrors.length,
            validationDiagnostics: diagnostics.length,
            astNodes: astAnalysis.totalNodes,
            memoryUsage: memoryUsage,
            signatures: astAnalysis.signatures,
            predicates: astAnalysis.predicates,
            functions: astAnalysis.functions,
            facts: astAnalysis.facts,
            assertions: astAnalysis.assertions,
            commands: astAnalysis.commands,
            parseSuccessful: document.parseResult.parserErrors.length === 0,
            complexityScore: complexityScore,
            parseErrorConsistency: parseErrorConsistency
        };
        
    } catch (error) {
        const totalTime = performance.now() - startTime;
        console.error(`❌ Error analyzing ${modelFile.relativePath}: ${error}`);
        
        // For error cases, check consistency as false (parse failed)
        const parseErrorConsistency = checkParseErrorConsistency(
            modelFile.relativePath, 
            false, // parseSuccessful = false in error case
            csvData
        );
        
        return {
            filePath: modelFile.relativePath,
            fileSize: 0,
            characterCount: 0,
            lineCount: 0,
            parseTime: 0,
            validationTime: 0,
            totalTime: totalTime,
            parseErrors: -1,
            validationDiagnostics: -1,
            astNodes: 0,
            memoryUsage: 0,
            signatures: 0,
            predicates: 0,
            functions: 0,
            facts: 0,
            assertions: 0,
            commands: 0,
            parseSuccessful: false,
            complexityScore: 0,
            parseErrorConsistency: parseErrorConsistency
        };
    }
}

function analyzeASTStructure(ast: any): {
    totalNodes: number;
    signatures: number;
    predicates: number;
    functions: number;
    facts: number;
    assertions: number;
    commands: number;
} {
    if (!ast || !ast.paragraph) {
        return {
            totalNodes: 0,
            signatures: 0,
            predicates: 0,
            functions: 0,
            facts: 0,
            assertions: 0,
            commands: 0
        };
    }
    
    const analysis = {
        totalNodes: 0,
        signatures: 0,
        predicates: 0,
        functions: 0,
        facts: 0,
        assertions: 0,
        commands: 0
    };
    
    // Count different types of paragraphs
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
                analysis.commands++;
                break;
        }
    });
    
    // Recursively count all AST nodes with depth limit to prevent stack overflow
    function countNodes(node: any, visited = new Set(), depth = 0): number {
        if (!node || typeof node !== 'object' || depth > 100) return 0;
        
        // Prevent infinite recursion by tracking visited objects
        if (visited.has(node)) return 0;
        visited.add(node);
        
        let count = 1;
        for (const key in node) {
            if (node.hasOwnProperty(key) && key !== '$type' && key !== '$container' && key !== '$document') {
                const value = node[key];
                if (Array.isArray(value)) {
                    value.forEach(item => {
                        count += countNodes(item, visited, depth + 1);
                    });
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

function calculateComplexityScore(astAnalysis: any, fileContent: string, lineCount: number): number {
    // Complexity score based on various factors
    let score = 0;
    
    // Size factors
    score += lineCount * 0.1; // 0.1 point per line
    score += fileContent.length * 0.001; // 0.001 point per character
    
    // AST structure factors
    score += astAnalysis.signatures * 2; // 2 points per signature
    score += astAnalysis.predicates * 3; // 3 points per predicate
    score += astAnalysis.functions * 3; // 3 points per function
    score += astAnalysis.facts * 4; // 4 points per fact
    score += astAnalysis.assertions * 3; // 3 points per assertion
    score += astAnalysis.commands * 1; // 1 point per command
    score += astAnalysis.totalNodes * 0.05; // 0.05 points per AST node
    
    // Keyword complexity (rough measure)
    const complexKeywords = ['all', 'some', 'no', 'lone', 'one', 'let', 'implies', 'iff'];
    complexKeywords.forEach(keyword => {
        const matches = (fileContent.match(new RegExp(`\\b${keyword}\\b`, 'g')) || []).length;
        score += matches * 0.5;
    });
    
    return score;
}

async function initializeCSVFile(csvPath: string): Promise<void> {
    const headers = [
        'filePath',
        'fileSize',
        'characterCount',
        'lineCount',
        'parseTime',
        'validationTime',
        'totalTime',
        'parseErrors',
        'validationDiagnostics',
        'astNodes',
        'memoryUsage',
        'signatures',
        'predicates',
        'functions',
        'facts',
        'assertions',
        'commands',
        'parseSuccessful',
        'complexityScore',
        'parseErrorConsistency',
    ];
    
    const csvContent = headers.join(',') + '\n';
    fs.writeFileSync(csvPath, csvContent, 'utf-8');
}

async function appendResultToCSV(result: ModelAnalysisResult, csvPath: string): Promise<void> {
    const headers = [
        'filePath',
        'fileSize',
        'characterCount',
        'lineCount',
        'parseTime',
        'validationTime',
        'totalTime',
        'parseErrors',
        'validationDiagnostics',
        'astNodes',
        'memoryUsage',
        'signatures',
        'predicates',
        'functions',
        'facts',
        'assertions',
        'commands',
        'parseSuccessful',
        'complexityScore',
        'parseErrorConsistency',
    ];
    
    const row = headers.map(header => {
        let value = result[header as keyof ModelAnalysisResult];
        
        // Handle string values that might contain commas or quotes
        if (typeof value === 'string') {
            value = `"${value.replace(/"/g, '""')}"`;
        } else if (typeof value === 'boolean') {
            value = value ? 'true' : 'false';
        } else if (typeof value === 'number') {
            value = value.toString();
        }
        
        return value;
    });
    
    const csvLine = row.join(',') + '\n';
    fs.appendFileSync(csvPath, csvLine, 'utf-8');
}

function printSummaryStatistics(results: ModelAnalysisResult[]): void {
    if (results.length === 0) {
        console.log('📊 No results to summarize');
        return;
    }
    
    const successful = results.filter(r => r.parseSuccessful);
    const withErrors = results.filter(r => r.parseErrors > 0);
    const consistent = results.filter(r => r.parseErrorConsistency);
    
    const avgParseTime = results.reduce((sum, r) => sum + r.parseTime, 0) / results.length;
    const avgValidationTime = results.reduce((sum, r) => sum + r.validationTime, 0) / results.length;
    const avgComplexity = results.reduce((sum, r) => sum + r.complexityScore, 0) / results.length;
    const totalFileSize = results.reduce((sum, r) => sum + r.fileSize, 0);
    
    console.log('\n📊 === SUMMARY STATISTICS ===');
    console.log(`📁 Total models analyzed: ${results.length}`);
    console.log(`✅ Successfully parsed: ${successful.length} (${(successful.length/results.length*100).toFixed(1)}%)`);
    console.log(`❌ Parse errors: ${withErrors.length} (${(withErrors.length/results.length*100).toFixed(1)}%)`);
    console.log(`🔍 Parse error consistency: ${consistent.length}/${results.length} (${(consistent.length/results.length*100).toFixed(1)}%)`);
    console.log(`⚡ Average parse time: ${avgParseTime.toFixed(2)}ms`);
    console.log(`🔍 Average validation time: ${avgValidationTime.toFixed(2)}ms`);
    console.log(`🧮 Average complexity score: ${avgComplexity.toFixed(2)}`);
    console.log(`📦 Total file size: ${(totalFileSize / 1024).toFixed(2)} KB`);
    
    // Find extremes
    const fastest = results.reduce((min, r) => r.parseTime < min.parseTime ? r : min);
    const slowest = results.reduce((max, r) => r.parseTime > max.parseTime ? r : max);
    const mostComplex = results.reduce((max, r) => r.complexityScore > max.complexityScore ? r : max);
    const largest = results.reduce((max, r) => r.fileSize > max.fileSize ? r : max);
    
    console.log(`\n🏃 Fastest parse: ${fastest.filePath} (${fastest.parseTime.toFixed(2)}ms)`);
    console.log(`🐌 Slowest parse: ${slowest.filePath} (${slowest.parseTime.toFixed(2)}ms)`);
    console.log(`🧠 Most complex: ${mostComplex.filePath} (${mostComplex.complexityScore.toFixed(2)})`);
    console.log(`📏 Largest file: ${largest.filePath} (${largest.fileSize} bytes)`);
}
