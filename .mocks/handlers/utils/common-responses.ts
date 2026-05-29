/**
 * Common response helpers for HTTP Request Mocker handlers
 */

interface ResponseObject {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export const success = (data: any, headers: Record<string, string> = {}): ResponseObject => ({
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    ...headers
  },
  body: JSON.stringify({ success: true, data })
});

export const error = (message: string, status: number = 400, headers: Record<string, string> = {}): ResponseObject => ({
  status,
  headers: {
    'Content-Type': 'application/json',
    ...headers
  },
  body: JSON.stringify({ success: false, error: message })
});

export const json = (data: any, status: number = 200, headers: Record<string, string> = {}): ResponseObject => ({
  status,
  headers: {
    'Content-Type': 'application/json',
    ...headers
  },
  body: JSON.stringify(data)
});

export const text = (content: any, status: number = 200, headers: Record<string, string> = {}): ResponseObject => ({
  status,
  headers: {
    'Content-Type': 'text/plain',
    ...headers
  },
  body: String(content)
});

export const html = (content: any, status: number = 200, headers: Record<string, string> = {}): ResponseObject => ({
  status,
  headers: {
    'Content-Type': 'text/html',
    ...headers
  },
  body: String(content)
});