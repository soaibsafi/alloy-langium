grammar Alloy

type NamedElement = SigDecl | AdditionalSig | PredDecl | FunDecl | FactDecl | AssertDecl | FieldDecl | LetDecl | Decl | EnumDecl | MacroDecl

entry AlloyModule:
    ModuleDecl? import+=Import* paragraph+=Paragraph*;

ModuleDecl:
    'module' qualName=ModulePath ('[' alias+=ID (',' alias+=ID)* ']')?; 

Import:
    'open' qualName=QualName ('[' aliases+=QualName (',' aliases+=QualName)*']')? ('as' alias=ID)?;

// paragraph ::= sigDecl | factDecl | predDecl | funDecl | assertDecl | cmdDecl | macroDecl
Paragraph:
    SigDecl | FactDecl | PredDecl | FunDecl | AssertDecl | CmdDecl | EnumDecl | MacroDecl;

// macroDecl ::= let name [ names ]? =? expr
MacroDecl:
    'let' name=ID ('[' params+=ID (',' params+=ID)* ']')? '='? expr=Expr;

//sigDecl ::= [var] [abstract] [mult] sig name,+ [sigExt] { fieldDecl,* } [block]
SigDecl:
    'var'? 'abstract'? mult=MULT? 'sig' name=ID (',' additionalSigs+=AdditionalSig)* sigExt=SigExt? 
    '{' (fields+=FieldDecl (',' fields+=FieldDecl)*)? '}' block=Block?;

// Additional signature in a multi-signature declaration
AdditionalSig:
    name=ID;
    
//sigExt ::= extends qualName | in qualName [+ qualName]*
SigExt:
    'extends' qualName=[NamedElement:ID] | 'in' qualName=[NamedElement:ID] ('+' qualNames+=[NamedElement:ID])*;

// fieldDecl ::= [var] decl
FieldDecl:
    'var'? decl=Decl;

//decl ::= [disj] name,+ : [disj] expr
Decl:
    'disj'? name=ID (',' additionalNames+=ID)* ':' 'disj'? expr=Expr;

//factDecl ::= fact [name] block
FactDecl:
    'fact' name=ID? block=Block;

// predDecl ::= pred [qualName .] name [paraDecls] block
PredDecl:
    'pred' (qualName=[NamedElement:ID] '.')? name=ID paraDecls=ParaDecls? block=Block;

// funDecl ::= fun [qualName .] name [paraDecls] : [mult] expr expr | fun [qualName .] name [paraDecls] : expr { expr }
FunDecl:
    'fun' (qualName=[NamedElement:ID] '.')? name=ID paraDecls=ParaDecls? ':' 
    (mult=MULT? first=Expr second=Expr | retType=Expr '{' body=Expr '}');

// paraDecls ::= ( decl,* ) | [ decl,* ]
ParaDecls:
    '(' (decls+=Decl (',' decls+=Decl)*)? ')' | '[' (decls+=Decl (',' decls+=Decl)*)? ']';

// assertDecl ::= assert [name] block
AssertDecl:
    'assert' name=ID? block=Block;

// enumDecl ::= [private] enum name { name,+ }
EnumDecl:
    'private'? 'enum' name=ID '{' values+=ID (',' values+=ID)* '}';

// cmdDecl ::= [name :] ( run | check ) ( qualName | block ) [scope] [expect number] [=> cmdDecl]
CmdDecl:
    (name=ID ':')? (kind='run' | kind='check') (qualName=[NamedElement:ID] | block=Block) scope=Scope? 
    ('expect' expectNum=INT)? ('=>' chainedCmd=CmdDecl)?;

// scope ::= for number [but typescope,+] | for typescope,+ [expect number]
Scope:
    'for' number=INT ('but' typeScopes+=TypeScope (',' typeScopes+=TypeScope)*)? 
    | 'for' typeScopes+=TypeScope (',' typeScopes+=TypeScope)*;

// typescope ::= [exactly] number [.. [number [: number]]] qualName
TypeScope:
    'exactly'? number=INT ('..' (endNumber=INT (':' stepNumber=INT)?)?)? qualName=[NamedElement:ID];


// Expression with precedence (from lowest to highest precedence)
Expr:
    SequenceExpr;

SequenceExpr infers Expr:
    QuantExpr ({infer SequenceExpr.left=current} ';' right=QuantExpr)*;

QuantExpr infers Expr:
    ({infer QuantExpr} 'let' decls+=LetDecl (',' decls+=LetDecl)* blockOrBar=BlockOrBar)
    | ({infer QuantExpr} QUANT decls+=Decl (',' decls+=Decl)* blockOrBar=BlockOrBar)
    | DisjunctionExpr;

DisjunctionExpr infers Expr:
    BiImplicationExpr ({infer DisjunctionExpr.left=current} ('||' | 'or') right=BiImplicationExpr)*;

BiImplicationExpr infers Expr:
    ImplicationExpr ({infer BiImplicationExpr.left=current} ('<=>' | 'iff') right=ImplicationExpr)*;

ImplicationExpr infers Expr:
    BinaryTemporalExpr ({infer ImplicationExpr.left=current} ('=>' | 'implies') right=ImplicationExpr ('else' elseExpr=ImplicationExpr)?)?;

BinaryTemporalExpr infers Expr:
    ConjunctionExpr ({infer BinaryTemporalExpr.left=current} ('until' | 'releases' | 'since' | 'triggered') right=ConjunctionExpr)*;

ConjunctionExpr infers Expr:
    UnaryLogicalExpr ({infer ConjunctionExpr.left=current} ('&&' | 'and') right=UnaryLogicalExpr)*;

UnaryLogicalExpr infers Expr:
    ({infer UnaryLogicalExpr} ('!' | 'not' | 'always' | 'eventually' | 'after' | 'before' | 'historically' | 'once') expr=UnaryLogicalExpr)
    | ComparisonExpr;

ComparisonExpr infers Expr:
    UnionDiffExpr ({infer ComparisonExpr.left=current} (negated=('!' | 'not'))? op=CompareOp right=UnionDiffExpr)?;

UnionDiffExpr infers Expr:
    CardinalityExpr ({infer UnionDiffExpr.left=current} ('+' | '-') right=CardinalityExpr)*;

CardinalityExpr infers Expr:
    ({infer CardinalityExpr} '#' expr=CardinalityExpr)
    | OverrideExpr;

OverrideExpr infers Expr:
    IntersectionExpr ({infer OverrideExpr.left=current} '++' right=IntersectionExpr)*;

IntersectionExpr infers Expr:
    ArrowExpr ({infer IntersectionExpr.left=current} '&' right=ArrowExpr)*;

ArrowExpr infers Expr:
    RestrictionExpr ({infer ArrowExpr.left=current} arrows+=ArrowOp right=RestrictionExpr)*;

RestrictionExpr infers Expr:
    BoxJoinExpr ({infer RestrictionExpr.left=current} ('<:' | ':>') right=BoxJoinExpr)*;

BoxJoinExpr infers Expr:
    DotJoinExpr (
        {infer BoxJoinExpr.left=current} '[' indices+=Expr (',' indices+=Expr)* ']'
        | {infer CallExpr.left=current} '[' args+=Expr (',' args+=Expr)* ']'  // function/predicate call
    )*;

DotJoinExpr infers Expr:
    PrimitiveExpr ({infer DotJoinExpr.left=current} ('.' | '.*' | '.^' | '.~') right=PrimitiveExpr)*;

PrimitiveExpr infers Expr:
    PrimeExpr;

PrimeExpr infers Expr:
    UnaryExpr ({infer PrimeExpr.left=current} PRIME)*;

UnaryExpr infers Expr:
    ({infer UnaryExpr} ('~' | '^' | '*' | 'no' | 'some' | 'lone' | 'one' | 'set') expr=UnaryExpr)
    | PrimaryExpr;

PrimaryExpr infers Expr:
    Const 
    | QualName 
    | ({infer AtExpr} '@' ref=[NamedElement:ID])
    | ({infer ThisExpr} 'this')
    | ({infer ParenExpr} '(' expr=Expr ')')
    | Block
    | ({infer SetExpr} '{' decls+=Decl (',' decls+=Decl)* blockOrBar=BlockOrBar '}')
    | ({infer SumExpr} 'sum' decls+=Decl (',' decls+=Decl)* '|' expr=Expr)  // sum expression
    | ({infer MetaExpr} qualName=QualName '$')  // meta value
    | STRING  // string literal
    ;


// qualName ::= [this/] ( name / )* name
QualName:
    ('this/')? (names+=ID'/')* ID=[NamedElement:ID];

// modulePath ::= [this/] ( name / )* name (for module declarations - no references needed)
ModulePath:
    ('this/')? (names+=ID'/')* name=ID;

// const ::= [-] number | none | univ | iden
Const:
    '-'? number=(INT | HEX_INT | BIN_INT) | 'none' | 'univ' | 'iden';

// ArrowOp ::= [mult | set] -> [mult | set]
ArrowOp:
    (leftMult=MULT | leftSet='set')? '->' (rightMult=MULT | rightSet='set')?;

// letDecl ::= name = expr
LetDecl:
    name=ID '=' expr=Expr;

//block ::= { expr* }
Block:
    '{' (exprs+=Expr)* '}';

// blockOrBar ::= block | bar expr
BlockOrBar:
    block=Block | '|' expr=Expr;

// Comparison operators including negated forms  
CompareOp returns string:
    'in' | '=' | '<' | '>' | '=<' | '>=';

// quant ::= all | no | sum | mult
QUANT returns string: 'all' | 'no' | 'sum' | MULT;

MULT returns string: 'lone' | 'some' | 'one';

terminal PRIME: "'";
hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_\"]*/;
terminal INT: /\d+/;
terminal HEX_INT: /0x[0-9A-Fa-f]+/;
terminal BIN_INT: /0b[01]+/;
terminal STRING: /"([^"\\]|\\.)*"/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /(?:\/\/|--)[^\n\r]*/;

