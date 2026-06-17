import type { HandlerFunction } from '../../server/index.ts';
import { log } from '../../server/index.ts';

/**
 * Example handler demonstrating request forwarding with modification.
 * 
 * This handler:
 * 1. Logs the original request details
 * 2. Adds a custom header
 * 3. Modifies the request body (if JSON)
 * 4. Forwards to the real server
 * 
 * Usage in rules.ts:
 *   {
 *     pattern: "https://api.example.com/endpoint",
 *     method: "POST",
 *     forwardRequest: true,
 *     handler: (await import('./handlers/forward-example.ts')).default
 *   }
 */
const handler: HandlerFunction = async (request, _responseTemplate, requestTemplate) => {
  log.info('Intercepted request:', {
    url: request.url,
    method: request.method,
    hasBody: !!request.body
  });

  // If a request template was provided, log it for comparison
  if (requestTemplate) {
    log.info('Request template loaded:', requestTemplate);
  }

  // Modify the request before forwarding
  let modifiedBody = request.body;
  
  if (request.body) {
    try {
      const parsed = JSON.parse(request.body);
      modifiedBody = JSON.stringify({
        ...parsed,
        _mockeryTimestamp: new Date().toISOString(),
        _mockeryModified: true
      });
      log.info('Modified request body');
    } catch {
      // Not JSON, keep original body
      log.warn('Request body is not JSON, forwarding as-is');
    }
  }

  return {
    request: {
      url: request.url,
      method: request.method,
      headers: {
        ...request.headers,
        'X-Mockery-Forwarded': 'true',
        'X-Mockery-Timestamp': new Date().toISOString()
      },
      body: modifiedBody
    }
    // No response = use real server response
  };
};

export default handler;
