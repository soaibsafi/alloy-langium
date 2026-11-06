import { describe, expect, it } from 'vitest';
import type { LangiumDocument } from 'langium';
import type { DocumentSymbol, MarkupContent, Position } from 'vscode-languageserver';
import { parse, services } from './helpers.js';

/** Removes the cursor marker `$` from the text, parses it and returns the cursor position. */
async function withCursor(text: string): Promise<{ document: LangiumDocument; position: Position }> {
    const marker = text.indexOf('$');
    const document = await parse(text.slice(0, marker) + text.slice(marker + 1));
    return { document, position: document.textDocument.positionAt(marker) };
}

async function hover(text: string): Promise<string | undefined> {
    const { document, position } = await withCursor(text);
    const result = await services.lsp.HoverProvider!.getHoverContent(document, { textDocument: { uri: document.uri.toString() }, position });
    return (result?.contents as MarkupContent | undefined)?.value;
}

const MODEL = `
/** People known to the address book. */
sig Person { friends: set Person }
-- The book itself
one sig Book { entries: Person -> Person }
pred knows[p, q: Person] { q in p.friends }
fun reach[p: Person]: set Person { p.^friends }
fact { all p: Person | knows[p, p] }
assert Sym { all p, q: Person | knows[p, q] => knows[q, p] }
check Sym for 3
`;

describe('hover', () => {
    it('shows sigs with their documentation comment', async () => {
        const content = await hover(MODEL.replace('knows[p, p]', 'knows[p, p] and some Per$son'));
        expect(content).toContain('sig Person');
        expect(content).toContain('{this/Person}');
        expect(content).toContain('People known to the address book.');
    });

    it('shows fields with their type, and line comments of sigs', async () => {
        expect(await hover(MODEL.replace('q in p.friends', 'q in p.fri$ends'))).toContain('Type: `{this/Person->this/Person}`');
        expect(await hover(MODEL.replace('one sig Book', 'one sig Bo$ok'))).toContain('The book itself');
    });

    it('shows predicates, functions, parameters and quantified variables', async () => {
        expect(await hover(MODEL.replace('| knows[p, p]', '| kn$ows[p, p]'))).toContain('pred knows[p: Person, q: Person]');
        expect(await hover(MODEL.replace('{ p.^friends }', '{ $p.^friends }'))).toContain('(parameter of reach)');
        expect(await hover(MODEL.replace('| knows[p, p]', '| knows[$p, p]'))).toContain('all p: Person');
        expect(await hover(MODEL.replace('fun reach', 'fun rea$ch'))).toContain('Type: `{this/Person}`');
    });

    it('documents builtins and keywords', async () => {
        expect(await hover(MODEL.replace('knows[p, p] }', 'knows[p, p] and some un$iv }'))).toContain('The set of all atoms.');
        expect(await hover(MODEL.replace('fact { all', 'fact { al$l'))).toContain('Universal quantifier');
    });
});

describe('document symbols', () => {
    it('lists paragraphs with sig fields as children', async () => {
        const document = await parse(MODEL);
        const symbols = await services.lsp.DocumentSymbolProvider!.getSymbols(document, { textDocument: { uri: document.uri.toString() } }) as DocumentSymbol[];
        expect(symbols.map(s => s.name)).toEqual(['Person', 'Book', 'knows', 'reach', 'fact', 'Sym', 'check Sym']);
        expect(symbols[0].children?.map(c => c.name)).toEqual(['friends']);
        expect(symbols[3].detail).toBe('reach[p: Person]: set Person');
    });
});

describe('semantic tokens', () => {
    it('distinguishes sigs, fields, predicates, parameters and variables', async () => {
        const document = await parse(MODEL);
        const provider = services.lsp.SemanticTokenProvider!;
        const tokens = await provider.semanticHighlight(document, { textDocument: { uri: document.uri.toString() } });
        const legend = provider.semanticTokensOptions.legend.tokenTypes;
        const lines = document.textDocument.getText().split('\n');
        const found = new Map<string, Set<string>>();
        let line = 0, char = 0;
        for (let i = 0; i < tokens.data.length; i += 5) {
            const [deltaLine, deltaChar, length, type] = tokens.data.slice(i, i + 4);
            line += deltaLine;
            char = deltaLine === 0 ? char + deltaChar : deltaChar;
            const text = lines[line].slice(char, char + length);
            if (!found.has(text)) found.set(text, new Set());
            found.get(text)!.add(legend[type]);
        }
        expect([...found.get('Person')!]).toEqual(['class']);
        expect([...found.get('friends')!]).toEqual(['property']);
        expect([...found.get('knows')!]).toEqual(['function']);
        expect(found.get('p')).toEqual(new Set(['parameter', 'variable']));
    });
});

describe('signature help', () => {
    async function help(text: string) {
        const { document, position } = await withCursor(text);
        return services.lsp.SignatureHelp!.provideSignatureHelp(document, { textDocument: { uri: document.uri.toString() }, position });
    }

    it('shows the parameters of the called predicate', async () => {
        const result = await help(MODEL.replace('knows[p, p]', 'knows[p, $p]'));
        expect(result?.signatures[0].label).toBe('pred knows[p: Person, q: Person]');
        expect(result?.activeParameter).toBe(1);
    });

    it('counts a receiver as the first argument', async () => {
        const result = await help(MODEL.replace('knows[p, p]', 'p.knows[$p]'));
        expect(result?.activeParameter).toBe(1);
    });
});

describe('code actions', () => {
    async function fixes(text: string): Promise<Array<{ title: string; result: string }>> {
        const document = await parse(text);
        const diagnostics = document.diagnostics ?? [];
        const range = { start: { line: 0, character: 0 }, end: document.textDocument.positionAt(text.length) };
        const actions = await services.lsp.CodeActionProvider!.getCodeActions(document, { textDocument: { uri: document.uri.toString() }, range, context: { diagnostics } }) ?? [];
        return actions.map(action => {
            const edit = 'edit' in action ? action.edit?.changes?.[document.uri.toString()]?.[0] : undefined;
            const result = edit ? text.slice(0, document.textDocument.offsetAt(edit.range.start)) + edit.newText + text.slice(document.textDocument.offsetAt(edit.range.end)) : text;
            return { title: action.title, result };
        });
    }

    it('suggests similar names for unresolved references', async () => {
        const actions = await fixes('sig Person {} fact { some Persn }');
        expect(actions[0]).toEqual({ title: "Did you mean 'Person'?", result: 'sig Person {} fact { some Person }' });
    });

    it('removes redundant and repeated keywords', async () => {
        expect((await fixes('run {} for exactly 4 Int'))[0]).toEqual({ title: "Remove 'exactly'", result: 'run {} for 4 Int' });
        expect((await fixes('abstract abstract sig A {} sig B extends A {} fact { some B }'))[0].result)
            .toBe('abstract sig A {} sig B extends A {} fact { some B }');
    });
});
