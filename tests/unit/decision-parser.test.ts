import { describe, it, expect } from 'vitest'

// ─── Inline copy of parseAgentDecision for unit testing ─────────

interface AgentDecision {
  action: string
  reason: string
  questions: string[]
  confidence: number
}

function parseAgentDecision(content: string): AgentDecision | null {
  const patterns = [
    /```decision\s*\n([\s\S]*?)\n```/,
    /```json\s*\n(\{[\s\S]*?"action"[\s\S]*?\})\n```/,
  ]

  for (const pattern of patterns) {
    const match = content.match(pattern)
    if (match) {
      try {
        const parsed = JSON.parse(match[1])
        if (parsed.action && typeof parsed.action === 'string') {
          return {
            action: parsed.action,
            reason: parsed.reason || '',
            questions: parsed.questions || [],
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
          }
        }
      } catch {
        // JSON parse failed — continue to next pattern
      }
    }
  }
  return null
}

// ─── Tests ──────────────────────────────────────────────────────

describe('parseAgentDecision', () => {
  it('should parse decision block with all fields', () => {
    const content = `Some analysis text here.

\`\`\`decision
{"action": "approve", "reason": "Code looks good", "confidence": 0.95, "questions": []}
\`\`\`

More text after.`

    const result = parseAgentDecision(content)
    expect(result).not.toBeNull()
    expect(result!.action).toBe('approve')
    expect(result!.reason).toBe('Code looks good')
    expect(result!.confidence).toBe(0.95)
    expect(result!.questions).toEqual([])
  })

  it('should parse decision from json block', () => {
    const content = `My review:

\`\`\`json
{"action": "request_changes", "reason": "Missing tests", "confidence": 0.8}
\`\`\``

    const result = parseAgentDecision(content)
    expect(result).not.toBeNull()
    expect(result!.action).toBe('request_changes')
    expect(result!.reason).toBe('Missing tests')
  })

  it('should handle needs-clarification with questions', () => {
    const content = `I need more info.

\`\`\`decision
{"action": "needs-clarification", "reason": "Unclear requirements", "questions": ["What is the expected output format?", "Should we support pagination?"]}
\`\`\``

    const result = parseAgentDecision(content)
    expect(result).not.toBeNull()
    expect(result!.action).toBe('needs-clarification')
    expect(result!.questions).toHaveLength(2)
    expect(result!.questions[0]).toBe('What is the expected output format?')
  })

  it('should default confidence to 0.5 when missing', () => {
    const content = `\`\`\`decision
{"action": "implement", "reason": "Ready to go"}
\`\`\``

    const result = parseAgentDecision(content)
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(0.5)
  })

  it('should default questions to empty array when missing', () => {
    const content = `\`\`\`decision
{"action": "approve", "reason": "LGTM", "confidence": 1.0}
\`\`\``

    const result = parseAgentDecision(content)
    expect(result).not.toBeNull()
    expect(result!.questions).toEqual([])
  })

  it('should return null for content without decision block', () => {
    const content = 'Just some regular text without any decision.'
    expect(parseAgentDecision(content)).toBeNull()
  })

  it('should return null for invalid JSON in decision block', () => {
    const content = `\`\`\`decision
{not valid json}
\`\`\``

    expect(parseAgentDecision(content)).toBeNull()
  })

  it('should return null for JSON without action field', () => {
    const content = `\`\`\`decision
{"result": "success", "message": "done"}
\`\`\``

    expect(parseAgentDecision(content)).toBeNull()
  })

  it('should prefer decision block over json block', () => {
    const content = `\`\`\`decision
{"action": "from-decision"}
\`\`\`

\`\`\`json
{"action": "from-json"}
\`\`\``

    const result = parseAgentDecision(content)
    expect(result).not.toBeNull()
    expect(result!.action).toBe('from-decision')
  })

  it('should handle multiline content around the decision block', () => {
    const content = `# Code Review

I reviewed the implementation and found the following:

1. Good: Clean code structure
2. Good: Proper error handling
3. Issue: Missing input validation on line 42

Overall, the code needs minor fixes.

\`\`\`decision
{"action": "request_changes", "reason": "Missing input validation", "confidence": 0.85}
\`\`\`

Thank you for your work!`

    const result = parseAgentDecision(content)
    expect(result).not.toBeNull()
    expect(result!.action).toBe('request_changes')
    expect(result!.confidence).toBe(0.85)
  })
})
