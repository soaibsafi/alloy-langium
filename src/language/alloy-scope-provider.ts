import { AstNodeDescription, DefaultScopeProvider, EMPTY_SCOPE, ReferenceInfo, Scope, AstUtils, AstNode } from 'langium';
import { AlloyModule, SigDecl, PredDecl, FunDecl, QuantExpr, isAlloyModule, isQuantExpr, isDecl } from './generated/ast.js';

export class AlloyScopeProvider extends DefaultScopeProvider {

    override getScope(context: ReferenceInfo): Scope {
        const referenceType = this.reflection.getReferenceType(context);
        console.log('Reference type:', referenceType, 'for property:', context.property);
        
        // Handle different reference types with union types
        if (referenceType === 'NamedElement') {
            return this.createNamedElementScope(context);
        } else if (referenceType === 'SigName') {
            return this.createSigNameScope(context);
        } else if (referenceType === 'ScopableElement') {
            return this.createScopableElementScope(context);
        } else if (referenceType === 'CallableElement') {
            return this.createCallableElementScope(context);
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
                        if (isDecl(decl) && decl.names) {
                            for (const varName of decl.names) {
                                elements.push(this.descriptions.createDescription(varName, varName.name));
                            }
                        }
                    }
                }
            }
            current = current.$container;
        }
        
        return elements;
    }

    private createSigNameScope(context: ReferenceInfo): Scope {
        const model = AstUtils.getContainerOfType(context.container, isAlloyModule);
        if (!model) return EMPTY_SCOPE;
        
        return this.createScope(this.collectSigNames(model));
    }

    private createScopableElementScope(context: ReferenceInfo): Scope {
        const model = AstUtils.getContainerOfType(context.container, isAlloyModule);
        if (!model) return EMPTY_SCOPE;

        const elements: AstNodeDescription[] = [];
        
        // Add signature names (for type scoping in run/check commands)
        elements.push(...this.collectSigNames(model));
        // Add predicates and functions (callable elements)
        elements.push(...this.collectPredicates(model));
        elements.push(...this.collectFunctions(model));
        
        return this.createScope(elements);
    }

    private createCallableElementScope(context: ReferenceInfo): Scope {
        const model = AstUtils.getContainerOfType(context.container, isAlloyModule);
        if (!model) return EMPTY_SCOPE;

        const elements: AstNodeDescription[] = [];
        elements.push(...this.collectPredicates(model));
        elements.push(...this.collectFunctions(model));
        
        return this.createScope(elements);
    }

    private collectSigNames(model: AlloyModule): AstNodeDescription[] {
        const elements: AstNodeDescription[] = [];
        
        for (const paragraph of model.paragraph) {
            if (paragraph.$type === 'SigDecl') {
                const sigDecl = paragraph as SigDecl;
                if (sigDecl.names) {
                    for (const sigName of sigDecl.names) {
                        elements.push(this.descriptions.createDescription(sigName, sigName.name));
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
                        if (fieldDecl.decl && fieldDecl.decl.names) {
                            for (const fieldName of fieldDecl.decl.names) {
                                elements.push(this.descriptions.createDescription(fieldName, fieldName.name));
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
}