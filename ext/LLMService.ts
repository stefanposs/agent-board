import * as vscode from 'vscode'
import type { LLMModelInfo } from './protocol'

// ─── Public types ───────────────────────────────────────────────

export interface LLMRequest {
  model: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  onChunk?: (chunk: string) => void
  token?: vscode.CancellationToken
}

export interface LLMResponse {
  content: string
  tokensUsed: number
  model: string
}

// ─── Service ────────────────────────────────────────────────────

export class LLMService {
  private _cache: vscode.LanguageModelChat[] = []

  /** Refresh available Copilot models and return their metadata. */
  async refreshModels(): Promise<LLMModelInfo[]> {
    try {
      this._cache = await vscode.lm.selectChatModels()
    } catch {
      this._cache = []
    }
    return this._cache.map(toInfo)
  }

  /** Return cached models or refresh if empty. */
  async getModels(): Promise<LLMModelInfo[]> {
    if (this._cache.length === 0) return this.refreshModels()
    return this._cache.map(toInfo)
  }

  /** Send a chat request through Copilot's language model API. */
  async sendRequest(request: LLMRequest): Promise<LLMResponse> {
    // Try exact model id match first
    let models = await vscode.lm.selectChatModels({ id: request.model })

    if (models.length === 0) {
      // Try matching by family (e.g. 'copilot-claude-sonnet-4' → family 'claude-sonnet-4')
      const familyGuess = request.model.replace(/^copilot-/, '')
      models = await vscode.lm.selectChatModels({ family: familyGuess })
    }

    if (models.length === 0) {
      // Fallback: pick first available model
      models = await vscode.lm.selectChatModels()
      if (models.length === 0) {
        throw new Error('No language models available. Is GitHub Copilot active? Make sure Copilot Chat is installed and you are signed in.')
      }
      console.log(`[AgentBoard LLM] Model "${request.model}" not found, falling back to "${models[0].id}" (${models[0].name}). Available models: ${models.map(m => m.id).join(', ')}`)
    }

    console.log(`[AgentBoard LLM] Using model: ${models[0].id} (${models[0].name}), msgs: ${request.messages.length}, vendor: ${models[0].vendor}, family: ${models[0].family}`)
    return this._doRequest(models[0], request)
  }

  // ───────────────────────────────────────────────────────────────

  private async _doRequest(
    model: vscode.LanguageModelChat,
    request: LLMRequest,
  ): Promise<LLMResponse> {
    const messages: vscode.LanguageModelChatMessage[] = request.messages.map((m) => {
      if (m.role === 'assistant') {
        return vscode.LanguageModelChatMessage.Assistant(m.content)
      }
      // system & user both map to User (the LM API doesn't have a system role)
      return vscode.LanguageModelChatMessage.User(m.content)
    })

    // Only create our own token source if the caller didn't provide one
    const ownTokenSource = request.token ? null : new vscode.CancellationTokenSource()
    const token = request.token ?? ownTokenSource!.token

    try {
      const response = await model.sendRequest(messages, {}, token)

      let content = ''
      for await (const chunk of response.text) {
        content += chunk
        request.onChunk?.(chunk)
      }

      // Rough token estimate (the LM API doesn't expose exact counts)
      const tokensUsed = Math.ceil(content.length / 4)

      return { content, tokensUsed, model: model.id }
    } finally {
      ownTokenSource?.dispose()
    }
  }
}

function toInfo(m: vscode.LanguageModelChat): LLMModelInfo {
  return {
    id: m.id,
    name: m.name,
    vendor: m.vendor,
    family: m.family,
    maxInputTokens: m.maxInputTokens,
  }
}
