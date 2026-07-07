
<div align="center">
   <h1>Alloy Language Server & Tooling</h1>
  <img src="https://img.shields.io/badge/Langium-v4.1.0-blue.svg" alt="Langium v4.1.0">
   <img src="https://img.shields.io/badge/TypeScript-5.8.3-blue.svg" alt="TypeScript v5.8.3">
   <img src="https://img.shields.io/badge/Node.js-%3E%3D20.10.0-green.svg" alt="Node.js >=20.10.0">
   <img src="https://img.shields.io/badge/VS%20Code-%3E%3D1.67.0-purple.svg" alt="VS Code >=1.67.0">
   <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
</div>

---
A modern, high-performance Language Server Protocol (LSP) implementation, Command-Line Interface (CLI), and Visual Studio Code extension for the [Alloy Analyzer](https://alloytools.org/) formal specification language, powered by **Langium**.



## Overview & Key Features

Alloy is a powerful formal modeling language for expressing complex structural and behavioral constraints in software systems. `alloy-langium` brings state-of-the-art IDE features, semantic analysis, and automation tooling to Alloy specification development:

- **Langium 4**: Built on modern TypeScript dependency injection, robust AST processing, and high-performance incremental document parsing.
- **Cross-File Scoping & Linking**: Automatically indexes and resolves module imports across entire workspaces (including standard Alloy library modules like `util/ordering`, `util/relation`, and custom imports).
- **Semantic Validation & Diagnostics**: Real-time syntax error detection, reference checking, and semantic diagnostics with precise line/column positioning.
- **Rich VS Code Integration**: Live status bar metrics, editor title shortcuts, interactive complexity reports, and configurable LSP tracing.

---

## Architecture

This project is organized as a multi-package npm workspace:

```
alloy-langium/
├── packages/
│   ├── language/       # alloy-language: Core Langium grammar, AST, validation & scoping
│   ├── cli/            # alloy-cli: Command-line interface for validation, analysis & export
│   └── extension/      # vscode-alloy-langium: VS Code language client & UI extension
├── resources/          # Alloy reference models and libraries
└── tsconfig.build.json # TypeScript composite build configuration
```

1. `packages/language` (`alloy-language`)

The foundational language core. Contains the Langium grammar (`alloy.langium`), generated AST types, DI module (`AlloyLanguageModule`), custom scoping provider (`AlloyScopeProvider`), validator (`AlloyValidator`), and comprehensive model analysis/complexity scoring algorithms.

2. `packages/cli` (`alloy-cli`)

A versatile CLI tool built with Commander.js and Chalk for interacting with Alloy specifications in automated workflows, CI/CD pipelines, or terminal environments.

3. `packages/extension` (`vscode-alloy-langium`)

The VS Code extension that connects to the language server via IPC. Contributes custom editor commands, an active status bar item, and output channel logging.

---

## Getting Started

### Prerequisites

- **Node.js**: `>= 20.10.0` (Volta recommended: Node 20.19.2)
- **npm**: `>= 10.2.3`

### Installation & Build

1. **Clone the repository and install dependencies**:

   ```bash
   git clone https://github.com/soaibsafi/alloy-langium
   cd alloy-langium
   npm install
   ```

2. **Build the entire workspace**:

   ```bash
   npm run build
   ```

   This compiles TypeScript project references across all packages and bundles the VS Code extension using `esbuild`.

3. **Run the test suites**:
   ```bash
   npm test
   ```
   Executes unit and integration tests across all packages (including 71+ language core tests analyzing 55+ formal specifications from the Alloy book).

---


## License

This project is licensed under the **MIT License**. See the project root for details.

## Acknowledgments

- [Alloy Analyzer & Daniel Jackson](https://alloytools.org/) for the formal modeling language.
- [Langium Team](https://langium.org/) for the modern language engineering framework.
