# Handler Functions

This directory contains JavaScript handler functions that can modify or generate mock responses dynamically.

## Handler Function API

Each handler file should export a function that receives two parameters:

```javascript
module.exports = async (request, originalResponse) => {
  // Your logic here
  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello World' })
  };
};
```

### Parameters

- **`request`** - Object containing request details:
  - `url` - Full request URL
  - `method` - HTTP method (GET, POST, etc.)
  - `headers` - Request headers object
  - `body` - Request body (or null)
  - `query` - URLSearchParams object for query parameters
  - `timestamp` - ISO timestamp when request was processed

- **`originalResponse`** - Response from file (if specified), or null:
  - `status` - HTTP status code
  - `headers` - Response headers object
  - `body` - Response body as string

### Return Value

Handler must return an object with:
- `status` - HTTP status code (default: 200)
- `headers` - Response headers object
- `body` - Response body (string, Buffer, or convertible to string)

## Usage Patterns

### 1. Dynamic Response (Handler Only)

```json
{
  "pattern": "https://api.example.com/dynamic",
  "handler": "handlers/dynamic-response.js"
}
```

### 2. Modify Existing File

```json
{
  "pattern": "https://api.example.com/enhanced",
  "file": "data/users.json",
  "handler": "handlers/modify-response.js"
}
```

### 3. Conditional Logic

```javascript
module.exports = async (request, originalResponse) => {
  const url = new URL(request.url);

  if (request.method === 'POST') {
    return { status: 201, headers: {}, body: '{"created": true}' };
  }

  if (url.searchParams.get('error')) {
    return { status: 500, headers: {}, body: '{"error": "Simulated error"}' };
  }

  // Default response
  return originalResponse || { status: 404, headers: {}, body: '{}' };
};
```

## Helper Utilities

Use the utilities in `utils/common-responses.js` for consistent response formatting:

```javascript
const { success, error, json } = require('../utils/common-responses');

module.exports = async (request, originalResponse) => {
  try {
    const data = { message: 'Hello World' };
    return success(data);
  } catch (err) {
    return error(err.message, 500);
  }
};
```

## Hot Reloading

If you have `chokidar` installed (`npm install chokidar`), handlers will automatically reload when you save changes. You'll see this in the server console:

```
[mock-server] Handler changed: _mocks/handlers/dynamic-response.js
[mock-server] Handler reloaded - next request will use updated version
```

## Example Files

- `dynamic-response.js` - Generates completely dynamic responses
- `modify-response.js` - Adds dynamic fields to existing JSON files
- `search-filter.js` - Implements search and filtering on data
- `utils/common-responses.js` - Helper functions for response formatting

## Testing Your Handlers

Start the server and test your endpoints:

```bash
npm start

# Test dynamic endpoint
curl "http://localhost:8756/resolve?url=https://api.example.com/dynamic?name=test&count=3"

# Test search endpoint
curl "http://localhost:8756/resolve?url=https://api.example.com/search?q=john&limit=1"

# Test enhanced users
curl "http://localhost:8756/resolve?url=https://api.example.com/users/enhanced"
```