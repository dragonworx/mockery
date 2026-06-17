import type { HandlerFunction } from '../../server/index.ts';
import { log } from '../../server/index.ts';

/**
 * Example handler demonstrating request template usage.
 * 
 * This handler:
 * 1. Compares the actual request to the expected template
 * 2. Logs any differences found
 * 3. Returns a mock response based on template matching
 * 
 * Usage in rules.ts:
 *   {
 *     pattern: "https://api.example.com/validate",
 *     method: "POST",
 *     requestFile: "requests/expected-payload.json",
 *     file: "responses/validation-success.json",
 *     handler: (await import('./handlers/validate-request.ts')).default
 *   }
 */
const handler: HandlerFunction = async (request, responseTemplate, requestTemplate) => {
  if (!requestTemplate) {
    log.warn('No request template provided for validation');
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing request template' })
    };
  }

  log.info('Validating request against template...');
  
  let actualBody: unknown;
  try {
    actualBody = request.body ? JSON.parse(request.body) : null;
  } catch {
    log.error('Failed to parse request body as JSON');
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON in request body' })
    };
  }

  // Simple field comparison
  const differences: string[] = [];
  const expected = requestTemplate as Record<string, unknown>;
  const actual = actualBody as Record<string, unknown>;
  
  if (actual) {
    for (const key of Object.keys(expected)) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
        differences.push(`Field '${key}' differs: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
      }
    }
  } else {
    differences.push('Request body is empty');
  }

  if (differences.length > 0) {
    log.warn('Request validation found differences:');
    for (const diff of differences) {
      log.warn(`  • ${diff}`);
    }
    
    return {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Request validation failed',
        differences
      })
    };
  }

  log.info('✓ Request matches template');
  
  // Return the response template if validation passes
  if (responseTemplate) {
    return responseTemplate;
  }
  
  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, message: 'Request validated' })
  };
};

export default handler;
