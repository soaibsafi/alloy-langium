grammar Alloy

type NamedElement = SigDecl | AdditionalSig | PredDecl | FunDecl | FactDecl | AssertDecl | FieldDecl | LetDecl | Decl | EnumDecl | MacroDecl

entry AlloyModule:
    ModuleDecl? import+=Import* paragraph+=Paragraph*;

ModuleDecl:
    'module' qualName=ModulePath ('[' alias+=ID (',' alias+=ID)* ']')?; 

Import:
    'open' qualName=ModulePath ('[' aliases+=ModulePath (',' aliases+=ModulePath)*']')? ('as' alias=ID)?;

Paragraph:
    SigDecl | FactDecl | PredDecl | FunDecl | AssertDecl | CmdDecl | EnumDecl | MacroDecl;

MacroDecl:
    'let' name=ID ('[' params+=ID (',' params+=ID)* ']')? '='? expr=Expr;

SigDecl:
    'var'? 'abstract'? mult=MULT? 'sig' name=ID (',' additionalSigs+=AdditionalSig)* sigExt=SigExt? 
    '{' (fields+=FieldDecl (',' fields+=FieldDecl)*)? '}' block=Block?;

AdditionalSig:
    name=ID;
    
SigExt:
    'extends' qualName=[NamedElement:ID] | 'in' qualName=[NamedElement:ID] ('+' qualNames+=[NamedElement:ID])*;

FieldDecl:
    'var'? decl=Decl;

Decl:
    'disj'? name=QualDeclName (',' additionalNames+=QualDeclName)* ':' 'disj'? expr=Expr;

FactDecl:
    'fact' name=QualName? block=Block;

PredDecl:
    'pred' (qualName=[NamedElement:ID] '.')? name=ID paraDecls=ParaDecls? block=Block;

FunDecl:
    'fun' (qualName=[NamedElement:ID] '.')? name=ID paraDecls=ParaDecls? ':' 
    (mult=MULT? first=Expr second=Expr | retType=Expr '{' body=Expr '}');

ParaDecls:
    '(' (decls+=Decl (',' decls+=Decl)*)? ')' | '[' (decls+=Decl (',' decls+=Decl)*)? ']';

AssertDecl:
    'assert' name=ID? block=Block;

EnumDecl:
    'private'? 'enum' name=ID '{' values+=ID (',' values+=ID)* '}';

CmdDecl:
    (name=ID ':')? (kind='run' | kind='check') (qualName=[NamedElement:ID] | block=Block) scope=Scope? 
    ('expect' expectNum=INT)? ('=>' chainedCmd=CmdDecl)?;

Scope:
    'for' number=INT ('but' typeScopes+=TypeScope (',' typeScopes+=TypeScope)*)? 
    | 'for' typeScopes+=TypeScope (',' typeScopes+=TypeScope)*;

TypeScope:
    'exactly'? number=INT ('..' (endNumber=INT (':' stepNumber=INT)?)?)? qualName=[NamedElement:ID];


Expr:
    QuantExpr;

QuantExpr infers Expr:
    ({infer QuantExpr} QUANT decls+=Decl (',' decls+=Decl)* blockOrBar=BlockOrBar)
    | SequenceExpr;

SequenceExpr infers Expr:
    DisjunctionExpr ({infer SequenceExpr.left=current} ';' right=DisjunctionExpr)*;

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
    | UnaryMultExpr;

UnaryMultExpr infers Expr:
    ({infer UnaryMultExpr} ('no' | 'lone' | 'one' | 'some' | 'set') expr=UnaryMultExpr)
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
        | {infer CallExpr.left=current} '[' args+=Expr (',' args+=Expr)* ']'  
    )*;

DotJoinExpr infers Expr:
    PrimitiveExpr ({infer DotJoinExpr.left=current} ('.' | '.*' | '.^' | '.~') right=PrimitiveExpr)*;

PrimitiveExpr infers Expr:
    PrimeExpr;

PrimeExpr infers Expr:
    UnaryExpr ({infer PrimeExpr.left=current} PRIME)*;

UnaryExpr infers Expr:
    ({infer UnaryExpr} ('~' | '^' | '*') expr=UnaryExpr)
    | PrimaryExpr;

PrimaryExpr infers Expr:
    Const 
    | QualName 
    | ({infer AtExpr} '@' ref=[NamedElement:ID])
    | ({infer ThisExpr} 'this')
    | ({infer ParenExpr} '(' expr=Expr ')')
    | Block
    | ({infer SetExpr} '{' decls+=Decl (',' decls+=Decl)* blockOrBar=BlockOrBar '}')
    | ({infer SumExpr} 'sum' decls+=Decl (',' decls+=Decl)* '|' expr=Expr)  
    | ({infer LetExpr} 'let' decls+=LetDecl (',' decls+=LetDecl)* blockOrBar=BlockOrBar)  
    | ({infer MetaExpr} qualName=QualName '$')  
    | STRING  
    ;


QualName:
    ('this/')? (names+=ID'/')* ID=[NamedElement:ID];

QualDeclName:
    ('this/')? (names+=ID'/')* name=ID;

ModulePath:
    ('this/')? (names+=ID'/')* name=ID;

Const:
    '-'? number=(INT | HEX_INT | BIN_INT) | 'none' | 'univ' | 'iden';

ArrowOp:
    (leftMult=('lone' | 'one') | leftSet='set')? '->' (rightMult=MULT | rightSet='set')?;

LetDecl:
    name=ID '=' expr=Expr;

Block:
    '{' statements+=BlockStatement* '}';

BlockStatement:
    expr=Expr ';'?;

BlockOrBar:
    block=Block | '|' expr=Expr;

CompareOp returns string:
    'in' | '=' | '<' | '>' | '=<' | '>=';

QUANT returns string: 'all' | 'no' | 'sum' | 'some';

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

