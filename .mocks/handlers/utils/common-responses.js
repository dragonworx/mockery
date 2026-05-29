/**
 * Common response helpers for HTTP Request Mocker handlers
 */

exports.success = (data, headers = {}) => ({
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    ...headers
  },
  body: JSON.stringify({ success: true, data })
});

exports.error = (message, status = 400, headers = {}) => ({
  status,
  headers: {
    'Content-Type': 'application/json',
    ...headers
  },
  body: JSON.stringify({ success: false, error: message })
});

exports.json = (data, status = 200, headers = {}) => ({
  status,
  headers: {
    'Content-Type': 'application/json',
    ...headers
  },
  body: JSON.stringify(data)
});

exports.text = (content, status = 200, headers = {}) => ({
  status,
  headers: {
    'Content-Type': 'text/plain',
    ...headers
  },
  body: String(content)
});

exports.html = (content, status = 200, headers = {}) => ({
  status,
  headers: {
    'Content-Type': 'text/html',
    ...headers
  },
  body: String(content)
});