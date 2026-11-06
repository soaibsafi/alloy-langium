import { describe, expect, it } from 'vitest';
import { check } from './helpers.js';

// Messages follow the Alloy Analyzer (CompModule, Sig, Alloy.cup).

describe('signature declarations', () => {
    const cases: Array<[string, string, string]> = [
        ['extending a subset sig', 'sig A {} sig B in A {} sig C extends B {} fact { some C }',
            'Cannot extend the subset signature "B".\nA signature can only extend a toplevel signature or a subsignature.'],
        ['cyclic inheritance', 'sig A extends B {} sig B extends A {} fact { some A }', 'is involved in a cyclic inheritance.'],
        ['abstract subset sig', 'sig A {} abstract sig B in A {} fact { some B }', 'Subset signature cannot be abstract.'],
        ['extending Int', 'sig A extends Int {} fact { some A }', 'sig A cannot extend the builtin "Int" signature'],
        ['extending a predicate', 'pred p {} sig A extends p {} fact { some A }', 'The sig "p" cannot be found.'],
        ['subset of a predicate', 'pred p {} sig A in p {} fact { some A }', 'The sig "p" cannot be found.'],
        ['two multiplicities', 'one some sig A {} fact { some A }', 'You cannot declare a sig to be both one and some.'],
        ['repeated qualifier', 'abstract abstract sig A {} sig B extends A {} fact { some B }', 'The same qualifier cannot be specified more than once for the same sig.'],
    ];
    for (const [name, model, message] of cases) {
        it(name, async () => {
            const { errors } = await check(model);
            expect(errors.some(e => e.includes(message)), `errors: ${JSON.stringify(errors)}`).toBe(true);
        });
    }

    it('accepts subset sigs of several parents and sigs extending univ', async () => {
        const { errors } = await check('sig A {} sig B {} sig C in A + B {} sig D = A + B {} sig E extends univ {} fact { some C + D + E }');
        expect(errors).toEqual([]);
    });
});

describe('commands and scopes', () => {
    const cases: Array<[string, string, string]> = [
        ['check of a predicate', 'pred p {} check p', 'The assertion "p" cannot be found.'],
        ['run of an assertion', 'assert a {} run a', 'The predicate/function "a" cannot be found.'],
        ['scope on a predicate', 'sig A {} pred p {} run {} for 3 but 2 p', 'The sig "p" cannot be found.'],
        ['scope on univ', 'run {} for 3 univ', 'You cannot set a scope on univ.'],
        ['scope on none', 'run {} for 3 none', 'You cannot set a scope on none.'],
        ['exact Int scope', 'run {} for exactly 4 Int', 'The exactly keyword is redundant here since the integer bitwidth must be exact.'],
        ['growing Int scope', 'run {} for 1..4 Int', 'Cannot specify a growing scope for "Int"'],
        ['exact seq scope', 'run {} for exactly 4 seq', 'The exactly keyword is redundant here since the number of sequence index has to be exact.'],
        ['command body not a formula', 'sig A {} run { A }', 'This must be a formula expression.'],
    ];
    for (const [name, model, message] of cases) {
        it(name, async () => {
            const { errors } = await check(model);
            expect(errors.some(e => e.includes(message)), `errors: ${JSON.stringify(errors)}`).toBe(true);
        });
    }

    it('accepts valid commands', async () => {
        const { errors } = await check(`
            sig A {} pred p[x: A] { some x } fun f: set A { A } assert a { some A }
            run p for 3 but exactly 2 A, 4 Int, 5 seq, 1..10 steps
            run f
            check a for 2
            l: run { some A } expect 1`);
        expect(errors).toEqual([]);
    });
});
