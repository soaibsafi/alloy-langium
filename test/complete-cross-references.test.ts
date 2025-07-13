import { describe, expect, test } from 'vitest';
import { createAlloyServices } from '../src/language/alloy-module.js';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { AlloyModule } from '../src/language/generated/ast.js';

const services = createAlloyServices(EmptyFileSystem);
const parse = parseHelper<AlloyModule>(services.Alloy);

describe('Complete Cross-reference Functionality', () => {
    test('should handle all types of cross-references in Alloy', async () => {
        const alloyModel = `
            // Basic signatures with inheritance
            abstract sig Person {}
            sig Student extends Person {
                courses: set Course
            }
            sig Teacher extends Person {}
            
            // Signature with fields
            sig Course {
                instructor: one Teacher,
                students: set Student
            }
            
            // Predicate with parameter
            pred enrolled[s: Student, c: Course] {
                s in c.students
            }
            
            // Function
            fun studentCount[c: Course]: Int {
                #c.students
            }
            
            // Fact
            fact {
                all c: Course | c.instructor in Teacher
            }
            
            // Assertion
            assert ValidEnrollment {
                all s: Student, c: Course | 
                    enrolled[s, c] => s in c.students
            }
            
            // Commands
            pred show {}
            run show for 5 but 2 Student, 3 Course
            check ValidEnrollment for 4
        `;
        
        const document = await parse(alloyModel);
        
        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);
        
        const model = document.parseResult.value;
        
        // Find all the different elements
        const signatures = model.paragraph.filter(p => p.$type === 'SigDecl');
        const predicates = model.paragraph.filter(p => p.$type === 'PredDecl');
        const functions = model.paragraph.filter(p => p.$type === 'FunDecl');
        const facts = model.paragraph.filter(p => p.$type === 'FactDecl');
        const assertions = model.paragraph.filter(p => p.$type === 'AssertDecl');
        const commands = model.paragraph.filter(p => p.$type === 'CmdDecl');
        
        expect(signatures).toHaveLength(4); // Person, Student, Teacher, Course
        expect(predicates).toHaveLength(2); // enrolled, show
        expect(functions).toHaveLength(1); // studentCount
        expect(facts).toHaveLength(1);
        expect(assertions).toHaveLength(1); // ValidEnrollment
        expect(commands).toHaveLength(2); // run show, check ValidEnrollment
        
        // Test signature inheritance cross-references
        const studentSig = signatures.find(s => s.$type === 'SigDecl' && s.names.includes('Student'));
        expect(studentSig).toBeDefined();
        if (studentSig && studentSig.$type === 'SigDecl') {
            expect(studentSig.sigExt?.parent?.$refText).toBe('Person');
            expect(studentSig.sigExt?.parent?.ref).toBeDefined();
            expect(studentSig.sigExt?.parent?.ref?.$type).toBe('SigDecl');
        }
        
        const teacherSig = signatures.find(s => s.$type === 'SigDecl' && s.names.includes('Teacher'));
        expect(teacherSig).toBeDefined();
        if (teacherSig && teacherSig.$type === 'SigDecl') {
            expect(teacherSig.sigExt?.parent?.$refText).toBe('Person');
            expect(teacherSig.sigExt?.parent?.ref).toBeDefined();
        }
        
        // Test command cross-references
        const runCommand = commands.find(c => c.$type === 'CmdDecl' && c.kind === 'run');
        expect(runCommand).toBeDefined();
        if (runCommand && runCommand.$type === 'CmdDecl') {
            expect(runCommand.predicate?.$refText).toBe('show');
            expect(runCommand.predicate?.ref).toBeDefined();
            expect(runCommand.predicate?.ref?.$type).toBe('PredDecl');
            
            // Test scope type references
            expect(runCommand.scope?.typeScopes).toHaveLength(2);
            const studentScope = runCommand.scope?.typeScopes?.find(ts => ts.type?.$refText === 'Student');
            const courseScope = runCommand.scope?.typeScopes?.find(ts => ts.type?.$refText === 'Course');
            
            expect(studentScope).toBeDefined();
            expect(studentScope?.type?.ref).toBeDefined();
            expect(studentScope?.type?.ref?.$type).toBe('SigDecl');
            
            expect(courseScope).toBeDefined();
            expect(courseScope?.type?.ref).toBeDefined();
            expect(courseScope?.type?.ref?.$type).toBe('SigDecl');
        }
        
        const checkCommand = commands.find(c => c.$type === 'CmdDecl' && c.kind === 'check');
        expect(checkCommand).toBeDefined();
        if (checkCommand && checkCommand.$type === 'CmdDecl') {
            expect(checkCommand.predicate?.$refText).toBe('ValidEnrollment');
            expect(checkCommand.predicate?.ref).toBeDefined();
            expect(checkCommand.predicate?.ref?.$type).toBe('AssertDecl');
        }
    });
});
