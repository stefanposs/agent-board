# Contributing

Thank you for your interest in contributing to Agent Board!

## Guidelines

### Code Quality

- Use TypeScript strict mode — no `any` types
- Follow existing patterns and conventions
- Keep functions under 50 lines where possible
- Use descriptive variable and function names
- Add JSDoc comments for public APIs

### Commits

Use conventional commit messages:

```
feat: add new backend support for Ollama
fix: resolve path traversal in file write handler
docs: update backend selection guide
refactor: extract agent orchestration from main.ts
test: add YAML parser edge case tests
```

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Build: `npm run build:all`
6. Submit a pull request with a clear description

### Security

- Never use `execSync` — always use `execFileSync` for subprocess calls
- Validate all file paths against workspace boundaries
- Use crypto-grade nonces for CSP
- Don't trust user input or agent output without validation

## Architecture Decisions

When proposing architectural changes:

1. Describe the problem clearly
2. Propose at least two alternatives
3. Explain trade-offs
4. Document the decision in `/docs/`

## Reporting Issues

- Use GitHub Issues
- Include VS Code version, OS, and extension version
- Provide reproduction steps
- Attach relevant logs from the "Agent Board" output channel
