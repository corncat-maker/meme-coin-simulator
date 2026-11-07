# window.lingguang.ai.streamChat

流式 AI Chat API，替代 legacy `window.lingguang.ai.llmStream`。过程态通过 `onEvent` 接收，Promise resolve 最终结果。

```typescript
const result = await window.lingguang.ai.streamChat({
  messages: [
    { role: 'system', content: '你是一个简洁、准确的助手。' },
    { role: 'user', content: '请用三句话介绍量子计算。' },
  ],
  responseFormat: { type: 'text' },
  onEvent: (event) => {
    if (event.type === 'text_delta') {
      setText(event.text);
    }
    if (event.type === 'error') {
      showError(event.message);
    }
  },
});

setText(result.content);
```

`responseFormat.type` 为 `json_object` 或 `json_schema` 时，流式过程展示文本进度，最终结构化数据从 `result.data` 读取。
