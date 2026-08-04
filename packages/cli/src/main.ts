import type { AlloyModule } from 'alloy-language';
import { createAlloyServices, AlloyLanguageMetaData } from 'alloy-language';
import chalk from 'chalk';
import { Command } from 'commander';
import { extractDocument } from './util.js';
import { validateAction } from './validator-cli.js';
import { NodeFileSystem } from 'langium/node';
import * as url from 'node:url';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');

export const astAction = async (fileName: string): Promise<void> => {
    const services = createAlloyServices(NodeFileSystem).Alloy;
    const document = await extractDocument(fileName, services);
    const ast = document.parseResult?.value as AlloyModule;

    if (!ast) {
        console.error(chalk.red(`✖ Could not parse AST from ${fileName}`));
        process.exit(1);
    }

    const astSummary = {
        file: fileName,
        paragraphCount: ast.paragraph?.length ?? 0,
        paragraphs: (ast.paragraph || []).map((p: any) => ({
            type: p.$type,
            name: p.name || undefined,
            extends: p.superSig ? (p.superSig.ref?.name || p.superSig.$refText) : undefined
        }))
    };

    console.log(chalk.bold(`\n=== AST DUMP: ${fileName} ===`));
    console.log(JSON.stringify(astSummary, null, 2));
};

export default function(): void {
    const program = new Command();
    program.version(JSON.parse(packageContent).version);

    const fileExtensions = AlloyLanguageMetaData.fileExtensions.join(', ');

    program
        .command('validate [paths...]')
        .alias('check')
        .description(`validate one or more Alloy specification files or directories (extensions: ${fileExtensions})`)
        .action(async (paths: string[]) => {
            const targetPaths = paths.length > 0 ? paths : ['.'];
            await validateAction(targetPaths);
        });

    program
        .command('ast <file>')
        .alias('dump')
        .description('dump the parsed Abstract Syntax Tree (AST) structure of an Alloy file')
        .action(astAction);

    program.parse(process.argv);
}
