# alloy-language

The Alloy 6 language implementation: grammar, scoping, type checking, validation and LSP services. It has no Node.js dependencies and runs in the browser as well.

```ts
import { createAlloyServices } from 'alloy-language';
const { shared, Alloy } = createAlloyServices({ connection, ...fileSystem });
```

## Layout

- [src/alloy.langium](src/alloy.langium) – grammar, following Alloy's own parser (`Alloy.cup`, `Alloy.lex`, `CompFilter.java`)
- [src/alloy-scope-provider.ts](src/alloy-scope-provider.ts), [src/alloy-scope-computation.ts](src/alloy-scope-computation.ts) – name resolution: local variables, then the module's declarations, then opened modules, then builtins
- [src/typing](src/typing) – the type checker
  - [alloy-types.ts](src/typing/alloy-types.ts) – relational types (unions of products of primitive signatures), as in `edu.mit.csail.sdg.ast.Type`
  - [sig-model.ts](src/typing/sig-model.ts) – the signature hierarchy (`extends`, `in`, `=`, enums, module parameters)
  - [type-checker.ts](src/typing/type-checker.ts) – types of all expressions and the type errors and warnings of a document
- [src/validation](src/validation) – validation checks
- [src/lsp](src/lsp) – hover, document symbols, semantic tokens, signature help and code actions
- [test](test) – Vitest suites; `npm test`

## Type checking

The checker computes the relational type of every expression (e.g. `{this/Person->this/Addr}`) and reports the type errors of the Alloy Analyzer with its wording, for example:

- `+ can be used only between 2 expressions of the same arity, or between 2 integer expressions.`
- `This cannot be a legal relational join where left hand side is ... right hand side is ...`
- `This must be a formula expression.` / `This must be a set or relation.` / `This must be an integer expression.`
- `pred this/p has 2 parameters but is called with 3 arguments.`, `This should have arity 1 but ...`

and its warnings (`The join operation here always yields an empty set.`, `& is irrelevant because the two subexpressions are always disjoint.`, `Function return value is disjoint from its return type.`, `This variable is unused.`).

Like Alloy, it resolves overloaded names by type: fields of different sigs with the same name, predicates and functions of the module and of opened modules (including modules opened indirectly), and user declarations named like integer functions (`add`, `max`, ...). Inside the facts and fields of a sig, a field may mean `this.field`. Parameters of opened modules are instantiated (`open util/ordering[State]` makes `first` a `State`).

The checker only reports definite errors: a type it cannot determine (unresolved names, macros, builtin integer functions) is unknown and compatible with everything.

Further checks: the signature hierarchy (cyclic inheritance, extending a subset or builtin sig, abstract subset sigs, conflicting multiplicities), command targets (`check` needs an assertion, `run` a predicate or function) and scopes (`univ`, `none`, `exactly` or growing `Int`/`seq` scopes).
