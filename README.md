# Seeker UI – The Visual AI Workspace

**Recent Updates**

The latest release introduces several powerful new features and improvements:

- **Comprehensive Text Editor**: A fast, full-featured editor for seamless in-app file editing.
- **Venice API Integration**: Access uniquely secure and private inference endpoints.
- **UI Overhaul**: A smoother, more intuitive workflow across editing, inferencing, and file management.

**Future Roadmap**

- Migrate inference orchestration to an **agentic architecture**, enabling complex multi-node workflows and easy integration with external MCP servers.
- Add a dedicated remote **web search and scraping MCP server** to provide enriched, real-time context for coding (documentation lookup) and writing tasks (live web content).

## Introduction

Seeker UI is a visual, AI‑assisted workspace for coding and writing projects. It brings together file browsing, structured prompt engineering, and inference results into a single desktop application designed for developers, technical writers, and content creators. Unlike command‑line tools that require memorising flags and juggling separate scripts, Seeker UI offers:

- **A graphical file explorer** with per‑file checkboxes and a live preview.
- **A prompt organiser** that builds structured prompts from your system prompt, task description, issues, and selected files – all saved per project folder.
- **One‑click inference** with model selection and temperature – no curl commands, no JSON formatting by hand.
- **Inline block‑based updates** that let you review AI‑proposed changes before applying them to your files.
- **Local‑first storage** – your API keys, prompts, and folder states stay on your machine, with optional redaction to protect sensitive data.

<img src="README.pic1.jpg">

<img src="README.pic2.jpg">

For detailed instructions on how to use the application, please refer to the [Manual](Manual.md).

---

## Installation

### Installing on Windows

Windows may display a "Windows protected your PC" warning during installation. This occurs because the binary is not digitally signed. To avoid the high recurring costs of Certificate Authority subscriptions and the overhead of maintaining a hardware security module for a personal open-source project, I have chosen not to apply code signing at this time. You can proceed by clicking "More info" and then "Run anyway."

### Installing on macOS

Applications downloaded outside the App Store are often blocked by Gatekeeper. Due to the cost of maintaining an Apple Developer Program membership and the complexity of automated notarization pipelines for independent developers, this app is not notarized. To run the app, please execute the following command in your Terminal to remove the quarantine attribute:

```bash
xattr -rd com.apple.quarantine /Applications/seeker-ui.app
```

### Linux Support

There are currently no plans to release a pre-compiled Linux binary. However, the source code is fully compatible with Linux environments. Developers interested in running the app on Linux can build it themselves by following these simple steps:

1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Run `npm run package:linux` to generate an AppImage or distribution-specific package.