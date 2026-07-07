import type { AstNode, LangiumCoreServices, LangiumDocument } from 'langium';
import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { URI } from 'langium';

export async function extractDocument(fileName: string, services: LangiumCoreServices): Promise<LangiumDocument> {
    const extensions = services.LanguageMetaData.fileExtensions;
    if (!extensions.includes(path.extname(fileName))) {
        console.error(chalk.yellow(`Please choose a file with one of these extensions: ${extensions}.`));
        process.exit(1);
    }

    if (!fs.existsSync(fileName)) {
        console.error(chalk.red(`File ${fileName} does not exist.`));
        process.exit(1);
    }

    const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.file(path.resolve(fileName)));
    await services.shared.workspace.DocumentBuilder.build([document], { validation: true });

    return document;
}

export async function extractDocuments(fileNames: string[], services: LangiumCoreServices): Promise<LangiumDocument[]> {
    const documents: LangiumDocument[] = [];
    for (const fileName of fileNames) {
        if (!fs.existsSync(fileName)) continue;
        const doc = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.file(path.resolve(fileName)));
        documents.push(doc);
    }
    await services.shared.workspace.DocumentBuilder.build(documents, { validation: true });
    return documents;
}

export async function extractAstNode<T extends AstNode>(fileName: string, services: LangiumCoreServices): Promise<T> {
    const document = await extractDocument(fileName, services);
    return document.parseResult?.value as T;
}

interface FilePathData {
    destination: string,
    name: string
}

export function extractDestinationAndName(filePath: string, destination: string | undefined): FilePathData {
    const baseName = path.basename(filePath, path.extname(filePath)).replace(/[.-]/g, '');
    return {
        destination: destination ?? path.join(path.dirname(filePath), 'generated'),
        name: baseName
    };
}

export async function findAlloyFiles(targetPath: string): Promise<string[]> {
    if (!fs.existsSync(targetPath)) {
        throw new Error(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
        if (targetPath.endsWith('.als')) {
            return [targetPath];
        }
        return [];
    }

    const files: string[] = [];
    function walk(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.als')) {
                files.push(fullPath);
            }
        }
    }

    walk(targetPath);
    return files.sort();
}

export function printDiagnostics(document: LangiumDocument): { errors: number; warnings: number } {
    const diagnostics = document.diagnostics ?? [];
    let errors = 0;
    let warnings = 0;

    for (const diag of diagnostics) {
        const severity = diag.severity === 1 ? 'ERROR' : diag.severity === 2 ? 'WARN' : 'INFO';
        const line = diag.range.start.line + 1;
        const col = diag.range.start.character + 1;
        const snippet = document.textDocument.getText(diag.range).replace(/\r?\n/g, ' ');

        if (diag.severity === 1) {
            errors++;
            console.error(chalk.red(`  [${severity}] Line ${line}:${col} - ${diag.message}`) + (snippet ? chalk.gray(` [${snippet}]`) : ''));
        } else if (diag.severity === 2) {
            warnings++;
            console.warn(chalk.yellow(`  [${severity}] Line ${line}:${col} - ${diag.message}`) + (snippet ? chalk.gray(` [${snippet}]`) : ''));
        } else {
            console.log(chalk.blue(`  [${severity}] Line ${line}:${col} - ${diag.message}`));
        }
    }

    return { errors, warnings };
}
