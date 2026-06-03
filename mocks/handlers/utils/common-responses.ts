/**
 * Common response helpers for Mockery handlers
 */

import type { HandlerResponse } from '../../../server/index.ts';

export const success = (data: unknown, headers: Record<string, string> = {}): HandlerResponse => ({
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    ...headers
  },
  body: JSON.stringify({ success: true, data })
});

export const error = (message: string, status = 400, headers: Record<string, string> = {}): HandlerResponse => ({
  status,
  headers: {
    'Content-Type': 'application/json',
    ...headers
  },
  body: JSON.stringify({ success: false, error: message })
});

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): HandlerResponse => ({
  status,
  headers: {
    'Content-Type': 'application/json',
    ...headers
  },
  body: JSON.stringify(data)
});

export const text = (content: string, status = 200, headers: Record<string, string> = {}): HandlerResponse => ({
  status,
  headers: {
    'Content-Type': 'text/plain',
    ...headers
  },
  body: String(content)
});

export const html = (content: string, status = 200, headers: Record<string, string> = {}): HandlerResponse => ({
  status,
  headers: {
    'Content-Type': 'text/html',
    ...headers
  },
  body: String(content)
});
