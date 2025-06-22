import { describe, expect, test } from 'vitest';
import { createAlloyServices } from '../src/language/alloy-module.js';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { AlloyModule } from '../src/language/generated/ast.js';

const services = createAlloyServices(EmptyFileSystem);
const parse = parseHelper<AlloyModule>(services.Alloy);

describe('Go to Definition', () => {
    test('should provide location information for cross-references', async () => {
        const alloyModel = `
            sig Book {}
            pred show { some Book }
            run show for 3 but 1 Book
        `;
        
        const document = await parse(alloyModel);
        
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        
        const model = document.parseResult.value;
        const cmd = model.paragraph[2];
        
        if (cmd.$type === 'CmdDecl') {
            // Check that we can get the location of the referenced predicate
            const predicateRef = cmd.predicate?.ref;
            expect(predicateRef).toBeDefined();
            
            if (predicateRef) {
                // Check that the referenced predicate has location information
                const cstNode = predicateRef.$cstNode;
                expect(cstNode).toBeDefined();
                expect(cstNode?.range).toBeDefined();
                
                // Verify it's the correct predicate
                expect(predicateRef.$type).toBe('PredDecl');
                if (predicateRef.$type === 'PredDecl') {
                    expect(predicateRef.name).toBe('show');
                }
            }
            
            // Check signature reference in scope
            const typeRef = cmd.scope?.typeScopes?.[0]?.type?.ref;
            expect(typeRef).toBeDefined();
            
            if (typeRef) {
                expect(typeRef.$type).toBe('SigDecl');
                const cstNode = typeRef.$cstNode;
                expect(cstNode).toBeDefined();
                expect(cstNode?.range).toBeDefined();
            }
        }
    });

    test('should handle multiple signatures with same reference', async () => {
        const alloyModel = `
            sig Person {}
            sig Student extends Person {}
            sig Teacher extends Person {}
            pred somePersonExists { some Person }
            run somePersonExists for 5 Person
        `;
        
        const document = await parse(alloyModel);
        
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        
        const model = document.parseResult.value;
        
        // Check that Student extends Person correctly
        const studentSig = model.paragraph[1];
        if (studentSig.$type === 'SigDecl') {
            const personRef = studentSig.sigExt?.parent?.ref;
            expect(personRef).toBeDefined();
            expect(personRef?.$type).toBe('SigDecl');
            if (personRef?.$type === 'SigDecl') {
                expect(personRef.names).toContain('Person');
            }
        }
        
        // Check that Teacher extends Person correctly  
        const teacherSig = model.paragraph[2];
        if (teacherSig.$type === 'SigDecl') {
            const personRef = teacherSig.sigExt?.parent?.ref;
            expect(personRef).toBeDefined();
            expect(personRef?.$type).toBe('SigDecl');
            // Both should reference the same Person signature
            expect(personRef).toBe(model.paragraph[0]);
        }
    });
});
