/**
 * Chat History Persistence
 *
 * Persists chat history per session (character × mod) to
 * ~/.openroom/sessions/{charId}/{modId}/chat.json via dev-server API.
 */

import type { ChatMessage } from './llmClient';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  imageUrl?: string;
}

export interface ChatHistoryData {
  version: 1;
  savedAt: number;
  messages: DisplayMessage[];
  chatHistory: ChatMessage[];
  suggestedReplies?: string[];
}

/** Build session path segment from character and mod IDs */
export function buildSessionPath(charId: string, modId: string): string {
  return `${charId}/${modId}`;
}

const API_PATH = '/api/session-data';

function apiUrl(sessionPath: string, file: string): string {
  return `${API_PATH}?path=${encodeURIComponent(`${sessionPath}/chat/${file}`)}`;
}

export async function loadChatHistory(sessionPath: string): Promise<ChatHistoryData | null> {
  try {
    const res = await fetch(apiUrl(sessionPath, 'chat.json'));
    if (res.ok) {
      const data: ChatHistoryData = await res.json();
      if (data && data.version === 1) {
        return data;
      }
    }
  } catch {
    // API not available
  }
  return null;
}

/** @deprecated kept for backward compat, always returns null now */
export function loadChatHistorySync(_sessionPath: string): ChatHistoryData | null {
  return null;
}

export async function saveChatHistory(
  sessionPath: string,
  messages: DisplayMessage[],
  chatHistory: ChatMessage[],
  suggestedReplies?: string[],
): Promise<void> {
  const data: ChatHistoryData = {
    version: 1,
    savedAt: Date.now(),
    messages,
    chatHistory,
    suggestedReplies,
  };

  try {
    await fetch(apiUrl(sessionPath, 'chat.json'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    // Silently ignore
  }
}

export async function clearChatHistory(sessionPath: string): Promise<void> {
  try {
    await fetch(apiUrl(sessionPath, 'chat.json'), { method: 'DELETE' });
  } catch {
    // Silently ignore
  }
}
