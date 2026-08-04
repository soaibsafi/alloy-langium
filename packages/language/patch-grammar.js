import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const grammarPath = join(__dirname, 'syntaxes', 'alloy.tmLanguage.json');
let content = readFileSync(grammarPath, 'utf8');

// Patch the begin quote to use a negative lookbehind, so identifiers like m" or m"" don't trigger strings
content = content.replace(
    /"begin": "\\""/g,
    `"begin": "(?<![a-zA-Z0-9_\\"])\\""`
);

writeFileSync(grammarPath, content, 'utf8');
