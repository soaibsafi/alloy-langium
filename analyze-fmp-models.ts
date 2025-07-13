import { EmptyFileSystem } from 'langium';
import { createAlloyServices } from './src/language/alloy-module.js';
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

async function main() {
    console.log('� Starting FMP Dataset Analysis...');
    
    // Initialize Alloy Language Services
    console.log('�🔄 Initializing Alloy Language Services...');
    const services = createAlloyServices(EmptyFileSystem);
    
    // Load existing CSV data for consistency checking
    const csvData = loadExistingCSVData('./resources/fmp_model_analysis.csv');
    console.log(`📊 Loaded ${csvData.size} entries from existing CSV for consistency checking`);
    
    // Setup output
    const csvOutputPath = './test-results/fmp-dataset-analysis.csv';
    const outputDir = path.dirname(csvOutputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Initialize CSV file with headers
    await initializeCSVFile(csvOutputPath);
    
    // Discover all .als files in the fmp directory
    const fmpModelsPath = './resources/fmp';
    console.log(`🔍 Looking for models in: ${fmpModelsPath}`);
    const modelFiles = discoverAlloyFiles(fmpModelsPath);
    console.log(`📁 Found ${modelFiles.length} model files`);
    
    // Track summary statistics without keeping all results in memory
    const summaryStats = {
        totalProcessed: 0,
        successfulParses: 0,
        parseErrors: 0,
        consistentModels: 0,
        totalParseTime: 0,
        totalValidationTime: 0,
        totalComplexity: 0,
        totalFileSize: 0,
        fastest: null as ModelAnalysisResult | null,
        slowest: null as ModelAnalysisResult | null,
        mostComplex: null as ModelAnalysisResult | null,
        largest: null as ModelAnalysisResult | null,
    };
    
    // Process models one by one
    for (let i = 0; i < modelFiles.length; i++) {
        const modelFile = modelFiles[i];
        console.log(`\n📝 Processing ${i + 1}/${modelFiles.length}: ${modelFile.relativePath}`);
        
        try {
            const result = await analyzeModel(services, modelFile, csvData);
            
            // Write result immediately to CSV
            await appendResultToCSV(result, csvOutputPath);
            
            // Update summary statistics
            updateSummaryStats(summaryStats, result);
            
            // Log progress
            console.log(`   ✅ ${result.fileSize} bytes, ${result.parseTime.toFixed(2)}ms parse, ${result.validationTime.toFixed(2)}ms validation, success: ${result.parseSuccessful}, consistent: ${result.parseErrorConsistency}`);
            
            // Force garbage collection if available
            if (global.gc && (i + 1) % 10 === 0) {
                global.gc();
            }
            
            // Add a small delay to prevent overwhelming the system
            if ((i + 1) % 100 === 0) {
                console.log(`   � Processed ${i + 1} models, taking a brief pause...`);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
        } catch (error) {
            console.error(`   ❌ Error processing ${modelFile.relativePath}: ${error}`);
        }
    }
    
    console.log('\n🎉 Analysis complete!');
    console.log(`📊 Results written to: ${csvOutputPath}`);
    
    // Print final summary
    printFinalSummary(summaryStats);
}

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

async function analyzeModelWithTimeout(
    services: any, 
    modelFile: {filename: string, fullPath: string, relativePath: string, directory: string}, 
    csvData: Map<string, { parseErrors: number; status: string }>,
    timeoutMs: number = 30000 // 30 second timeout
): Promise<ModelAnalysisResult> {
    return new Promise(async (resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`Analysis timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        try {
            const result = await analyzeModel(services, modelFile, csvData);
            clearTimeout(timeoutId);
            resolve(result);
        } catch (error) {
            clearTimeout(timeoutId);
            reject(error);
        }
    });
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

async function printSummaryFromCSV(csvPath: string): Promise<void> {
    try {
        console.log('\n📊 Reading final results from CSV...');
        const csvContent = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvContent.trim().split('\n');
        
        if (lines.length <= 1) {
            console.log('📊 No results found in CSV');
            return;
        }
        
        // Parse CSV data
        const headers = lines[0].split(',');
        const results: any[] = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            const result: any = {};
            
            headers.forEach((header, index) => {
                const value = values[index];
                
                // Parse values back to appropriate types
                if (header === 'parseSuccessful' || header === 'parseErrorConsistency') {
                    result[header] = value === 'true';
                } else if (['fileSize', 'characterCount', 'lineCount', 'parseErrors', 'validationDiagnostics', 'astNodes', 'memoryUsage', 'signatures', 'predicates', 'functions', 'facts', 'assertions', 'commands'].includes(header)) {
                    result[header] = parseInt(value, 10);
                } else if (['parseTime', 'validationTime', 'totalTime', 'complexityScore'].includes(header)) {
                    result[header] = parseFloat(value);
                } else {
                    result[header] = value.replace(/^"|"$/g, ''); // Remove quotes
                }
            });
            
            results.push(result);
        }
        
        // Calculate and print summary statistics
        printSummaryStatistics(results);
        
    } catch (error) {
        console.error(`❌ Error reading CSV summary: ${error}`);
    }
}

function printSummaryStatistics(results: any[]): void {
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
    
    // Report inconsistencies
    const inconsistent = results.filter(r => !r.parseErrorConsistency);
    if (inconsistent.length > 0) {
        console.log(`\n⚠️  Found ${inconsistent.length} models with parse error inconsistencies:`);
        inconsistent.slice(0, 10).forEach((result, index) => {
            console.log(`   ${index + 1}. ${result.filePath} (parseSuccessful: ${result.parseSuccessful})`);
        });
        if (inconsistent.length > 10) {
            console.log(`   ... and ${inconsistent.length - 10} more`);
        }
    }
}

function updateSummaryStats(stats: any, result: ModelAnalysisResult): void {
    stats.totalProcessed++;
    
    if (result.parseSuccessful) {
        stats.successfulParses++;
    } else {
        stats.parseErrors++;
    }
    
    if (result.parseErrorConsistency) {
        stats.consistentModels++;
    }
    
    stats.totalParseTime += result.parseTime;
    stats.totalValidationTime += result.validationTime;
    stats.totalComplexity += result.complexityScore;
    stats.totalFileSize += result.fileSize;
    
    // Track extremes
    if (!stats.fastest || result.parseTime < stats.fastest.parseTime) {
        stats.fastest = result;
    }
    
    if (!stats.slowest || result.parseTime > stats.slowest.parseTime) {
        stats.slowest = result;
    }
    
    if (!stats.mostComplex || result.complexityScore > stats.mostComplex.complexityScore) {
        stats.mostComplex = result;
    }
    
    if (!stats.largest || result.fileSize > stats.largest.fileSize) {
        stats.largest = result;
    }
}

function printFinalSummary(stats: any): void {
    if (stats.totalProcessed === 0) {
        console.log('📊 No models were processed');
        return;
    }
    
    const avgParseTime = stats.totalParseTime / stats.totalProcessed;
    const avgValidationTime = stats.totalValidationTime / stats.totalProcessed;
    const avgComplexity = stats.totalComplexity / stats.totalProcessed;
    const successRate = (stats.successfulParses / stats.totalProcessed) * 100;
    const consistencyRate = (stats.consistentModels / stats.totalProcessed) * 100;
    
    console.log('\n📊 === FINAL ANALYSIS SUMMARY ===');
    console.log(`📁 Total models processed: ${stats.totalProcessed}`);
    console.log(`✅ Successfully parsed: ${stats.successfulParses} (${successRate.toFixed(1)}%)`);
    console.log(`❌ Parse errors: ${stats.parseErrors} (${((stats.parseErrors / stats.totalProcessed) * 100).toFixed(1)}%)`);
    console.log(`🔍 Parse error consistency: ${stats.consistentModels}/${stats.totalProcessed} (${consistencyRate.toFixed(1)}%)`);
    console.log(`⚡ Average parse time: ${avgParseTime.toFixed(2)}ms`);
    console.log(`🔍 Average validation time: ${avgValidationTime.toFixed(2)}ms`);
    console.log(`🧮 Average complexity score: ${avgComplexity.toFixed(2)}`);
    console.log(`📦 Total file size: ${(stats.totalFileSize / 1024).toFixed(2)} KB`);
    
    if (stats.fastest) {
        console.log(`\n🏃 Fastest parse: ${stats.fastest.filePath} (${stats.fastest.parseTime.toFixed(2)}ms)`);
    }
    if (stats.slowest) {
        console.log(`🐌 Slowest parse: ${stats.slowest.filePath} (${stats.slowest.parseTime.toFixed(2)}ms)`);
    }
    if (stats.mostComplex) {
        console.log(`🧠 Most complex: ${stats.mostComplex.filePath} (${stats.mostComplex.complexityScore.toFixed(2)})`);
    }
    if (stats.largest) {
        console.log(`📏 Largest file: ${stats.largest.filePath} (${stats.largest.fileSize} bytes)`);
    }
}

// Run the analysis
main().catch(error => {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
});
