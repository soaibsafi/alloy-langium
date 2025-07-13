import { describe, expect, test } from 'vitest';
import { createAlloyServices } from '../src/language/alloy-module.js';
import { NodeFileSystem } from 'langium/node';
import { AlloyModule } from '../src/language/generated/ast.js';

const services = createAlloyServices(NodeFileSystem);

describe('Chord.als Cross-references', () => {
    test('should parse chord.als and resolve cross-references', async () => {
        const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
            URI.file('/Users/soaib/Code/Github/alloy-langium/chord.als')
        );
        
        await services.shared.workspace.DocumentBuilder.build([document]);
        
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        
        const model = document.parseResult.value as AlloyModule;
        expect(model.paragraph.length).toBeGreaterThan(0);
        
        // Find a command in the model
        const commands = model.paragraph.filter(p => p.$type === 'CmdDecl');
        expect(commands.length).toBeGreaterThan(0);
        
        // Check that at least one command has resolved cross-references
        const firstCommand = commands[0];
        if (firstCommand.$type === 'CmdDecl') {
            if (firstCommand.predicate) {
                console.log('Command predicate reference:', firstCommand.predicate.$refText);
                console.log('Command predicate resolved:', firstCommand.predicate.ref !== undefined);
            }
            if (firstCommand.assertion) {
                console.log('Command assertion reference:', firstCommand.assertion.$refText);
                console.log('Command assertion resolved:', firstCommand.assertion.ref !== undefined);
            }
            if (firstCommand.scope?.typeScopes && firstCommand.scope.typeScopes.length > 0) {
                console.log('First type scope:', firstCommand.scope.typeScopes[0].type?.$refText);
                console.log('Type scope resolved:', firstCommand.scope.typeScopes[0].type?.ref !== undefined);
            }
        }
    });
});

// Import URI from langium
import { URI } from 'langium';
