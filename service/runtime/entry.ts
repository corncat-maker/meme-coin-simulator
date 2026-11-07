import * as controller from '../app/controller/service';

import * as std from 'std';

type RuntimeMessage = Record<string, unknown>;

function writeMessage(message: RuntimeMessage) {
  std.out.puts(JSON.stringify(message) + '\n');
  std.out.flush();
}

function readMessage(): RuntimeMessage {
  const line = std.in.getline();
  if (line === null) {
    throw new Error('stdin closed while waiting for message');
  }
  return JSON.parse(line);
}

function installHostCall() {
  (globalThis as typeof globalThis & { __quickjsHostCall?: (method: string, params?: unknown) => unknown }).__quickjsHostCall = (
    method: string,
    params?: unknown,
  ) => {
    const callId = `host-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    writeMessage({
      type: 'host_call',
      id: callId,
      method,
      params: params ?? {},
    });
    const response = readMessage();
    if (response.type !== 'host_result') {
      throw new Error(`unexpected host response type: ${String(response.type)}`);
    }
    if (response.id !== callId) {
      throw new Error(`unexpected host response id: ${String(response.id)}`);
    }
    if (!response.ok) {
      throw new Error(String(response.error ?? 'host call failed'));
    }
    return response.result;
  };
}

function resolveHandler(action: string) {
  const handler = (controller as Record<string, unknown>)[action];
  if (typeof handler !== 'function') {
    throw new Error(`unsupported action: ${action}`);
  }
  return handler as (input: unknown) => unknown;
}

async function main() {
  installHostCall();
  writeMessage({ type: 'ready', protocol: 'stdin_stdout_ndjson' });

  try {
    const message = readMessage();
    if (message.type !== 'run') {
      throw new Error(`unsupported message type: ${String(message.type)}`);
    }

    const action = (typeof message.action === 'string' && message.action) || (typeof message.operationId === 'string' && message.operationId) || '';
    if (!action) {
      throw new Error('missing action');
    }

    const handler = resolveHandler(action);
    const result = await handler(message.input ?? {});
    writeMessage({
      type: 'run_result',
      ok: true,
      id: message.id ?? null,
      result,
    });
  } catch (error) {
    writeMessage({
      type: 'run_result',
      ok: false,
      error: String(error),
    });
    std.exit(1);
  }
}

void main();
