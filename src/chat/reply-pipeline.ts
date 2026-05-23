export type LocalReplyInput = {
  input: string;
  turn: number;
  historyLength: number;
};

export function buildLocalReplyText({ input, turn, historyLength }: LocalReplyInput): string {
  const normalized = input.trim().toLowerCase();

  if (normalized === "你好" || normalized === "hello" || normalized === "hi") {
    return `你好，我已经收到你的输入：${input}`;
  }

  if (historyLength > 0) {
    return `已收到第 ${turn} 轮输入：${input}。当前会话已累计 ${historyLength} 条历史消息。`;
  }

  return `已收到第 ${turn} 轮输入：${input}`;
}

export function splitReplyText(text: string): string[] {
  return Array.from(text);
}
