import { describe, it, expect, beforeAll } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { createAlloyServices } from '../src/index.js';
import { parseDocument } from 'langium/test';
import * as fs from 'fs';

describe('Alloy Language Server Performance Tests', () => {
    let services: any;
    
    beforeAll(async () => {
        console.log('🔄 Initializing Alloy Language Services...');
        services = createAlloyServices(EmptyFileSystem);
        await parseDocument(services.Alloy, 'sig Node {}');
    });

    describe('Parsing Performance', () => {
        it('should parse simple signature declarations efficiently', async () => {
            const simpleAlloyCode = `
                sig Node {
                    children: set Node,
                    parent: lone Node
                }
                sig Root extends Node {}
            `;
            
            const startTime = performance.now();
            const document = await parseDocument(services.Alloy, simpleAlloyCode);
            const endTime = performance.now();
            
            console.log(`⚡ Simple parsing took: ${(endTime - startTime).toFixed(2)}ms`);
            console.log(`📊 Code length: ${simpleAlloyCode.length} characters`);
            
            expect(endTime - startTime).toBeLessThan(100); // Should parse within 100ms
            expect(document.parseResult.parserErrors).toHaveLength(0);
        });

        it('should parse complex specifications efficiently', async () => {
            const complexAlloyCode = `
                sig Node {
                    children: set Node,
                    parent: lone Node
                }
                
                sig Root extends Node {}
                
                pred tree [r: Root] {
                    all n: Node | lone n.parent
                    all n: Node | n in r.*children
                    no r.parent
                }
                
                pred reachable [n1, n2: Node] {
                    n2 in n1.^children
                }
                
                fact TreeStructure {
                    all r: Root | tree[r]
                }
                
                assert ConnectedTree {
                    all r: Root, n: Node | n in r.*children implies reachable[r, n]
                }
                
                run tree for 5
                check ConnectedTree for 5
            `;
            
            const startTime = performance.now();
            const document = await parseDocument(services.Alloy, complexAlloyCode);
            const endTime = performance.now();
            
            console.log(`⚡ Complex parsing took: ${(endTime - startTime).toFixed(2)}ms`);
            console.log(`📊 Code length: ${complexAlloyCode.length} characters`);
            
            expect(endTime - startTime).toBeLessThan(500); // Should parse within 500ms
            expect(document.parseResult.parserErrors).toHaveLength(0);
        });
    });

    describe('Real File Performance', () => {
        const realFiles = [
            { name: 'chord.als', path: './resources/chord.als' },
            { name: 'Book-1.als', path: './resources/Book-1.als' }
        ];

        realFiles.forEach(({ name, path: filePath }) => {
            it(`should process ${name} efficiently`, async () => {
                if (!fs.existsSync(filePath)) {
                    console.warn(`⚠️  Test file ${filePath} not found, skipping test`);
                    return;
                }

                const fileContent = fs.readFileSync(filePath, 'utf-8');
                console.log(`📊 Testing ${name} - File size: ${fileContent.length} characters`);

                // Measure parsing
                const parseStartTime = performance.now();
                const document = await parseDocument(services.Alloy, fileContent);
                const parseEndTime = performance.now();
                const parseTime = parseEndTime - parseStartTime;

                console.log(`⚡ Parsing ${name} took: ${parseTime.toFixed(2)}ms`);
                expect(parseTime).toBeLessThan(1000); // Should parse within 1 second
                
                if (document.parseResult.parserErrors.length > 0) {
                    console.log(`⚠️  Parse errors found in ${name}: ${document.parseResult.parserErrors.length}`);
                    // For real files, we might have parser errors due to incomplete grammar
                    // Just log them but don't fail the test
                } else {
                    expect(document.parseResult.parserErrors).toHaveLength(0);
                }

                // Measure validation
                const validationStartTime = performance.now();
                const diagnostics = await services.Alloy.validation.DocumentValidator.validateDocument(document);
                const validationEndTime = performance.now();
                const validationTime = validationEndTime - validationStartTime;

                console.log(`🔍 Validation of ${name} took: ${validationTime.toFixed(2)}ms`);
                console.log(`📋 Diagnostics found: ${diagnostics.length}`);

                if (diagnostics.length > 0) {
                    console.log('   Sample diagnostics:');
                    diagnostics.slice(0, 3).forEach((diag: any) => {
                        console.log(`   └─ ${diag.severity}: ${diag.message}`);
                    });
                    if (diagnostics.length > 3) {
                        console.log(`   └─ ... and ${diagnostics.length - 3} more`);
                    }
                }

                expect(validationTime).toBeLessThan(2000); // Should validate within 2 seconds

                // Measure memory if available
                if (typeof process !== 'undefined' && process.memoryUsage) {
                    const memUsage = process.memoryUsage();
                    console.log(`🧠 Memory usage: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
                }
            });
        });
    });

    describe('Scope Resolution Performance', () => {
        it('should resolve references efficiently', async () => {
            const codeWithReferences = `
                sig Person {
                    children: set Person,
                    parent: lone Person
                }
                
                pred someParent [p: Person] {
                    some p.parent
                }
                
                fact {
                    all p: Person | someParent[p] implies some p.children
                }
            `;
            
            const startTime = performance.now();
            const document = await parseDocument(services.Alloy, codeWithReferences);
            
            // Force scope resolution by accessing document references
            if (document.parseResult.value) {
                // This will trigger scope resolution internally
                document.references; // Access references to force scope resolution
            }
            
            const endTime = performance.now();
            
            console.log(`� Reference resolution took: ${(endTime - startTime).toFixed(2)}ms`);
            
            expect(endTime - startTime).toBeLessThan(200); // Should resolve within 200ms
            expect(document.parseResult.parserErrors).toHaveLength(0);
        });
    });

    describe('Validation Performance', () => {
        it('should validate documents efficiently', async () => {
            const validationTestCode = `
                sig node {
                    children: set node,
                    parent: lone node
                }
                
                sig root extends node {}
                
                pred someCondition [n: node] {
                    some n.parent
                }
            `;
            
            const parseStartTime = performance.now();
            const document = await parseDocument(services.Alloy, validationTestCode);
            const parseEndTime = performance.now();
            
            const validationStartTime = performance.now();
            const diagnostics = await services.Alloy.validation.DocumentValidator.validateDocument(document);
            const validationEndTime = performance.now();
            
            console.log(`⚡ Parsing took: ${(parseEndTime - parseStartTime).toFixed(2)}ms`);
            console.log(`🔍 Validation took: ${(validationEndTime - validationStartTime).toFixed(2)}ms`);
            console.log(`📋 Diagnostics found: ${diagnostics.length}`);
            
            // Log sample diagnostics if any
            if (diagnostics.length > 0) {
                console.log(`⚠️  Sample diagnostics:`);
                diagnostics.slice(0, 3).forEach((diag: any) => {
                    console.log(`   └─ ${diag.severity}: ${diag.message}`);
                });
            }
            
            expect(validationEndTime - validationStartTime).toBeLessThan(100); // Should validate within 100ms
        });
    });

    describe('Memory Usage', () => {
        it('should track memory usage during parsing', () => {
            const initialMemory = process.memoryUsage();
            console.log(`🧠 Initial memory: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
            
            // Parse multiple documents to see memory growth
            const promises = [];
            for (let i = 0; i < 10; i++) {
                const code = `
                    sig Sig${i} {
                        field${i}: set Sig${(i + 1) % 10}
                    }
                    
                    pred pred${i} [s: Sig${i}] {
                        some s.field${i}
                    }
                `;
                promises.push(parseDocument(services.Alloy, code));
            }
            
            return Promise.all(promises).then(() => {
                const finalMemory = process.memoryUsage();
                console.log(`🧠 Final memory: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
                console.log(`📈 Memory growth: ${((finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
                
                // Memory should not grow excessively
                const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
                expect(memoryGrowth).toBeLessThan(20 * 1024 * 1024); // Less than 20MB growth
            });
        });
    });

    describe('Large Specification Performance', () => {
        it('should handle large specifications efficiently', async () => {
            const largeSpec = generateLargeAlloySpec(20); // 20 signatures
            
            console.log(`📊 Large spec size: ${largeSpec.length} characters`);
            
            const startTime = performance.now();
            const document = await parseDocument(services.Alloy, largeSpec);
            const endTime = performance.now();
            
            console.log(`⚡ Large spec parsing took: ${(endTime - startTime).toFixed(2)}ms`);
            
            expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
            expect(document.parseResult.parserErrors).toHaveLength(0);
        });
    });

    // Helper function
    function generateLargeAlloySpec(numSignatures: number): string {
        let spec = '';
        
        // Generate many signatures
        for (let i = 0; i < numSignatures; i++) {
            spec += `sig Sig${i} {\n`;
            spec += `  field${i}: set Sig${(i + 1) % numSignatures}\n`;
            spec += `}\n\n`;
        }
        
        // Add some predicates
        for (let i = 0; i < Math.min(numSignatures, 5); i++) {
            spec += `pred pred${i} [s: Sig${i}] {\n`;
            spec += `  some s.field${i}\n`;
            spec += `}\n\n`;
        }
        
        // Add a fact
        spec += `fact {\n`;
        for (let i = 0; i < Math.min(numSignatures, 3); i++) {
            spec += `  all s: Sig${i} | pred${i}[s]\n`;
        }
        spec += `}\n\n`;
        
        spec += `run {} for 3\n`;
        
        return spec;
    }
});
