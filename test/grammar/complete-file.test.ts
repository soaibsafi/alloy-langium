import { describe, expect, test } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';
import { createAlloyServices } from '../../src/language/alloy-module.js';
import * as fs from 'fs';

const services = createAlloyServices(EmptyFileSystem);

describe('Complete Alloy File Tests', () => {
    test('parse complete chord.als file', async () => {
        const content = fs.readFileSync('./chord.als', 'utf-8');
        const document = services.shared.workspace.LangiumDocuments.createDocument(URI.parse('chord.als'), content);
        await services.shared.workspace.DocumentBuilder.build([document], {});
        
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        expect(document.parseResult.value.$type).toBe('ModuleDecl');
    });
});
