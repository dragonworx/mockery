// HTTP Request Mocker Configuration
// This file defines URL patterns and their corresponding mock responses

module.exports = [
  {
    pattern: "https://api.example.com/users",
    file: "data/users.json",
    comment: "Static file response"
  },
  {
    pattern: "https://api.example.com/users/enhanced",
    file: "data/users.json",
    // Inline handler function - adds timestamps and metadata to users
    handler: async (request, originalResponse) => {
      if (!originalResponse) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Original file not found' })
        };
      }

      const users = JSON.parse(originalResponse.body);
      const enhanced = {
        ...users,
        metadata: {
          timestamp: new Date().toISOString(),
          requestUrl: request.url,
          method: request.method,
          enhanced: true
        }
      };

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enhanced, null, 2)
      };
    }
  },
  {
    pattern: "https://api.example.com/search",
    file: "data/users.json",
    handler: require('./handlers/search-filter.js'), // Import handler from file
    comment: "File + imported handler: searchable and filterable users (try ?q=john&sort=name&limit=2)"
  },
  {
    pattern: "https://api.example.com/dynamic",
    // Inline handler-only response - no file needed
    handler: async (request) => {
      const url = new URL(request.url);
      const name = url.searchParams.get('name') || 'Anonymous';
      const count = parseInt(url.searchParams.get('count')) || 1;

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Hello ${name}!`,
          count: count,
          timestamp: new Date().toISOString(),
          method: request.method,
          query: Object.fromEntries(url.searchParams),
          generated: true
        }, null, 2)
      };
    },
    comment: "Inline handler-only: completely dynamic response (try ?name=test&count=3)"
  }
];