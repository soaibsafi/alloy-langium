import { createAlloyServices } from 'alloy-language';
import { NodeFileSystem } from 'langium/node';
import chalk from 'chalk';
import { performance } from 'node:perf_hooks';
import { extractDocuments, findAlloyFiles, printDiagnostics } from './util.js';

export async function validateAction(paths: string[]): Promise<void> {
    const startTime = performance.now();
    const services = createAlloyServices(NodeFileSystem).Alloy;

    let allFiles: string[] = [];
    for (const p of paths) {
        try {
            const files = await findAlloyFiles(p);
            allFiles.push(...files);
        } catch (err: any) {
            console.error(chalk.red(`Error accessing path '${p}': ${err.message}`));
            process.exit(1);
        }
    }

    // Remove duplicates
    allFiles = [...new Set(allFiles)];

    if (allFiles.length === 0) {
        console.warn(chalk.yellow('No .als files found to validate.'));
        return;
    }

    console.log(chalk.bold(`🔍 Validating ${allFiles.length} Alloy specification file(s)...\n`));

    const buildStart = performance.now();
    const documents = await extractDocuments(allFiles, services);
    const buildTime = (performance.now() - buildStart).toFixed(2);

    let totalErrors = 0;
    let totalWarnings = 0;
    let filesWithErrors = 0;

    for (const document of documents) {
        const filePath = document.uri.fsPath;
        try {
            const parserErrors = document.parseResult?.parserErrors ?? [];
            const { errors, warnings } = printDiagnostics(document);

            const fileErrors = errors + parserErrors.length;
            totalErrors += fileErrors;
            totalWarnings += warnings;

            if (fileErrors > 0) {
                filesWithErrors++;
                for (const pe of parserErrors) {
                    console.error(chalk.red(`  [SYNTAX] Line ${pe.token.startLine}:${pe.token.startColumn} - ${pe.message}`));
                }
                console.log(chalk.red(`✖ ${filePath} - ${fileErrors} error(s), ${warnings} warning(s)\n`));
            } else if (warnings > 0) {
                console.log(chalk.yellow(`⚠ ${filePath} - 0 errors, ${warnings} warning(s)\n`));
            } else {
                console.log(chalk.green(`✔ ${filePath}`));
            }
        } catch (err: any) {
            console.error(chalk.red(`✖ Failed to process ${filePath}: ${err.message}\n`));
            totalErrors++;
            filesWithErrors++;
        }
    }

    const totalTime = (performance.now() - startTime).toFixed(2);
    console.log(chalk.bold('\n=== VALIDATION SUMMARY ==='));
    console.log(`📁 Files checked:   ${allFiles.length}`);
    console.log(`✔ Passed files:     ${chalk.green(allFiles.length - filesWithErrors)}`);
    console.log(`✖ Failed files:     ${filesWithErrors > 0 ? chalk.red(filesWithErrors) : '0'}`);
    console.log(`🚫 Total errors:    ${totalErrors > 0 ? chalk.red(totalErrors) : '0'}`);
    console.log(`⚠ Total warnings:  ${totalWarnings > 0 ? chalk.yellow(totalWarnings) : '0'}`);
    console.log(`⏱ Workspace build:  ${buildTime}ms | Total time: ${totalTime}ms`);

    if (totalErrors > 0) {
        console.error(chalk.red.bold('\n✖ Validation failed with errors.'));
        process.exit(1);
    } else {
        console.log(chalk.green.bold('\n✔ All Alloy specifications passed validation!'));
    }
}
