/**
 * Diagnostic test script - parses Alloy files and shows detailed errors
 */
import { createAlloyServices } from 'alloy-language';
import { NodeFileSystem } from 'langium/node';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { URI } from 'langium';

const files = process.argv.slice(2);
if (files.length === 0) {
    console.log('Usage: npx tsx scripts/test-parse.ts <file.als> [file2.als ...]');
    process.exit(1);
}

const services = createAlloyServices(NodeFileSystem).Alloy;

for (const filePath of files) {
    const absPath = path.resolve(filePath);
    const content = fs.readFileSync(absPath, 'utf-8');
    const uri = URI.file(absPath);
    
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
    services.shared.workspace.LangiumDocuments.addDocument(document);
    
    // Build WITH validation
    await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
    
    const diagnostics = document.diagnostics ?? [];
    
    console.log(`\n=== ${path.basename(filePath)} ===`);
    console.log(`Total diagnostics: ${diagnostics.length}`);
    
    // Group by severity
    const errors = diagnostics.filter(d => d.severity === 1);
    const warnings = diagnostics.filter(d => d.severity === 2);
    const infos = diagnostics.filter(d => d.severity === 3);
    
    console.log(`  Errors: ${errors.length}, Warnings: ${warnings.length}, Info: ${infos.length}`);
    
    for (const diag of diagnostics.slice(0, 40)) {
        const line = diag.range.start.line + 1;
        const col = diag.range.start.character + 1;
        const lineContent = content.split('\n')[diag.range.start.line]?.trim() || '';
        const sev = diag.severity === 1 ? 'ERR' : diag.severity === 2 ? 'WARN' : 'INFO';
        console.log(`  [${sev}] Line ${line}:${col} - ${diag.message}`);
        console.log(`         > ${lineContent}`);
    }
    
    if (diagnostics.length > 40) {
        console.log(`  ... and ${diagnostics.length - 40} more`);
    }
}
