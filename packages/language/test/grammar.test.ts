import { describe, it, expect, beforeAll } from 'vitest';
import { EmptyFileSystem, type AstNode, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import { createAlloyServices } from '../src/index.js';
import type { AlloyModule, Expr, PredDecl, SigDecl, CmdDecl, QualName, FactDecl } from '../src/generated/ast.js';

// Syntax reference: org.alloytools.alloy.core/parser/Alloy.cup, Alloy.lex and CompFilter.java

let parse: (input: string, options?: { validation?: boolean }) => Promise<LangiumDocument<AlloyModule>>;

beforeAll(() => {
    const services = createAlloyServices(EmptyFileSystem);
    parse = parseHelper<AlloyModule>(services.Alloy);
});

function syntaxErrors(document: LangiumDocument): string[] {
    return [
        ...document.parseResult.lexerErrors.map(e => `lexer: ${e.message}`),
        ...document.parseResult.parserErrors.map(e => `parser: ${e.message}`)
    ];
}

/** Compact S-expression of an expression AST, used to check precedence and stored operators. */
function show(node: unknown): string {
    if (node === undefined || node === null) return '_';
    if (typeof node !== 'object') return String(node);
    if (Array.isArray(node)) return node.map(show).join(' ');
    const n = node as AstNode & Record<string, any>;
    switch (n.$type) {
        case 'QualName': {
            const q = n as QualName;
            return [...q.names, q.ref.$refText].join('/');
        }
        case 'Const': return String(n.number);
        case 'UnaryMultExpr':
        case 'UnaryLogicalExpr':
        case 'UnaryExpr':
        case 'CardinalityExpr': return `(${n.op} ${show(n.expr)})`;
        case 'PrimeExpr': return `(' ${show(n.expr)})`;
        case 'DotJoinExpr': return `(. ${show(n.left)} ${show(n.right)})`;
        case 'BoxJoinExpr': return `([] ${show(n.left)} ${show(n.indices)})`;
        case 'ArrowExpr': return `(${n.op.leftMult ?? n.op.leftSet ?? ''}->${n.op.rightMult ?? n.op.rightSet ?? ''} ${show(n.left)} ${show(n.right)})`;
        case 'ComparisonExpr': return `(${n.negated ? '!' : ''}${n.op} ${show(n.left)} ${show(n.right)})`;
        case 'ConjunctionExpr': return `(and ${show(n.left)} ${show(n.right)})`;
        case 'DisjunctionExpr': return `(or ${show(n.left)} ${show(n.right)})`;
        case 'ImplicationExpr': return `(=> ${show(n.left)} ${show(n.right)}${n.elseExpr ? ' ' + show(n.elseExpr) : ''})`;
        case 'SequenceExpr': return `(; ${show(n.left)} ${show(n.right)})`;
        case 'ParenExpr': return show(n.expr);
        case 'BuiltinExpr': return n.name;
        default:
            if ('op' in n && 'left' in n) return `(${n.op} ${show(n.left)} ${show(n.right)})`;
            return n.$type;
    }
}

async function firstExpr(body: string): Promise<string> {
    const document = await parse(`pred p { ${body} }`);
    expect(syntaxErrors(document)).toEqual([]);
    const pred = document.parseResult.value.paragraph[0] as PredDecl;
    return show(pred.block.statements[0].expr);
}

describe('accepts valid Alloy syntax', () => {
    const S = 'sig A, B { f: A } ';
    const P = (body: string) => `${S}pred p { ${body} }`;
    const cases: Array<[string, string]> = [
        ['exact subset sig', 'sig A, B {} sig C = A + B {}'],
        ['subset sig of a union', 'sig A, B {} sig C in A + B {}'],
        ['sig qualifiers in any order', 'abstract private sig A {} lone abstract sig B {} abstract var sig C {} one var sig D {}'],
        ['sig extends builtin', 'sig A extends univ {} sig B in Int {}'],
        ['private and var private fields', 'sig A { private f: A, var private g: A }'],
        ['defined field', 'sig A { f = A }'],
        ['empty and doubled commas in fields', 'sig A { , f: A,, g: A, }'],
        ['seq field', 'sig A { s: seq A }'],
        ['disj after colon', 'sig A { f: disj set A }'],
        ['appended sig fact', 'sig A { f: A } { f != this }'],
        ['open with builtin arguments', 'open util/ordering[Int] open util/a[univ] as o open util/b[seq/Int] open util/c[]'],
        ['empty and private enum', 'enum E {} private enum F { a, b }'],
        ['fact and assert with string names', 'fact "my fact" { } assert "my assert" { }'],
        ['private pred, fun and macro', 'private pred p {} private fun f: Int { 1 } private let m = 1'],
        ['pred with () params and receiver', 'sig A {} pred p(x: A) {} pred A.q[x: A] {}'],
        ['fun return multiplicities', 'sig A {} fun f: seq A { none -> none } fun g: one A { A } fun h: lone A { A } fun i: set A { A }'],
        ['fun with empty or multi-expression body', 'fun f: Int { } fun g: Int { 1 2 }'],
        ['macros', 'let m(a, b) = a + b let n[a, b] = a + b let o { some univ } let q[] = 1'],
        ['named and labelled commands', 'pred p {} run foo { } for 3 l: run p for 3 l2: check { }'],
        ['scopes', 'sig A {} run {} for 3 but exactly 2 A, 4 Int, 4 seq, 1..10 steps, 3 String'],
        ['open-ended and stepped scopes', 'run {} for 1.. steps check {} for 1..10:2 steps run {} for 3:2 steps'],
        ['chained commands', 'run {} implies run {} => check {} for 3 expect 0'],
        ['right-associative implication', P('some A => some B => some A')],
        ['dangling else', P('some A => some B => no A else no B')],
        ['temporal operators', P('some A until no B and always some A and eventually no A and after some A and before no A and historically some A and once no A')],
        ['sequence', P('some A ; no B')],
        ['negated comparisons', P('A not in B and A !in B and A not = B and A != B and A ! = B and #A !< 1 and #A !> 1 and #A !<= 1 and #A !>= 1 and #A not < 1')],
        ['chained comparison', P('A = B = A')],
        ['shift operators', P('1 << 2 = 1 >> 1 and 3 >>> 1 = 1')],
        ['integer builtins', P('1 fun/add 2 fun/mul 3 = 7 and fun/min < fun/max and some fun/next')],
        ['builtin predicates', P('disj[A, B] and pred/totalOrder[A, A, A] and some (A + B).disj')],
        ['int and sum casts', P('sum A = 1 and int[A] = A.int and sum[A] = 1 and #A = 1')],
        ['seq', P('some x: seq A | #x = 1 and some seq/Int')],
        ['quantifiers', P('all x: A | some y: B | no z: A | lone w: A | one v: A | x = y and (sum x: A | 1) = 1')],
        ['quantifier variants', P('all disj x, y: A | x != y and all x: A { some x }')],
        ['let', P('let a = A, b = B | a = b and let c = A { some c }')],
        ['set comprehensions', P('some { x: A | some x } and some { x: A } and some { x: A, y: B | x = y }')],
        ['@name and this', 'sig A { f: A } { some @f and this in f }'],
        ['primes', 'sig A {} pred p { A\' = A and A’ = A }'],
        ['arrow multiplicities', 'sig A { f: A some -> lone A, g: A one -> one A, h: A set -> set A, i: A lone ->   A }'],
        ['relational operators', P('A ++ B = A <: (A->B) :> B and ~f = ^f + *f and A.f[A][A] = A and A::f = A.f')],
        ['constants', P('iden = univ->univ and none = none and some Int and some String and "x" = "x" and some steps')],
        ['number literals', P('#A = 0x1F and #A = 0b101 and #A = 1_000')],
        ['identifiers', 'sig Größe {} sig A" {}'],
        ['comments', 'sig A {} -- comment\npred p {} // comment\n/* block */ /** doc */'],
    ];
    for (const [name, src] of cases) {
        it(name, async () => {
            expect(syntaxErrors(await parse(src))).toEqual([]);
        });
    }
});

describe('rejects invalid Alloy syntax', () => {
    const cases: Array<[string, string]> = [
        ['extends with several parents', 'sig A, B {} sig C extends A + B {}'],
        ['macro without = or block', 'let m A'],
        ['command without a target', 'run for 3'],
        ['labelled command with an inline name', 'l: run n { }'],
        ['trailing ; in a block', 'pred p { some univ ; }'],
        ['negative literal', 'pred p { #univ = -1 }'],
        ['$ in a declared name', 'sig A$1 {}'],
        ['seq as a name', 'sig seq {}'],
    ];
    for (const [name, src] of cases) {
        it(name, async () => {
            expect(syntaxErrors(await parse(src))).not.toEqual([]);
        });
    }
});

describe('precedence and associativity follow Alloy', () => {
    it('dot and box join share one left-associative level', async () => {
        expect(await firstExpr('a.b[c] = a')).toBe('(= ([] (. a b) c) a)');
        expect(await firstExpr('a[b].c = a')).toBe('(= (. ([] a b) c) a)');
    });
    it('binary temporal operators bind tighter than and', async () => {
        expect(await firstExpr('a and b until c')).toBe('(and a (until b c))');
    });
    it('arrow is right associative', async () => {
        expect(await firstExpr('A -> one B -> C = A')).toBe('(= (->one A (-> B C)) A)');
    });
    it('fun/mul binds tighter than fun/add', async () => {
        expect(await firstExpr('1 fun/add 2 fun/mul 3 = 7')).toBe('(= (fun/add 1 (fun/mul 2 3)) 7)');
    });
    it('domain restriction binds looser than range restriction', async () => {
        expect(await firstExpr('a <: b :> c = a')).toBe('(= (<: a (:> b c)) a)');
    });
    it('multiplicity prefixes share the comparison level', async () => {
        expect(await firstExpr('no a = b')).toBe('(= (no a) b)');
        expect(await firstExpr('no a + b')).toBe('(no (+ a b))');
    });
    it('implication is right associative and else binds to the nearest =>', async () => {
        expect(await firstExpr('a => b => c')).toBe('(=> a (=> b c))');
        expect(await firstExpr('a => b => c else d')).toBe('(=> a (=> b c d))');
    });
    it('sequence is right associative', async () => {
        expect(await firstExpr('a ; b ; c')).toBe('(; a (; b c))');
    });
    it('unary operators bind tighter than join and prime applies after them', async () => {
        expect(await firstExpr('~a.b = a')).toBe('(= (. (~ a) b) a)');
        expect(await firstExpr("a.b' = a")).toBe("(= (. a (' b)) a)");
    });
});

describe('operators and modifiers are stored in the AST', () => {
    it('distinguishes binary operators', async () => {
        expect(await firstExpr('a + b = a - b')).toBe('(= (+ a b) (- a b))');
        expect(await firstExpr('a <: b = a :> b')).toBe('(= (<: a b) (:> a b))');
        expect(await firstExpr('a << b = a >>> b')).toBe('(= (<< a b) (>>> a b))');
        expect(await firstExpr('a not in b')).toBe('(!in a b)');
    });
    it('distinguishes unary operators', async () => {
        expect(await firstExpr('~a = ^a')).toBe('(= (~ a) (^ a))');
        expect(await firstExpr('!some a and always no a')).toBe('(and (! (some a)) (always (no a)))');
        expect(await firstExpr('#a = int a')).toBe('(= (# a) (int a))');
    });
    it('stores quantifiers, number values and builtin constants', async () => {
        const document = await parse('pred p { all x: univ | no y: univ | x = y } pred q { 0x1F = 1_000 and 0b101 = fun/min }');
        expect(syntaxErrors(document)).toEqual([]);
        const [p, q] = document.parseResult.value.paragraph as PredDecl[];
        const all = p.block.statements[0].expr as Expr & { quant: string, blockOrBar: { expr: Expr & { quant: string } } };
        expect(all.quant).toBe('all');
        expect(all.blockOrBar.expr.quant).toBe('no');
        expect(show(q.block.statements[0].expr)).toBe('(and (= 31 1000) (= 5 fun/min))');
    });
    it('stores sig, field, decl and scope modifiers', async () => {
        const document = await parse('private abstract sig A { var private disj f, g: disj A } run {} for exactly 3 A, 1.. steps');
        expect(syntaxErrors(document)).toEqual([]);
        const [sig, cmd] = document.parseResult.value.paragraph as [SigDecl, CmdDecl];
        expect(sig.qualifiers).toEqual(['private', 'abstract']);
        const field = sig.fields[0];
        expect([field.var, field.private, field.decl.disj, field.decl.disjExpr]).toEqual([true, true, true, true]);
        expect(field.decl.names.map(n => n.name)).toEqual(['f', 'g']);
        const [exact, steps] = cmd.scope!.typeScopes;
        expect([exact.exactly, exact.number]).toEqual([true, 3]);
        expect([steps.range, steps.endNumber]).toEqual([true, undefined]);
    });
    it('stores command labels without the colon', async () => {
        const document = await parse('pred p {} run {} for 3 l : run p for 2');
        expect(syntaxErrors(document)).toEqual([]);
        const labelled = document.parseResult.value.paragraph[2] as CmdDecl;
        expect([labelled.name, labelled.predicate?.ref.$refText]).toEqual(['l', 'p']);
    });
    it('stores sig extension keywords and string paragraph names', async () => {
        const document = await parse('sig A, B {} sig C = A + B {} fact "f1" {}');
        const [, sig, fact] = document.parseResult.value.paragraph as [SigDecl, SigDecl, FactDecl];
        expect(sig.sigExt?.keyword).toBe('=');
        expect([sig.sigExt?.parent.ref.$refText, ...sig.sigExt!.additionalParents.map(p => p.ref.$refText)]).toEqual(['A', 'B']);
        expect(fact.name).toBe('f1');
    });
});

describe('linking and validation', () => {
    async function diagnostics(src: string): Promise<string[]> {
        const document = await parse(src, { validation: true });
        expect(syntaxErrors(document)).toEqual([]);
        return (document.diagnostics ?? []).filter(d => d.severity === 1).map(d => d.message);
    }

    it('resolves every name of a multi-name declaration to its own node', async () => {
        const document = await parse('sig A { f, g: A } pred p[x, y: A] { some x.g and some y.f }', { validation: true });
        const pred = document.parseResult.value.paragraph[1] as PredDecl;
        const refs: string[] = [];
        for (const node of [pred.block.statements[0].expr]) {
            const stack: any[] = [node];
            while (stack.length) {
                const n = stack.pop();
                if (n?.$type === 'QualName') refs.push(`${n.ref.$refText}->${n.ref.ref?.$type}:${n.ref.ref?.name}`);
                else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) if (!k.startsWith('$')) stack.push(v);
            }
        }
        expect(refs.sort()).toEqual(['f->DeclName:f', 'g->DeclName:g', 'x->DeclName:x', 'y->DeclName:y']);
    });

    it('resolves enum values and macro parameters to their own nodes', async () => {
        const document = await parse('enum Color { Red, Green } let m[a] = a + Green fact { Red in Color }', { validation: true });
        expect(document.diagnostics?.filter(d => d.severity === 1)).toEqual([]);
        const fact = document.parseResult.value.paragraph[2] as FactDecl;
        const red = (fact.block.statements[0].expr as Expr & { left: QualName }).left;
        expect(red.ref.ref?.$type).toBe('EnumValue');
    });

    it('accepts builtin names without linking errors', async () => {
        expect(await diagnostics('sig A {} pred p { disj[A, A] and some A.disj and fun/min < fun/max and pred/totalOrder[A, A, A] and some seq/Int and some steps }')).toEqual([]);
    });

    it('reports repeated sig qualifiers', async () => {
        expect(await diagnostics('abstract abstract sig A {} sig B {} fact { some A + B }')).toContain('The same qualifier cannot be specified more than once for the same sig.');
        expect(await diagnostics('one lone sig A {} fact { some A }')).toContain('A sig can have at most one multiplicity (lone, one or some).');
    });

    it('still reports duplicate fields and parameters', async () => {
        expect(await diagnostics('sig A { f: A, f: A } fact { some A.f }')).toContain('sig "this/A" cannot have 2 fields named "f"');
        expect(await diagnostics('sig A {} pred p[x, x: A] {} fact { some A }')).toContain('The parameter name "x" cannot appear more than once.');
    });
});
