import { AstNode, isAstNode } from 'langium';
import { SigDecl } from './generated/ast.js';

/**
 * Custom service to handle multi-name signature declarations.
 * Expands declarations like "sig A, B, C {}" into separate AST nodes.
 */
export class AlloyAstProcessor {
    
    /**
     * Post-process the AST to expand multi-name signatures.
     */
    processAst(root: AstNode): AstNode {
        return this.processNode(root);
    }
    
    private processNode(node: AstNode): AstNode {
        // Process all children first (bottom-up)
        for (const [propertyName, value] of Object.entries(node)) {
            if (Array.isArray(value)) {
                const newArray: AstNode[] = [];
                for (const item of value) {
                    if (isAstNode(item)) {
                        const processed = this.processNode(item);
                        if (this.isSigDecl(processed) && this.isMultiNameSig(processed)) {
                            // Expand multi-name signature into multiple single-name signatures
                            newArray.push(...this.expandMultiNameSig(processed));
                        } else {
                            newArray.push(processed);
                        }
                    } else {
                        newArray.push(item);
                    }
                }
                (node as any)[propertyName] = newArray;
            } else if (isAstNode(value)) {
                (node as any)[propertyName] = this.processNode(value);
            }
        }
        
        return node;
    }
    
    private isSigDecl(node: AstNode): node is SigDecl {
        return node.$type === 'SigDecl';
    }
    
    private isMultiNameSig(sig: SigDecl): boolean {
        return (sig as any).names && (sig as any).names.length > 1;
    }
    
    private expandMultiNameSig(sig: SigDecl): SigDecl[] {
        const names = (sig as any).names as string[];
        const result: SigDecl[] = [];
        
        for (const name of names) {
            // Create a new signature node for each name
            const newSig: any = {
                $type: 'SigDecl',
                $container: sig.$container,
                mult: sig.mult,
                sigExt: sig.sigExt,
                fields: sig.fields,
                block: sig.block,
                name: name, // Single name property for cross-references
                names: [name] // Keep original structure for compatibility
            };
            
            result.push(newSig as SigDecl);
        }
        
        return result;
    }
}
