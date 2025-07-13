import { describe, expect, test } from 'vitest';
import { createAlloyServices } from '../src/language/alloy-module.js';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { AlloyModule } from '../src/language/generated/ast.js';

const services = createAlloyServices(EmptyFileSystem);
const parse = parseHelper<AlloyModule>(services.Alloy);

describe('Real Alloy Model Cross-references', () => {
    test('should parse and resolve cross-references in Book-1.als', async () => {
        const alloyModel = `
            sig Book {}
            pred show { some Book }
            run show for 3 but 1 Book
        `;
        
        const document = await parse(alloyModel);
        
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        
        const model = document.parseResult.value;
        expect(model.paragraph).toHaveLength(3);
        
        // Verify signature declaration
        const bookSig = model.paragraph[0];
        expect(bookSig.$type).toBe('SigDecl');
        
        // Verify predicate declaration
        const showPred = model.paragraph[1];
        expect(showPred.$type).toBe('PredDecl');
        
        // Verify command with cross-references
        const cmd = model.paragraph[2];
        expect(cmd.$type).toBe('CmdDecl');
        if (cmd.$type === 'CmdDecl') {
            // Check predicate reference
            expect(cmd.predicate?.$refText).toBe('show');
            expect(cmd.predicate?.ref).toBeDefined();
            expect(cmd.predicate?.ref?.$type).toBe('PredDecl');
            
            // Check scope with signature reference
            expect(cmd.scope?.typeScopes).toHaveLength(1);
            expect(cmd.scope?.typeScopes?.[0]?.type?.$refText).toBe('Book');
            expect(cmd.scope?.typeScopes?.[0]?.type?.ref).toBeDefined();
            expect(cmd.scope?.typeScopes?.[0]?.type?.ref?.$type).toBe('SigDecl');
        }
    });

    test('should resolve cross-references in chord.als snippet', async () => {
        const chordSnippet = `
            sig Node {
                next: lone Node
            }
            pred ring { all n: Node | n.next != n }
            run ring for 5 Node
        `;
        
        const document = await parse(chordSnippet);
        
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        
        const model = document.parseResult.value;
        expect(model.paragraph).toHaveLength(3);
        
        // Check command references
        const cmd = model.paragraph[2];
        expect(cmd.$type).toBe('CmdDecl');
        if (cmd.$type === 'CmdDecl') {
            expect(cmd.predicate?.$refText).toBe('ring');
            expect(cmd.predicate?.ref).toBeDefined();
            expect(cmd.predicate?.ref?.$type).toBe('PredDecl');
            
            expect(cmd.scope?.typeScopes?.[0]?.type?.$refText).toBe('Node');
            expect(cmd.scope?.typeScopes?.[0]?.type?.ref).toBeDefined();
        }
    });
});
