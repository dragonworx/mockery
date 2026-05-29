/**
 * Example: Dynamic response handler
 * Generates completely dynamic responses based on request parameters
 */

const { success, error } = require('./utils/common-responses');

module.exports = async (request, originalResponse) => {
  const url = new URL(request.url);
  const name = url.searchParams.get('name') || 'Anonymous';
  const count = parseInt(url.searchParams.get('count')) || 1;

  // Example: different behavior based on request method
  if (request.method === 'POST') {
    return success({
      message: `Hello ${name}! This is a POST response.`,
      timestamp: new Date().toISOString(),
      requestId: Math.random().toString(36).substr(2, 9),
      userAgent: request.headers['user-agent']
    });
  }

  // GET request with query parameters
  const items = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `${name}_${i + 1}`,
    created: new Date().toISOString()
  }));

  return success({
    message: `Generated ${count} items for ${name}`,
    items,
    metadata: {
      generatedAt: new Date().toISOString(),
      method: request.method,
      queryParams: Object.fromEntries(url.searchParams.entries())
    }
  });
};