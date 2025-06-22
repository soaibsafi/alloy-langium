import { describe, expect, test } from 'vitest';
import { createAlloyServices } from '../src/language/alloy-module.js';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { AlloyModule } from '../src/language/generated/ast.js';

const services = createAlloyServices(EmptyFileSystem);
const parse = parseHelper<AlloyModule>(services.Alloy);

describe('Cross-references', () => {
    test('should resolve signature references in TypeScope', async () => {
        const document = await parse(`
            sig Book {}
            pred show { some Book }
            run show for 3 but 1 Book
        `);
        
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        
        const model = document.parseResult.value;
        expect(model.paragraph).toHaveLength(3);
        
        // Check the command
        const cmd = model.paragraph[2];
        expect(cmd.$type).toBe('CmdDecl');
        if (cmd.$type === 'CmdDecl') {
            expect(cmd.predicate?.$refText).toBe('show');
            expect(cmd.scope?.typeScopes?.[0]?.type?.$refText).toBe('Book');
        }
    });

    test('should resolve predicate references in commands', async () => {
        const document = await parse(`
            sig Person {}
            pred somePersonExists { some Person }
            run somePersonExists
        `);
        
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        
        const model = document.parseResult.value;
        const cmd = model.paragraph[2];
        expect(cmd.$type).toBe('CmdDecl');
        if (cmd.$type === 'CmdDecl') {
            expect(cmd.predicate?.$refText).toBe('somePersonExists');
            // Check that the reference is resolved
            expect(cmd.predicate?.ref).toBeDefined();
            expect(cmd.predicate?.ref?.$type).toBe('PredDecl');
        }
    });

    test('should resolve signature extension references', async () => {
        const document = await parse(`
            sig Person {}
            sig Student extends Person {}
        `);
        
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        
        const model = document.parseResult.value;
        const studentSig = model.paragraph[1];
        expect(studentSig.$type).toBe('SigDecl');
        
        if (studentSig.$type === 'SigDecl') {
            expect(studentSig.sigExt?.parent?.$refText).toBe('Person');
            expect(studentSig.sigExt?.parent?.ref).toBeDefined();
            expect(studentSig.sigExt?.parent?.ref?.$type).toBe('SigDecl');
        }
    });
});
