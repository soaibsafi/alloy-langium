import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URI } from 'langium';
import { shared } from './helpers.js';

/**
 * Regression test against models the Alloy Analyzer accepts: the bundled examples and,
 * when the Alloy sources are available in resources/, the models of the Alloy repository.
 * Every reported error is a false positive of the parser, linker or type checker.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [
    path.resolve(here, '../resources/models'),
    path.resolve(here, '../resources/simple'),
    path.resolve(here, '../../../resources/org.alloytools.alloy-master'),
].filter(fs.existsSync);
const files = roots.flatMap(root => findModels(root));

describe.skipIf(files.length === 0)('Alloy corpus', () => {
    it(`produces no errors on ${files.length} models`, async () => {
        const documents = files.map(file => {
            const document = shared.workspace.LangiumDocumentFactory.fromString(fs.readFileSync(file, 'utf8'), URI.file(file));
            shared.workspace.LangiumDocuments.addDocument(document);
            return document;
        });
        await shared.workspace.DocumentBuilder.build(documents, { validation: true });
        const failures = documents.flatMap(document => (document.diagnostics ?? [])
            .filter(d => d.severity === 1)
            .map(d => `${path.relative(here, document.uri.fsPath)}:${d.range.start.line + 1}: ${d.message}`));
        expect(failures).toEqual([]);
    }, 300_000);
});

function findModels(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) findModels(p, out);
        else if (entry.name.endsWith('.als')) out.push(p);
    }
    return out;
}
