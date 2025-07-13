import { AstNodeDescription, DefaultScopeProvider, EMPTY_SCOPE, ReferenceInfo, Scope, AstUtils, AstNode } from 'langium';
import { AlloyModule, SigDecl, PredDecl, FunDecl, AssertDecl, QuantExpr, isAlloyModule, isQuantExpr, isDecl, isFunDecl, isPredDecl, isLetDecl } from './generated/ast.js';

export class AlloyScopeProvider extends DefaultScopeProvider {

    override getScope(context: ReferenceInfo): Scope {
        const referenceType = this.reflection.getReferenceType(context);
        console.log('Reference type:', referenceType, 'for property:', context.property);

        // Handle different reference types with union types
        if (referenceType === 'NamedElement') {
            return this.createNamedElementScope(context);
        }


        return super.getScope(context);
    }

    private createNamedElementScope(context: ReferenceInfo): Scope {
        const model = AstUtils.getContainerOfType(context.container, isAlloyModule);
        if (!model) return EMPTY_SCOPE;

        const elements: AstNodeDescription[] = [];

        // Add local quantified variables first (they have priority)
        elements.push(...this.collectLocalVariables(context));

        // Add all signature names
        elements.push(...this.collectSigNames(model));
        // Add all field names
        elements.push(...this.collectFieldNames(model));
        // Add all predicates
        elements.push(...this.collectPredicates(model));
        // Add all functions
        elements.push(...this.collectFunctions(model));
        // Add all assertions
        elements.push(...this.collectAssertions(model));

        return this.createScope(elements);
    }

    private collectLocalVariables(context: ReferenceInfo): AstNodeDescription[] {
        const elements: AstNodeDescription[] = [];
        let current: AstNode | undefined = context.container;

        // Walk up the AST to find quantifier expressions that introduce variables
        while (current) {
            if (isQuantExpr(current)) {
                const quantExpr = current as QuantExpr;
                if (quantExpr.decls) {
                    for (const decl of quantExpr.decls) {
                        if (isDecl(decl)) {
                            // Add primary variable name
                            if (decl.name) {
                                elements.push(this.descriptions.createDescription(decl, decl.name));
                            }
                            // Add additional variable names
                            if (decl.additionalNames) {
                                for (const additionalName of decl.additionalNames) {
                                    elements.push(this.descriptions.createDescription(decl, additionalName));
                                }
                            }
                        } else if (isLetDecl(decl)) {
                            // Add let-bound variable name
                            if (decl.name) {
                                elements.push(this.descriptions.createDescription(decl, decl.name));
                            }
                        }
                    }
                }
            }
            // Check for function declarations with parameters
            else if (isFunDecl(current)) {
                const funDecl = current as FunDecl;
                if (funDecl.paraDecls && funDecl.paraDecls.decls) {
                    for (const decl of funDecl.paraDecls.decls) {
                        if (isDecl(decl)) {
                            // Add primary parameter name
                            if (decl.name) {
                                elements.push(this.descriptions.createDescription(decl, decl.name));
                            }
                            // Add additional parameter names
                            if (decl.additionalNames) {
                                for (const additionalName of decl.additionalNames) {
                                    elements.push(this.descriptions.createDescription(decl, additionalName));
                                }
                            }
                        }
                    }
                }
            }
            // Check for predicate declarations with parameters
            else if (isPredDecl(current)) {
                const predDecl = current as PredDecl;
                if (predDecl.paraDecls && predDecl.paraDecls.decls) {
                    for (const decl of predDecl.paraDecls.decls) {
                        if (isDecl(decl)) {
                            // Add primary parameter name
                            if (decl.name) {
                                elements.push(this.descriptions.createDescription(decl, decl.name));
                            }
                            // Add additional parameter names
                            if (decl.additionalNames) {
                                for (const additionalName of decl.additionalNames) {
                                    elements.push(this.descriptions.createDescription(decl, additionalName));
                                }
                            }
                        }
                    }
                }
            }
            current = current.$container;
        }

        return elements;
    }


    private collectSigNames(model: AlloyModule): AstNodeDescription[] {
        const elements: AstNodeDescription[] = [];

        for (const paragraph of model.paragraph) {
            if (paragraph.$type === 'SigDecl') {
                const sigDecl = paragraph as SigDecl;

                // Add the primary signature name
                if (sigDecl.name) {
                    elements.push(this.descriptions.createDescription(sigDecl, sigDecl.name, sigDecl.$document));
                }

                // Add additional signature names - each has its own AST node now
                if (sigDecl.additionalSigs) {
                    for (const additionalSig of sigDecl.additionalSigs) {
                        elements.push(this.descriptions.createDescription(additionalSig, additionalSig.name, additionalSig.$document));
                    }
                }
            }
        }

        return elements;
    }

    private collectFieldNames(model: AlloyModule): AstNodeDescription[] {
        const elements: AstNodeDescription[] = [];

        for (const paragraph of model.paragraph) {
            if (paragraph.$type === 'SigDecl') {
                const sigDecl = paragraph as SigDecl;
                if (sigDecl.fields) {
                    for (const fieldDecl of sigDecl.fields) {
                        if (fieldDecl.decl) {
                            // Add primary field name
                            if (fieldDecl.decl.name) {
                                elements.push(this.descriptions.createDescription(fieldDecl.decl, fieldDecl.decl.name));
                            }
                            // Add additional field names
                            if (fieldDecl.decl.additionalNames) {
                                for (const additionalName of fieldDecl.decl.additionalNames) {
                                    elements.push(this.descriptions.createDescription(fieldDecl.decl, additionalName));
                                }
                            }
                        }
                    }
                }
            }
        }

        return elements;
    }

    private collectPredicates(model: AlloyModule): AstNodeDescription[] {
        const elements: AstNodeDescription[] = [];

        for (const paragraph of model.paragraph) {
            if (paragraph.$type === 'PredDecl') {
                const predDecl = paragraph as PredDecl;
                if (predDecl.name) {
                    elements.push(this.descriptions.createDescription(predDecl, predDecl.name));
                }
            }
        }

        return elements;
    }

    private collectFunctions(model: AlloyModule): AstNodeDescription[] {
        const elements: AstNodeDescription[] = [];

        for (const paragraph of model.paragraph) {
            if (paragraph.$type === 'FunDecl') {
                const funDecl = paragraph as FunDecl;
                if (funDecl.name) {
                    elements.push(this.descriptions.createDescription(funDecl, funDecl.name));
                }
            }
        }

        return elements;
    }

    private collectAssertions(model: AlloyModule): AstNodeDescription[] {
        const elements: AstNodeDescription[] = [];

        for (const paragraph of model.paragraph) {
            if (paragraph.$type === 'AssertDecl') {
                const assertDecl = paragraph as AssertDecl;
                if (assertDecl.name) {
                    elements.push(this.descriptions.createDescription(assertDecl, assertDecl.name));
                }
            }
        }

        return elements;
    }
}