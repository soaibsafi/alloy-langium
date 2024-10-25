grammar Alloy

entry AlloyModule:
    ModuleDecl? import+=Import* paragraph+=Paragraph*;

ModuleDecl:
    'module' qualName=QualName (name=ID (',' name+=ID)*)?; 

Import:
    'open' qualName=QualName ('['name+=QualName (',' name+=QualName)*']')? ('as' name=ID)?;

// paragraph ::= sigDecl | factDecl | predDecl | funDecl | assertDecl | cmdDecl
Paragraph:
    sig=SigDecl | fact=FactDecl | pred=PredDecl | fun=FunDecl | assert=AssertDecl | cmd=CmdDecl
    ;

//sigDecl ::= [var] [abstract] [mult] sig name,+ [sigExt] { fieldDecl,* } [block]
SigDecl:
    'var'? 'abstract'? MULT? 'sig' (name=ID (',' name=ID)*)? sigExt=SigExt? 
    '{' (name=FieldDecl (',' name=FieldDecl)*)* '}' (block=Block)?
    ;
    
//sigExt ::= extends qualName | in qualName [+ qualName]*
SigExt:
    'extends' qualName=QualName | 'in' qualName=QualName ('+' qualName=QualName)* ;

// fieldDecl ::= [var] decl
FieldDecl:
    'var'? decl=Decl;

//decl ::= [disj] name,+ : [disj] expr
Decl:
    'disj'? (name=ID (',' name=ID)*)+ ':' 'disj'? Expr;


//factDecl ::= fact [name] block
FactDecl:
    'fact' name=ID? block=Block;

// predDecl ::= pred [qualName .] name [paraDecls] block
PredDecl:
    'pred' (qualName=QualName '.')? name=ID paraDecls=ParaDecls? block=Block;

// funDecl ::= fun [qualName .] name [paraDecls] : expr { expr }
FunDecl:
    'fun' (qualName=QualName '.')? name=ID paraDecls=ParaDecls? ':' Expr '{' expr=Expr '}' ;

// paraDecls ::= ( decl,* ) | [ decl,* ]
ParaDecls:
    (decl=Decl (',' decl+=Decl)*)* | '[' (decl=Decl (',' decl=Decl)*)* ']';

// assertDecl ::= assert [name] block
AssertDecl:
    'assert' name=ID? block=Block;

// cmdDecl ::= [name :] ( run | check ) ( qualName | block ) [scope]
CmdDecl:
    (name=ID ':')? ('run' | 'check') (qualName=QualName | block=Block ) scope=Scope?; //FIXME: block=Block;

// scope ::= for number [but typescope,+] | for typescope,+
Scope:
    'for' number=INT ('but' typescope=TypeScope (',' typescope=TypeScope)*) | 'for' typescope=TypeScope (',' typescope=TypeScope)*;

// typescope ::= [exactly] number qualName
TypeScope:
    'exactly'? number=INT qualName=QualName;


Expr infers Expr:
    PrimaryExpr (BINARY_OP pr=PrimaryExpr)*
    | PrimaryExpr (ao=ArrowOp pr=PrimaryExpr)*
    | PrimaryExpr (COMPARE_OP pr=PrimaryExpr)*
    | PrimaryExpr ('=>' | 'implies') PrimaryExpr 'else' PrimaryExpr
    | 'let' (letDlcr=LetDecl (',' letDlcr=LetDecl)*)+ BlockOrBar
    | QUANT (decl=Decl (',' decl=Decl)*)+ BlockOrBar
    | '{' (decl=Decl (',' decl=Decl)*)+ '}'
    | PrimaryExpr '\''
    | '(' Expr ')' | Block
    ;

PrimaryExpr:
    Const | QualName | '@'ID | 'this'
    | UnaryOp PrimaryExpr
    | '(' Expr ')'
    ;


////////////////////////////
// Left recursion removed Example
// Expr infers Expr:
//     PrimaryExpr (ArrowOp right=PrimaryExpr)*;

// PrimaryExpr:
//     name=ID;

////////////////////////////
// qualName ::= [this/] ( name / )* name
QualName:
    ('this/')? (name+=ID'/')* name=ID;


// const ::= [-] number | none | univ | iden
Const:
    '-'? number=INT | 'none' | 'univ' | 'iden';

// ArrowOp ::= [mult | set] -> [mult | set]
ArrowOp:
    (mult=MULT | 'set')? '->' (mult=MULT | 'set')?;

//UnaryOp ::= ! | not | no | mult | set | # | ~ | * | ^ | always | eventually | after | before | historically | once
UnaryOp returns string:
    '!' | 'not' | 'no' | MULT | 'set' | '#' | '~' | '*' | '^' | 'always' | 'eventually' | 'after' | 'before' | 'historically' | 'once';

// binOp ::= || | or | && | and | <=> | iff | => | implies | & | + | - | ++ | <: | :> | . | until | releases | since | triggered | ;
BINARY_OP returns string: '||' | 'or' | '&&' | 'and' | '<=>' | 'iff' | '=>' | 'implies' | '&' | '+' | '-' | '++' | '<:' | ':>' | '.' | 'until' | 'releases' | 'since' | 'triggered' | ';';

// compareOp ::= in | = | < | > | =< | >=
terminal COMPARE_OP: 'in' | '=' | '<' | '>' | '=<' | '=>';

// letDecl ::= name = expr
LetDecl:
    name=ID '=' expr=Expr;

//block ::= { expr* }
Block:
    '{' (expr=Expr)* '}';

// blockOrBar ::= block | bar expr
BlockOrBar:
    block=Block | BAR expr=Expr;

// bar ::= |
terminal BAR: '|';

// quant ::= all | no | sum | mult
QUANT returns string: 'all' | 'no' | 'sum' | MULT;




MULT returns string: 'lone' | 'some' | 'one';


hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_\"]*/;
terminal INT: /\d+/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /(?:\/\/|--)[^\n\r]*/;

