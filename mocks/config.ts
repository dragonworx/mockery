// Mockery Configuration
// This file defines URL patterns and their corresponding mock responses

import type { MockRule } from '../server/index.ts';

export default [
  {
    pattern: "^https://edge\\.adobedc\\.net/ee/aus3/v1/interact",
    method: "POST",
    isRegex: true,
    handler: async (request) => {
      // Returns a realistic Adobe interact response
      // Modify the handle array payloads as needed for testing
      console.log(`[mock-server] Adobe interact intercepted: ${request.url}`);

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _note: "This response was intercepted and modified by Mockery",
          requestId: "mock-" + Date.now() + "-eb3a650cdadd4c6c",
          handle: [
            {
              payload: [
                {
                  id: "66399669542236699145201687189591800040",
                  namespace: { code: "ECID" }
                }
              ],
              type: "identity:result"
            },
            {
              payload: [],
              type: "personalization:decisions",
              eventIndex: 0
            },
            {
              payload: [
                { scope: "Target", hint: "36", ttlSeconds: 1800 },
                { scope: "AAM", hint: "8", ttlSeconds: 1800 },
                { scope: "EdgeNetwork", hint: "aus3", ttlSeconds: 1800 }
              ],
              type: "locationHint:result"
            },
            {
              payload: [
                {
                  key: "kndctr_FFF9306152D80A5C0A490D45_AdobeOrg_cluster",
                  value: "aus3",
                  maxAge: 1800,
                  attrs: { SameSite: "None" }
                }
              ],
              type: "state:store"
            }
          ]
        })
      };
    },
    comment: "Intercept Adobe interact - placeholder proving interception works"
  },
  {
    pattern: "http://localhost:8080/banking/payments/payment-settings/dhp/retail/netbank/core/banking/payments/payment-settings/address-book.smtnbnxt.json",
    method: "GET",
    file: "aem/test.json",
    isRegex: false,
    enabled: false,
  }
] satisfies MockRule[];
