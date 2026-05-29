/**
 * Example: Search and filter handler
 * Demonstrates filtering responses based on query parameters
 */

import { json, error } from './utils/common-responses.js';

interface RequestObject {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body?: string | null;
  query: URLSearchParams;
  timestamp: string;
}

interface ResponseObject {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface SampleDataItem {
  id: number;
  name: string;
  category: string;
  price: number;
}

const handler = async (request: RequestObject, originalResponse?: ResponseObject | null): Promise<ResponseObject> => {
  const url = new URL(request.url);
  const searchTerm = url.searchParams.get('q');
  const limit = parseInt(url.searchParams.get('limit') || '10') || 10;
  const sortBy = url.searchParams.get('sort') || 'name';
  const order = url.searchParams.get('order') === 'desc' ? -1 : 1;

  // If we have an original response, filter and sort it
  if (originalResponse) {
    try {
      const data = JSON.parse(originalResponse.body);

      let results = Array.isArray(data) ? data : [data];

      // Apply search filter if provided
      if (searchTerm) {
        results = results.filter(item => {
          const searchText = JSON.stringify(item).toLowerCase();
          return searchText.includes(searchTerm.toLowerCase());
        });
      }

      // Apply sorting if the sort field exists
      if (sortBy && results.length > 0 && results[0].hasOwnProperty(sortBy)) {
        results.sort((a: any, b: any) => {
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

    } catch (err) {
      return error('Failed to process original response: ' + (err as Error).message, 500);
    }
  }

  // No original response - return sample data
  const sampleData: SampleDataItem[] = [
    { id: 1, name: 'Apple', category: 'Fruit', price: 1.20 },
    { id: 2, name: 'Banana', category: 'Fruit', price: 0.80 },
    { id: 3, name: 'Carrot', category: 'Vegetable', price: 0.60 },
    { id: 4, name: 'Date', category: 'Fruit', price: 2.50 },
    { id: 5, name: 'Eggplant', category: 'Vegetable', price: 1.80 }
  ];

  let results = sampleData;

  // Apply search filter
  if (searchTerm) {
    results = results.filter(item =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.category.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  // Apply sorting
  if (sortBy && results.length > 0 && results[0].hasOwnProperty(sortBy)) {
    results.sort((a: any, b: any) => {
      const aVal = (a as any)[sortBy];
      const bVal = (b as any)[sortBy];

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