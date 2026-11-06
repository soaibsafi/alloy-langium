import { expect } from 'vitest';
import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import type { Diagnostic } from 'vscode-languageserver';
import { createAlloyServices } from '../src/index.js';
import type { AlloyModule } from '../src/generated/ast.js';

export const { shared, Alloy: services } = createAlloyServices(EmptyFileSystem);
const parseDocument = parseHelper<AlloyModule>(services);

export async function parse(text: string, validation = true): Promise<LangiumDocument<AlloyModule>> {
    return parseDocument(text, { validation });
}

export function syntaxErrors(document: LangiumDocument): string[] {
    return [
        ...document.parseResult.lexerErrors.map(e => `lexer: ${e.message}`),
        ...document.parseResult.parserErrors.map(e => `parser: ${e.message}`)
    ];
}

export interface Checked {
    document: LangiumDocument<AlloyModule>;
    diagnostics: Diagnostic[];
    errors: string[];
    warnings: string[];
}

function group(document: LangiumDocument<AlloyModule>): Checked {
    const diagnostics = document.diagnostics ?? [];
    return {
        document,
        diagnostics,
        errors: diagnostics.filter(d => d.severity === 1).map(d => d.message),
        warnings: diagnostics.filter(d => d.severity === 2).map(d => d.message),
    };
}

/** Parses and validates a model and returns its diagnostics grouped by severity. */
export async function check(text: string): Promise<Checked> {
    const document = await parse(text);
    expect(syntaxErrors(document)).toEqual([]);
    return group(document);
}

let libraryCounter = 0;

/**
 * Validates a model together with library modules (e.g. a util/ordering it opens).
 * Each call uses fresh URIs so that modules of earlier calls do not interfere.
 */
export async function checkWithLibraries(text: string, libraries: string[]): Promise<Checked> {
    const run = libraryCounter++;
    const factory = shared.workspace.LangiumDocumentFactory;
    const documents = [text, ...libraries].map((source, i) =>
        factory.fromString<AlloyModule>(source, URI.parse(`memory:///run${run}/file${i}.als`)));
    for (const document of documents) shared.workspace.LangiumDocuments.addDocument(document);
    await shared.workspace.DocumentBuilder.build(documents, { validation: true });
    const result = group(documents[0]);
    await shared.workspace.DocumentBuilder.update([], documents.map(d => d.uri));
    return result;
}
