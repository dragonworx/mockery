/**
 * Example: Modify existing file response
 * Takes a base JSON file and adds dynamic fields to it
 */

import type { HandlerFunction } from '../../server/index.ts';

const handler: HandlerFunction = async (request, originalResponse) => {
  // If we don't have an original response, return an error
  if (!originalResponse) {
    return {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No base response found' })
    };
  }

  try {
    // Parse the original JSON response
    const data = JSON.parse(originalResponse.body as string);

    // Add dynamic fields based on request
    const url = new URL(request.url);
    const addTimestamps = url.searchParams.get('timestamps') !== 'false';
    const addMetadata = url.searchParams.get('metadata') !== 'false';

    // Modify the data
    let modifiedData = data;

    // If it's an array, add fields to each item
    if (Array.isArray(data)) {
      modifiedData = data.map((item: any, index: number) => ({
        ...item,
        ...(addTimestamps && { lastModified: new Date().toISOString() }),
        ...(addMetadata && {
          requestIndex: index,
          processedBy: 'modify-response.ts',
          userAgent: request.headers['user-agent']?.substr(0, 50)
        })
      }));
    }
    // If it's an object, add fields to the root
    else if (typeof data === 'object' && data !== null) {
      modifiedData = {
        ...data,
        ...(addTimestamps && { lastModified: new Date().toISOString() }),
        ...(addMetadata && {
          processedBy: 'modify-response.ts',
          requestMethod: request.method,
          userAgent: request.headers['user-agent']?.substr(0, 50)
        })
      };
    }

    return {
      ...originalResponse,
      headers: {
        ...originalResponse.headers,
        'X-Modified-By': 'modify-response.ts',
        'X-Modified-At': new Date().toISOString()
      },
      body: JSON.stringify(modifiedData, null, 2)
    };

  } catch (error: any) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to modify response',
        detail: error.message,
        originalContentType: originalResponse.headers['Content-Type']
      })
    };
  }
};

export default handler;
