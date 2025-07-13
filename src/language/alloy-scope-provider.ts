import { AstNodeDescription, DefaultScopeProvider, EMPTY_SCOPE, ReferenceInfo, Scope, AstUtils, AstNode } from 'langium';
import { AlloyModule, SigDecl, PredDecl, FunDecl, AssertDecl, QuantExpr, SetExpr, LetExpr, EnumDecl, isAlloyModule, isQuantExpr, isSetExpr, isLetExpr, isDecl, isFunDecl, isPredDecl, isModuleDecl } from './generated/ast.js';

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

        // Add module parameters
        elements.push(...this.collectModuleParameters(model));

        // Add all signature names
        elements.push(...this.collectSigNames(model));
        // Add all field names
        elements.push(...this.collectFieldNames(model));
        // Add all enum declarations (type names like Color)
        elements.push(...this.collectEnumDeclarations(model));
        // Add all enum values
        elements.push(...this.collectEnumValues(model));
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
                            if (decl.name && decl.name.name) {
                                elements.push(this.descriptions.createDescription(decl, decl.name.name));
                            }
                            // Add additional variable names
                            if (decl.additionalNames) {
                                for (const additionalName of decl.additionalNames) {
                                    if (additionalName.name) {
                                        elements.push(this.descriptions.createDescription(decl, additionalName.name));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // Check for set comprehension expressions that introduce variables
            else if (isSetExpr(current)) {
                const setExpr = current as SetExpr;
                if (setExpr.decls) {
                    for (const decl of setExpr.decls) {
                        if (isDecl(decl)) {
                            // Add primary variable name
                            if (decl.name && decl.name.name) {
                                elements.push(this.descriptions.createDescription(decl, decl.name.name));
                            }
                            // Add additional variable names
                            if (decl.additionalNames) {
                                for (const additionalName of decl.additionalNames) {
                                    if (additionalName.name) {
                                        elements.push(this.descriptions.createDescription(decl, additionalName.name));
                                    }
                                }
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
                            if (decl.name && decl.name.name) {
                                elements.push(this.descriptions.createDescription(decl, decl.name.name));
                            }
                            // Add additional parameter names
                            if (decl.additionalNames) {
                                for (const additionalName of decl.additionalNames) {
                                    if (additionalName.name) {
                                        elements.push(this.descriptions.createDescription(decl, additionalName.name));
                                    }
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
                            if (decl.name && decl.name.name) {
                                elements.push(this.descriptions.createDescription(decl, decl.name.name));
                            }
                            // Add additional parameter names
                            if (decl.additionalNames) {
                                for (const additionalName of decl.additionalNames) {
                                    if (additionalName.name) {
                                        elements.push(this.descriptions.createDescription(decl, additionalName.name));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // Check for let expressions that introduce variables
            else if (isLetExpr(current)) {
                const letExpr = current as LetExpr;
                if (letExpr.decls) {
                    for (const letDecl of letExpr.decls) {
                        if (letDecl.name) {
                            elements.push(this.descriptions.createDescription(letDecl, letDecl.name));
                        }
                    }
                }
            }
            current = current.$container;
        }

        return elements;
    }

    private collectModuleParameters(model: AlloyModule): AstNodeDescription[] {
        const elements: AstNodeDescription[] = [];

        // Check if the model is a ModuleDecl with parameters
        if (isModuleDecl(model) && model.params) {
            for (const param of model.params) {
                if (param.name) {
                    elements.push(this.descriptions.createDescription(param, param.name, param.$document));
                }
            }
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
                            if (fieldDecl.decl.name && fieldDecl.decl.name.name) {
                                elements.push(this.descriptions.createDescription(fieldDecl.decl, fieldDecl.decl.name.name));
                            }
                            // Add additional field names
                            if (fieldDecl.decl.additionalNames) {
                                for (const additionalName of fieldDecl.decl.additionalNames) {
                                    if (additionalName.name) {
                                        elements.push(this.descriptions.createDescription(fieldDecl.decl, additionalName.name));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return elements;
    }

    private collectEnumDeclarations(model: AlloyModule): AstNodeDescription[] {
        const elements: AstNodeDescription[] = [];

        for (const paragraph of model.paragraph) {
            if (paragraph.$type === 'EnumDecl') {
                const enumDecl = paragraph as EnumDecl;
                
                // Add enum type name like Color from enum Color {GREEN, RED}
                if (enumDecl.name) {
                    elements.push(this.descriptions.createDescription(enumDecl, enumDecl.name, enumDecl.$document));
                }
            }
        }

        return elements;
    }

    private collectEnumValues(model: AlloyModule): AstNodeDescription[] {
        const elements: AstNodeDescription[] = [];

        for (const paragraph of model.paragraph) {
            if (paragraph.$type === 'EnumDecl') {
                const enumDecl = paragraph as EnumDecl;
                
                // Add enum values like GREEN, RED from enum Color {GREEN, RED}
                if (enumDecl.values) {
                    for (const value of enumDecl.values) {
                        elements.push(this.descriptions.createDescription(enumDecl, value, enumDecl.$document));
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