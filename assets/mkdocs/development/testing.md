# Testing

Agent Board uses Vitest for unit testing and manual testing in VS Code for integration tests.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

## Test Structure

```
tests/
├── unit/
│   ├── yaml-parser.test.ts      # BoardSettings YAML parser
│   ├── decision-parser.test.ts  # Agent decision parsing
│   ├── agent-config.test.ts     # Agent configuration loading
│   └── domain-types.test.ts     # Domain type validation
└── integration/
    └── backend-registry.test.ts # Backend resolution logic
```

## What to Test

### Unit Tests

- **YAML Parser** (`BoardSettings.parseYaml`) — Handles flat values, nested sections, lists, edge cases
- **Decision Parser** (`parseAgentDecision`) — Extracts DECISION, NEXT_STAGE, COMMENTS from agent output
- **File Block Parser** (`parseFileBlocks`) — Parses file write instructions from agent output
- **Domain Types** — Stage transitions, validation rules
- **Agent Config Loading** — Role mapping, config merging

### Integration Tests

- **Backend Registry** — Resolution order, fallback behavior, availability detection
- **Agent Execution** — End-to-end agent run with mock backend

### Manual Testing

For features involving VS Code APIs:

1. Build and deploy the extension
2. Open to the Agent Board sidebar
3. Create a task and verify stage transitions
4. Test each backend independently
5. Verify persistence (reload VS Code and check tasks are restored)

## Writing Tests

```typescript
import { describe, it, expect } from 'vitest'

describe('parseYaml', () => {
  it('should parse flat key-value pairs', () => {
    const yaml = `name: My Board\nmaxTasks: 10`
    const result = parseYaml(yaml)
    expect(result.name).toBe('My Board')
    expect(result.maxTasks).toBe('10')
  })

  it('should parse nested sections', () => {
    const yaml = `agents:\n  configPath: /path/to/config`
    const result = parseYaml(yaml)
    expect(result.agents.configPath).toBe('/path/to/config')
  })
})
```

## Mocking

For tests that need VS Code APIs:

```typescript
// Mock vscode module
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => [])
    }))
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn()
    }))
  }
}))
```
