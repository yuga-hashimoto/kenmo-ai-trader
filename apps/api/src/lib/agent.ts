import { createHermesAgentClient, type HermesAgentClient } from '@kenmo/hermes';

let cached: HermesAgentClient | null = null;

/** Singleton HermesAgent client chosen from env (defaults to the deterministic mock). */
export function getAgent(): HermesAgentClient {
  if (!cached) cached = createHermesAgentClient(process.env);
  return cached;
}
