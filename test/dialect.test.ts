import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatModel,
  deltaFromFrame,
  dialectFor,
  fastModel,
  readCompletion,
  runCompletion,
  streamCompletion,
  toRequest,
  type AiEnv,
  type AiMessage,
  type ToolDefinition,
  type WorkersAi,
} from '../src/lib/ai.ts';

function fakeAi(handler: (model: string, input: Record<string, unknown>) => unknown, vars: Partial<AiEnv> = {}): AiEnv {
  const ai: WorkersAi = { run: async (model, input) => handler(model, input) };
  return { AI: ai, ...vars };
}

const TOOL: ToolDefinition = {
  type: 'function',
  function: { name: 'set_summary', description: 'записва обобщение', parameters: { type: 'object', properties: {} } },
};

// --------------------------------------------------------------- model config
test('models default to Luna and stay overridable by env var', () => {
  assert.equal(chatModel({}), 'openai/gpt-5.6-luna');
  assert.equal(fastModel({}), 'openai/gpt-5.6-luna');
  assert.equal(chatModel({ CVBOT_CHAT_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }), '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
});

test('the API dialect is inferred from the model id', () => {
  assert.equal(dialectFor('openai/gpt-5.6-luna'), 'responses');
  assert.equal(dialectFor('openai/gpt-5.6-sol'), 'responses');
  assert.equal(dialectFor('@cf/openai/gpt-oss-120b'), 'responses');
  assert.equal(dialectFor('@cf/meta/llama-3.3-70b-instruct-fp8-fast'), 'chat');
  assert.equal(dialectFor('@cf/baai/bge-m3'), 'chat');
});

test('CVBOT_MODEL_DIALECT overrides the guess in both directions', () => {
  assert.equal(dialectFor('openai/gpt-5.6-luna', { CVBOT_MODEL_DIALECT: 'chat' }), 'chat');
  assert.equal(dialectFor('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { CVBOT_MODEL_DIALECT: 'responses' }), 'responses');
  assert.equal(dialectFor('openai/gpt-5.6-luna', { CVBOT_MODEL_DIALECT: 'auto' }), 'responses');
  assert.equal(dialectFor('openai/gpt-5.6-luna', { CVBOT_MODEL_DIALECT: 'nonsense' }), 'responses');
});

// ------------------------------------------------------------ request shaping
const CONVERSATION: AiMessage[] = [
  { role: 'system', content: 'Ти си CV Bot.' },
  { role: 'user', content: 'Работих в Ubisoft.' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'call_a', name: 'add_experience', args: { company: 'Ubisoft' } }] },
  { role: 'tool', tool_call_id: 'call_a', name: 'add_experience', content: 'Позицията е записана.' },
];

test('responses requests split system turns into instructions', () => {
  const payload = toRequest('responses', { messages: CONVERSATION, tools: [TOOL], maxTokens: 500 });
  assert.equal(payload.instructions, 'Ти си CV Bot.');
  assert.equal(payload.max_output_tokens, 500);
  assert.equal(payload.max_tokens, undefined);

  const input = payload.input as Record<string, unknown>[];
  assert.deepEqual(input[0], { role: 'user', content: 'Работих в Ubisoft.' });
  assert.deepEqual(input[1], {
    type: 'function_call',
    call_id: 'call_a',
    name: 'add_experience',
    arguments: JSON.stringify({ company: 'Ubisoft' }),
  });
  assert.deepEqual(input[2], { type: 'function_call_output', call_id: 'call_a', output: 'Позицията е записана.' });
  assert.equal(input.length, 3, 'the empty assistant turn is dropped');
});

test('responses tools are flat, not nested under `function`', () => {
  const payload = toRequest('responses', { messages: CONVERSATION, tools: [TOOL], maxTokens: 100 });
  assert.deepEqual(payload.tools, [
    { type: 'function', name: 'set_summary', description: 'записва обобщение', parameters: { type: 'object', properties: {} } },
  ]);
});

test('responses requests omit temperature, which reasoning models reject', () => {
  const payload = toRequest('responses', { messages: CONVERSATION, temperature: 0.7, maxTokens: 100 });
  assert.equal(payload.temperature, undefined);
});

test('chat requests keep messages, temperature and OpenAI-shaped tool calls', () => {
  const payload = toRequest('chat', { messages: CONVERSATION, tools: [TOOL], temperature: 0.3, maxTokens: 400 });
  assert.equal(payload.temperature, 0.3);
  assert.equal(payload.max_tokens, 400);
  assert.equal(payload.instructions, undefined);

  const messages = payload.messages as Record<string, unknown>[];
  assert.equal(messages.length, 4, 'the system turn stays in the message list');
  assert.deepEqual(messages[2]?.tool_calls, [
    { id: 'call_a', type: 'function', function: { name: 'add_experience', arguments: JSON.stringify({ company: 'Ubisoft' }) } },
  ]);
  assert.equal(messages[3]?.tool_call_id, 'call_a');
  assert.deepEqual(payload.tools, [TOOL], 'chat tools stay nested');
});

test('streaming sets the flag on both dialects', () => {
  assert.equal(toRequest('responses', { messages: CONVERSATION, maxTokens: 10 }, true).stream, true);
  assert.equal(toRequest('chat', { messages: CONVERSATION, maxTokens: 10 }, true).stream, true);
});

// --------------------------------------------------------- response unpacking
test('readCompletion unpacks the Responses API output array', () => {
  const result = readCompletion({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Здравей!' }] },
      { type: 'function_call', call_id: 'call_x', name: 'score_cv', arguments: '{}' },
    ],
  });
  assert.equal(result.text, 'Здравей!');
  assert.deepEqual(result.toolCalls, [{ id: 'call_x', name: 'score_cv', args: {} }]);
});

test('readCompletion falls back to output_text and ignores refusals', () => {
  assert.equal(readCompletion({ output_text: 'Готово.', output: [] }).text, 'Готово.');
  const refusal = readCompletion({
    output: [{ type: 'message', content: [{ type: 'refusal', text: 'не мога' }] }],
    output_text: '',
  });
  assert.equal(refusal.text, '');
});

test('readCompletion still handles the chat and OpenAI-compatible shapes', () => {
  assert.equal(readCompletion({ response: 'от llama' }).text, 'от llama');
  assert.deepEqual(readCompletion({ response: '', tool_calls: [{ name: 'score_cv', arguments: {} }] }).toolCalls, [
    { id: 'call_0', name: 'score_cv', args: {} },
  ]);
  assert.equal(readCompletion({ choices: [{ message: { content: 'от openai-compat' } }] }).text, 'от openai-compat');
});

test('an unrecognised response shape yields empty output, never a throw', () => {
  assert.deepEqual(readCompletion({ something: 'else' }), { text: '', toolCalls: [] });
  assert.deepEqual(readCompletion(null), { text: '', toolCalls: [] });
});

// ------------------------------------------------------------------ streaming
test('deltaFromFrame reads all three streaming formats', () => {
  assert.equal(deltaFromFrame({ response: 'а' }), 'а');
  assert.equal(deltaFromFrame({ type: 'response.output_text.delta', delta: 'б' }), 'б');
  assert.equal(deltaFromFrame({ choices: [{ delta: { content: 'в' } }] }), 'в');
});

test('deltaFromFrame ignores non-text events', () => {
  assert.equal(deltaFromFrame({ type: 'response.function_call_arguments.delta', delta: '{"a":' }), '');
  assert.equal(deltaFromFrame({ type: 'response.completed' }), '');
  assert.equal(deltaFromFrame({}), '');
});

test('streamCompletion assembles Responses API deltas', async () => {
  const frames = [
    'data: {"type":"response.created"}\n',
    'data: {"type":"response.output_text.delta","delta":"Здра"}\n',
    'data: {"type":"response.output_text.delta","delta":"вей"}\n',
    'data: {"type":"response.completed"}\n',
    'data: [DONE]\n',
  ];
  const env = fakeAi(() =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
  );

  let text = '';
  for await (const delta of streamCompletion(env, { messages: [{ role: 'user', content: 'x' }] })) text += delta;
  assert.equal(text, 'Здравей');
});

// ------------------------------------------------------------------- end-to-end
test('runCompletion sends the Responses payload for the default model', async () => {
  let seenModel = '';
  let seenInput: Record<string, unknown> = {};
  const env = fakeAi((model, input) => {
    seenModel = model;
    seenInput = input;
    return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'ок' }] }] };
  });

  const result = await runCompletion(env, { messages: [{ role: 'user', content: 'здравей' }], tools: [TOOL] });

  assert.equal(seenModel, 'openai/gpt-5.6-luna');
  assert.ok(Array.isArray(seenInput.input), 'Responses API uses `input`');
  assert.equal(seenInput.messages, undefined);
  assert.equal(result.text, 'ок');
});

test('switching CVBOT_CHAT_MODEL to a @cf model switches the payload back to chat', async () => {
  let seenInput: Record<string, unknown> = {};
  const env = fakeAi(
    (_model, input) => {
      seenInput = input;
      return { response: 'ок' };
    },
    { CVBOT_CHAT_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  );

  const result = await runCompletion(env, { messages: [{ role: 'user', content: 'здравей' }] });
  assert.ok(Array.isArray(seenInput.messages), 'chat completions uses `messages`');
  assert.equal(seenInput.input, undefined);
  assert.equal(result.text, 'ок');
});
