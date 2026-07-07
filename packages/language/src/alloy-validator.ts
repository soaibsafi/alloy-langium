import type { ValidationChecks } from 'langium';
import type { AlloyAstType } from './generated/ast.js';
import type { AlloyServices } from './alloy-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: AlloyServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.AlloyValidator;
    const checks: ValidationChecks<AlloyAstType> = {
        // Add your custom validation checks here
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class AlloyValidator {
    // Add custom validation methods here
}
