import { describe, expect, test } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';
import { createAlloyServices } from '../../src/language/alloy-module.js';

const services = createAlloyServices(EmptyFileSystem);

async function parseAlloy(input: string, testName: string) {
    const document = services.shared.workspace.LangiumDocuments.createDocument(URI.parse(`${testName}.als`), input);
    await services.shared.workspace.DocumentBuilder.build([document], {});
    return document;
}

describe('Alloy Grammar Tests', () => {
    test('parse simple signature', async () => {
        const input = `
sig Node {
    id: Id
}
        `;
        const document = await parseAlloy(input, 'signature');
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
    });

    test('parse fact with quantification', async () => {
        const input = `
fact {
    all n: Node | some n.id
}
        `;
        const document = await parseAlloy(input, 'fact');
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
    });

    test('parse predicate with parameters', async () => {
        const input = `
pred less_than [from, i, j: Id] {
    let next" = Id<:next - (Id->from) | j in i.^next"
}
        `;
        const document = await parseAlloy(input, 'predicate');
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
    });
    
    test('parse command with scope', async () => {
        const input = `
check Same1 for 3 but 1 State expect 0
        `;
        const document = await parseAlloy(input, 'command');
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
    });
    
    test('parse inequality operator', async () => {
        const input = `
fact {
    all m,n: Node | m!=n => m.id != n.id
}
        `;
        const document = await parseAlloy(input, 'inequality');
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
    });
});
