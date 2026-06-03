/**
 * Example: Search and filter handler
 * Demonstrates filtering responses based on query parameters
 */

import { json, error } from './utils/common-responses.ts';
import type { HandlerFunction } from '../../server/index.ts';

const handler: HandlerFunction = async (request, originalResponse) => {
  const url = new URL(request.url);
  const searchTerm = url.searchParams.get('q');
  const limit = parseInt(url.searchParams.get('limit') || '10') || 10;
  const sortBy = url.searchParams.get('sort') || 'name';
  const order = url.searchParams.get('order') === 'desc' ? -1 : 1;

  // If we have an original response, filter and sort it
  if (originalResponse) {
    try {
      const data = JSON.parse(originalResponse.body as string);

      let results: any[] = Array.isArray(data) ? data : [data];

      // Apply search filter if provided
      if (searchTerm) {
        results = results.filter(item => {
          const searchText = JSON.stringify(item).toLowerCase();
          return searchText.includes(searchTerm.toLowerCase());
        });
      }

      // Apply sorting if the sort field exists
      if (sortBy && results.length > 0 && Object.hasOwn(results[0], sortBy)) {
        results.sort((a, b) => {
          const aVal = a[sortBy];
          const bVal = b[sortBy];

          if (typeof aVal === 'string') {
            return order * aVal.localeCompare(bVal);
          }
          return order * (aVal - bVal);
        });
      }

      // Apply limit
      const paginatedResults = results.slice(0, limit);

      return json({
        results: paginatedResults,
        totalMatches: results.length,
        limit,
        query: {
          search: searchTerm,
          sortBy,
          order: order === 1 ? 'asc' : 'desc'
        },
        processedAt: new Date().toISOString()
      });

    } catch (err: any) {
      return error('Failed to process original response: ' + err.message, 500);
    }
  }

  // No original response - return sample data
  const sampleData = [
    { id: 1, name: 'Apple', category: 'Fruit', price: 1.20 },
    { id: 2, name: 'Banana', category: 'Fruit', price: 0.80 },
    { id: 3, name: 'Carrot', category: 'Vegetable', price: 0.60 },
    { id: 4, name: 'Date', category: 'Fruit', price: 2.50 },
    { id: 5, name: 'Eggplant', category: 'Vegetable', price: 1.80 }
  ];

  let results = sampleData as any[];

  // Apply search filter
  if (searchTerm) {
    results = results.filter(item =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.category.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  // Apply sorting
  if (sortBy && results.length > 0 && Object.hasOwn(results[0], sortBy)) {
    results.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];

      if (typeof aVal === 'string') {
        return order * aVal.localeCompare(bVal);
      }
      return order * (aVal - bVal);
    });
  }

  // Apply limit
  const paginatedResults = results.slice(0, limit);

  return json({
    results: paginatedResults,
    totalMatches: results.length,
    limit,
    query: {
      search: searchTerm,
      sortBy,
      order: order === 1 ? 'asc' : 'desc'
    },
    note: 'This is sample data since no base file was provided',
    processedAt: new Date().toISOString()
  });
};

export default handler;
