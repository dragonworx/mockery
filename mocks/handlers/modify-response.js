/**
 * Example: Modify existing file response
 * Takes a base JSON file and adds dynamic fields to it
 */

module.exports = async (request, originalResponse) => {
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
    const data = JSON.parse(originalResponse.body);

    // Add dynamic fields based on request
    const url = new URL(request.url);
    const addTimestamps = url.searchParams.get('timestamps') !== 'false';
    const addMetadata = url.searchParams.get('metadata') !== 'false';

    // Modify the data
    let modifiedData = data;

    // If it's an array, add fields to each item
    if (Array.isArray(data)) {
      modifiedData = data.map((item, index) => ({
        ...item,
        ...(addTimestamps && { lastModified: new Date().toISOString() }),
        ...(addMetadata && {
          requestIndex: index,
          processedBy: 'modify-response.js',
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
          processedBy: 'modify-response.js',
          requestMethod: request.method,
          userAgent: request.headers['user-agent']?.substr(0, 50)
        })
      };
    }

    return {
      ...originalResponse,
      headers: {
        ...originalResponse.headers,
        'X-Modified-By': 'modify-response.js',
        'X-Modified-At': new Date().toISOString()
      },
      body: JSON.stringify(modifiedData, null, 2)
    };

  } catch (error) {
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