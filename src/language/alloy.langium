grammar Alloy

type NamedElement = SigDecl | PredDecl | FunDecl | FactDecl | AssertDecl | FieldDecl | LetDecl | Decl | EnumDecl

entry AlloyModule:
    ModuleDecl? import+=Import* paragraph+=Paragraph*;

ModuleDecl:
    'module' qualName=QualName ('[' alias+=ID (',' alias+=ID)* ']')?; 

Import:
    'open' qualName=QualName ('[' aliases+=QualName (',' aliases+=QualName)*']')? ('as' alias=ID)?;

// paragraph ::= sigDecl | factDecl | predDecl | funDecl | assertDecl | cmdDecl
Paragraph:
    SigDecl | FactDecl | PredDecl | FunDecl | AssertDecl | CmdDecl | EnumDecl;

//sigDecl ::= [var] [abstract] [mult] sig name,+ [sigExt] { fieldDecl,* } [block]
SigDecl:
    'var'? 'abstract'? mult=MULT? 'sig' name=ID (',' additionalNames+=ID)* sigExt=SigExt? 
    '{' (fields+=FieldDecl (',' fields+=FieldDecl)*)? '}' block=Block?;
    
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

// funDecl ::= fun [qualName .] name [paraDecls] : expr { expr }
FunDecl:
    'fun' (qualName=[NamedElement:ID] '.')? name=ID paraDecls=ParaDecls? ':' retType=Expr '{' body=Expr '}';

// paraDecls ::= ( decl,* ) | [ decl,* ]
ParaDecls:
    '(' (decls+=Decl (',' decls+=Decl)*)? ')' | '[' (decls+=Decl (',' decls+=Decl)*)? ']';

// assertDecl ::= assert [name] block
AssertDecl:
    'assert' name=ID? block=Block;

// enumDecl ::= enum name { name,+ }
EnumDecl:
    'enum' name=ID '{' values+=ID (',' values+=ID)* '}';

// cmdDecl ::= [name :] ( run | check ) ( qualName | block ) [scope]
CmdDecl:
    (name=ID ':')? (kind='run' | kind='check') (qualName=[NamedElement:ID] | block=Block) scope=Scope?;

// scope ::= for number [but typescope,+] | for typescope,+ [expect number]
Scope:
    'for' number=INT ('but' typeScopes+=TypeScope (',' typeScopes+=TypeScope)*)? ('expect' expectNum=INT)?
    | 'for' typeScopes+=TypeScope (',' typeScopes+=TypeScope)* ('expect' expectNum=INT)?;

// typescope ::= [exactly] number qualName
TypeScope:
    'exactly'? number=INT qualName=[NamedElement:ID];


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
    DotJoinExpr ({infer BoxJoinExpr.left=current} '[' indices+=Expr (',' indices+=Expr)* ']')*;

DotJoinExpr infers Expr:
    PrimeExpr ({infer DotJoinExpr.left=current} ('.' | '.*' | '.^' | '.~') right=PrimeExpr)*;

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
    | ({infer CallExpr} qualName=[NamedElement:ID] '[' args+=Expr (',' args+=Expr)* ']')  // function/predicate call
    ;


// qualName ::= [this/] ( name / )* name
QualName:
    ('this/')? (names+=ID'/')* ID=[NamedElement:ID];

// const ::= [-] number | none | univ | iden
Const:
    '-'? number=INT | 'none' | 'univ' | 'iden';

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

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /(?:\/\/|--)[^\n\r]*/;

