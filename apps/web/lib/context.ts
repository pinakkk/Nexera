export interface ChatHistoryMessage {
  role: string;
  content: string;
}

export function buildRecentChatHistory(
  messages: ChatHistoryMessage[],
  maxTurns: number = 6,
): ChatHistoryMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-maxTurns)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 2000),
    }));
}
