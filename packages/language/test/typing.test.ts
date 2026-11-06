import { describe, expect, it } from 'vitest';
import { AstUtils } from 'langium';
import { isFunDecl, type FunDecl } from '../src/generated/ast.js';
import { check, checkWithLibraries, parse, services, syntaxErrors } from './helpers.js';

// Type rules and messages follow the Alloy Analyzer (edu.mit.csail.sdg.ast.ExprBinary, ExprUnary, ...).

const SIGS = `
sig A { f: B, g: A -> B, s: seq B }
sig B {}
sig C extends A {}
sig D in A + B {}
fun id[x: A]: set B { x.f }
`;

/** Type of `expr`, written as the body of a function after the declarations of SIGS. */
async function typeOf(expr: string, declarations = SIGS): Promise<string> {
    const document = await parse(`${declarations}\nfun probe: univ { ${expr} }`, false);
    expect(syntaxErrors(document)).toEqual([]);
    const probe = document.parseResult.value.paragraph.filter(isFunDecl).find(f => f.name === 'probe') as FunDecl;
    const checker = services.typing.TypeChecker;
    const type = checker.typeOf(probe.block.statements[0].expr);
    return checker.analyze(AstUtils.getDocument(probe)).format(type);
}

describe('infers relational types', () => {
    const cases: Array<[string, string]> = [
        ['A', '{this/A}'],
        ['f', '{this/A->this/B}'],
        ['A.f', '{this/B}'],
        ['f[A]', '{this/B}'],
        ['~f', '{this/B->this/A}'],
        ['A -> B', '{this/A->this/B}'],
        ['A + B', '{this/A, this/B}'],
        ['A & C', '{this/C}'],
        ['A - C', '{this/A}'],
        ['^(A -> A)', '{this/A->this/A}'],
        ['A <: f', '{this/A->this/B}'],
        ['A.g', '{this/A->this/B}'],
        ['A.s', '{Int->this/B}'],
        ['D', '{this/A, this/B}'],
        ['#A', '{Int}'],
        ['1 fun/add 2', '{Int}'],
        ['iden', '{univ->univ}'],
        ['none', '{none}'],
        ['"text"', '{String}'],
        ['id[A]', '{this/B}'],
        ['A.id', '{this/B}'],
        ['{ x: A | some x.f }', '{this/A}'],
        ['{ x: A, y: B | x.f = y }', '{this/A->this/B}'],
        ['let y = A.f | y', '{this/B}'],
        ['some A => A else C', '{this/A}'],
        ['int[A.f]', '{Int}'],
    ];
    for (const [expr, expected] of cases) {
        it(`${expr} : ${expected}`, async () => {
            expect(await typeOf(expr)).toBe(expected);
        });
    }

    it('reads a field of the enclosing sig as this.field inside its facts', async () => {
        const { errors } = await check('sig N { next: lone N } { next != this and no next & this }');
        expect(errors).toEqual([]);
    });

    it('instantiates the parameters of opened modules', async () => {
        const ordering = 'module util/ordering[elem]\nfun first: one elem { elem }\nfun next: elem -> elem { elem -> elem }';
        const { errors } = await checkWithLibraries('open util/ordering[S]\nsig S {}\nsig T {}\nfact { first.next in S and no first & T }', [ordering]);
        expect(errors).toEqual([]);
        const bad = await checkWithLibraries('open util/ordering[S]\nsig S {}\nfact { first.S = first }', [ordering]);
        expect(bad.errors.join('\n')).toContain('This cannot be a legal relational join');
    });

    it('lets declarations of the module shadow imported ones', async () => {
        const ordering = `module util/ordering[elem]
            fun prev: elem -> elem { elem -> elem }`;
        const { errors, warnings } = await checkWithLibraries(`
            open util/ordering[Time]
            sig Time {}
            sig Key {}
            one sig Desk { prev: Key -> Time }
            fact { all t: Time | some Desk.prev.t and some prev }`, [ordering]);
        expect(errors).toEqual([]);
        expect(warnings).toEqual([]);
    });

    it('resolves overloaded functions and same-named fields by type', async () => {
        const { errors, warnings } = await check(`
            sig Room { keys: set Key }
            sig Guest { keys: Key -> Time }
            sig Key, Time {}
            pred add[a, b, c: Key] {}
            fact { all g: Guest, t: Time | some g.keys.t and some Room.keys and (#Key).add[1] > 0 }`);
        expect(errors).toEqual([]);
        expect(warnings).toEqual([]);
    });
});

describe('reports type errors with Alloy messages', () => {
    const cases: Array<[string, string, string]> = [
        ['union of different arities', 'A + f', '+ can be used only between 2 expressions of the same arity, or between 2 integer expressions.'],
        ['difference of different arities', 'f - A', '- can be used only between 2 expressions of the same arity, or between 2 integer expressions.'],
        ['intersection of different arities', 'A & f', '& can be used only between 2 expressions of the same arity.'],
        ['override of different arities', 'A ++ f', '++ can be used only between two expressions of the same arity.'],
        ['join of two sets', 'A.B', 'This cannot be a legal relational join where\nleft hand side is A (type = {this/A})\nright hand side is B (type = {this/B})'],
        ['transpose of a set', '~A', '~ can be used only with a binary relation.'],
        ['closure of a set', '^A', '^ can be used only with a binary relation.'],
        ['domain restriction by a relation', 'f <: f', 'This must be a unary set, but instead it has the following possible type(s):\n{this/A->this/B}'],
        ['int of a relation', 'int[f]', 'int[] can be used only with a unary set.'],
        ['then and else differ', 'some A => A else f', 'The then-clause and the else-clause must match.'],
        ['formula as a set', '#(some A)', 'This must be a set or relation.\nInstead, it has the following possible type(s):\n{PrimitiveBoolean}'],
        ['multiplicity in an expression', 'A + (set B)', 'Multiplicity expression not allowed here.'],
    ];
    for (const [name, expr, message] of cases) {
        it(name, async () => {
            const { errors } = await check(`${SIGS}\nfun probe: univ { ${expr} }`);
            expect(errors.some(e => e.includes(message)), `errors: ${JSON.stringify(errors)}`).toBe(true);
        });
    }

    const formulaCases: Array<[string, string, string]> = [
        ['set as a formula', 'A', 'This must be a formula expression.\nInstead, it has the following possible type(s):\n{this/A}'],
        ['set compared with an integer', '#A > A', 'This must be an integer expression.\nInstead, it has the following possible type(s):\n{this/A}'],
        ['subset of different arities', 'A in f', 'in can be used only between 2 expressions of the same arity.'],
        ['equality of different arities', 'A = f', '= can be used only between 2 expressions of the same arity, or between 2 integer expressions.'],
        ['negated subset of different arities', 'A !in f', '!in can be used only between 2 expressions of the same arity.'],
        ['quantifier body not a formula', 'all x: A | x', 'This must be a formula expression.'],
        ['sum body not an integer', '(sum x: A | x) > 0', 'This must be an integer expression.'],
        ['comprehension over a relation', 'some { x: f | some x }', 'This must be a unary set. Instead, its type is {this/A->this/B}'],
        ['call with too many arguments', 'some id[A, A, A]', 'fun this/id has 1 parameters but is called with 3 arguments.'],
        ['argument of the wrong arity', 'some id[f]', 'This should have arity 1 but instead its possible type(s) are {this/A->this/B}'],
        ['this outside a sig', 'some this', 'The name "this" cannot be found.'],
        ['disj with one argument', 'disj[A]', 'The builtin disjoint[] predicate must be called with at least two arguments.'],
        ['disj of different arities', 'disj[A, f]', 'The builtin predicate disjoint[] cannot be used among expressions of different arities.'],
        ['totalOrder arguments', 'pred/totalOrder[A, A, A]', 'The third argument to pred/totalOrder must be binary.'],
    ];
    for (const [name, formula, message] of formulaCases) {
        it(name, async () => {
            const { errors } = await check(`${SIGS}\nfact { ${formula} }`);
            expect(errors.some(e => e.includes(message)), `errors: ${JSON.stringify(errors)}`).toBe(true);
        });
    }

    it('checks multiplicities in declarations', async () => {
        const { errors } = await check(`${SIGS}\nsig E { h: some A -> B }`);
        expect(errors.some(e => e.startsWith('After the some/lone/one multiplicity symbol, this expression must be a unary set.'))).toBe(true);
    });

    it('reports an error only once, not in every enclosing expression', async () => {
        const { errors } = await check(`${SIGS}\nfact { some (A.B).f and no (A.B) }`);
        expect(errors.filter(e => e.startsWith('This cannot be a legal relational join'))).toHaveLength(2);
        expect(errors).toHaveLength(2);
    });
});

describe('reports type warnings', () => {
    it('joins that are always empty', async () => {
        const { warnings } = await check(`${SIGS}\nfact { some B.f }`);
        expect(warnings.some(w => w.startsWith('The join operation here always yields an empty set.'))).toBe(true);
    });

    it('intersections of disjoint sets', async () => {
        const { warnings } = await check(`${SIGS}\nfact { some A & B }`);
        expect(warnings.some(w => w.startsWith('& is irrelevant because the two subexpressions are always disjoint.'))).toBe(true);
    });

    it('function bodies disjoint from the return type', async () => {
        const { warnings } = await check(`${SIGS}\nfun h: set A { B }`);
        expect(warnings.some(w => w.startsWith('Function return value is disjoint from its return type.'))).toBe(true);
    });

    it('unused quantified and let variables', async () => {
        const { warnings } = await check(`${SIGS}\nfact { all x: A | some A and let y = B | some B }`);
        expect(warnings.filter(w => w === 'This variable is unused.')).toHaveLength(2);
    });
});

describe('message details', () => {
    it('shows formula and integer operands in error messages', async () => {
        const { errors } = await check(`${SIGS}\nfact { no A = A }`);
        expect(errors).toContain('= can be used only between 2 expressions of the same arity, or between 2 integer expressions.\nLeft type = {PrimitiveBoolean}\nRight type = {this/A}');
    });
});
