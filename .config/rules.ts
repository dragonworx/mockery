// Mockery Configuration
// This file defines URL patterns and their corresponding mock responses

import type { MockRule } from '../server/index.ts';
import { log } from '../server/index.ts';
import logControlIds from '../mocks/handlers/log-control-ids.ts';

export default [
  {
    pattern: "^https://edge\\.adobedc\\.net/ee/aus3/v1/interact",
    method: "POST",
    isRegex: true,
    handler: async (request) => {
      // Extract CONTROL DETAILS from the first event in the interact payload
      try {
        const parsed = request.body ? JSON.parse(request.body) : null;
        const evt = parsed?.events?.[0];
        const xdm = evt?.xdm ?? {};
        const interaction = xdm?.web?.webInteraction ?? {};
        const cba = xdm?._commonwealthbankau ?? {};

        const controlId = interaction.name
          ?? interaction.URL
          ?? evt?.data?.__adobe?.target?.mbox;
        const interactionName = cba?.interaction?.interactionName;
        const controlType = cba?.trackingDetails?.controlType;
        const bladeName = cba?.page?.bladeName;

        if (interactionName || controlType || bladeName) {
          log.info(`"${controlId}"\n`, { interactionName, controlType, blade: bladeName });
        }
      } catch {
        // ignore parse errors
      }

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
    pattern: "/address-book\\.smtnbnxt\\.json($|\\?)",
    method: "GET",
    file: "aem/landing.json",
    isRegex: true,
    enabled: true,
    handler: logControlIds,
  },
  {
    pattern: "/add-recipient\\.smtnbnxt\\.json($|\\?)",
    method: "GET",
    file: "aem/add.json",
    isRegex: true,
    enabled: true,
    handler: logControlIds,
  },
  {
    pattern: "/edit-recipient\\.smtnbnxt\\.json($|\\?)",
    method: "GET",
    file: "aem/edit.json",
    isRegex: true,
    enabled: true,
    handler: logControlIds,
  },
  {
    pattern: "/import-recipients\\.smtnbnxt\\.json($|\\?)",
    method: "GET",
    file: "aem/import.json",
    isRegex: true,
    enabled: true,
    handler: logControlIds,
  }
] satisfies MockRule[];
