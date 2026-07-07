import type { AlloyModule } from 'alloy-language';
import { expandToNode, toString } from 'langium/generate';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './util.js';
import { analyzeASTStructure, calculateComplexityScore } from './analyzer-cli.js';

export function generateOutput(model: AlloyModule, filePath: string, destination: string | undefined, format: string = 'js'): string {
    const data = extractDestinationAndName(filePath, destination);
    if (!fs.existsSync(data.destination)) {
        fs.mkdirSync(data.destination, { recursive: true });
    }

    const fmt = format.toLowerCase();
    let generatedFilePath = '';
    let content = '';

    const astAnalysis = analyzeASTStructure(model);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lineCount = fileContent.split(/\r?\n/).length;
    const complexity = calculateComplexityScore(astAnalysis, fileContent, lineCount);

    if (fmt === 'md' || fmt === 'markdown') {
        generatedFilePath = path.join(data.destination, `${data.name}.md`);
        
        let md = `# Alloy Specification: ${path.basename(filePath)}\n\n`;
        md += `**File Size:** ${fileContent.length} bytes | **Lines:** ${lineCount} | **Complexity Score:** ${complexity}\n\n`;
        md += `## Structural Summary\n\n`;
        md += `| Paragraph Type | Count |\n| :--- | :--- |\n`;
        md += `| Signatures (\`sig\`) | ${astAnalysis.signatures} |\n`;
        md += `| Predicates (\`pred\`) | ${astAnalysis.predicates} |\n`;
        md += `| Functions (\`fun\`) | ${astAnalysis.functions} |\n`;
        md += `| Facts (\`fact\`) | ${astAnalysis.facts} |\n`;
        md += `| Assertions (\`assert\`) | ${astAnalysis.assertions} |\n`;
        md += `| Commands (\`run/check\`) | ${astAnalysis.commands} |\n`;
        md += `| **Total AST Nodes** | **${astAnalysis.totalNodes}** |\n\n`;

        md += `## Paragraphs\n\n`;
        if (model.paragraph && model.paragraph.length > 0) {
            model.paragraph.forEach((p: any, index: number) => {
                const name = p.name ? ` \`${p.name}\`` : '';
                md += `${index + 1}. **${p.$type}**${name}\n`;
            });
        } else {
            md += `*No paragraphs defined.*\n`;
        }

        content = md;
    } else if (fmt === 'json') {
        generatedFilePath = path.join(data.destination, `${data.name}.json`);
        const summary = {
            specification: path.basename(filePath),
            metrics: {
                fileSize: fileContent.length,
                lineCount,
                complexityScore: complexity,
                ...astAnalysis
            },
            paragraphs: (model.paragraph || []).map((p: any) => ({
                type: p.$type,
                name: p.name || null
            }))
        };
        content = JSON.stringify(summary, null, 2);
    } else {
        // Default: JavaScript skeleton
        generatedFilePath = path.join(data.destination, `${data.name}.js`);
        const fileNode = expandToNode`
            "use strict";
            // Generated from Alloy model: ${path.basename(filePath)}
            // Signatures: ${astAnalysis.signatures}, Predicates: ${astAnalysis.predicates}, Facts: ${astAnalysis.facts}
            // Complexity Score: ${complexity}

            export const modelSummary = ${JSON.stringify({ specification: path.basename(filePath), ...astAnalysis }, null, 4)};
            console.log("Loaded Alloy Model Summary:", modelSummary);
        `.appendNewLineIfNotEmpty();
        content = toString(fileNode);
    }

    fs.writeFileSync(generatedFilePath, content, 'utf-8');
    return generatedFilePath;
}
