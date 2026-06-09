// Mockery Configuration
// This file defines URL patterns and their corresponding mock responses

import type { MockRule } from '../server/index.ts';
import { log } from '../server/index.ts';

export default [
  {
    pattern: "^https://edge\\.adobedc\\.net/ee/aus3/v1/interact",
    method: "POST",
    isRegex: true,
    handler: async (request) => {
      log.info('🎯 ADOBE INTERACT HANDLER FIRED', { method: request.method, url: request.url });
      log.debug('body length:', request.body?.length ?? 0);
      if (!request.body) {
        log.warn('request.body is empty — extension may not be forwarding the body. Reload the extension at chrome://extensions/');
      }

      // ── Log dynamic context from the URL ────────────────────────────────
      const requestId = request.query.get('requestId');
      const configId = request.query.get('configId');
      const silent = request.query.get('silent');
      if (requestId || configId || silent) {
        log.info('url params:', { requestId, configId, silent });
      }

      // ── Parse the JSON body and log key fields ──────────────────────────
      let parsed: any = null;
      try {
        parsed = request.body ? JSON.parse(request.body) : null;
      } catch (err) {
        log.warn('failed to parse interact body:', (err as Error).message);
      }

      if (parsed) {
        // Top-level meta + query info
        const datasetId = parsed?.meta?.konductorConfig?.streaming?.datasetId
          ?? parsed?.meta?.konductorConfig?.datasetId;
        const orgId = parsed?.meta?.state?.domain
          ?? parsed?.meta?.konductorConfig?.imsOrgId;
        const decisionScopes: string[] = parsed?.query?.personalization?.decisionScopes ?? [];
        const surfaces: string[] = parsed?.query?.personalization?.surfaces ?? [];
        const identityMap = parsed?.xdm?.identityMap ?? parsed?.identityMap;
        const ecid = identityMap?.ECID?.[0]?.id;

        log.info('meta:', { datasetId, orgId });
        if (decisionScopes.length) log.info('decisionScopes:', decisionScopes);
        if (surfaces.length) log.info('surfaces:', surfaces);
        if (ecid) log.info('ECID:', ecid);

        // Per-event details
        const events: any[] = Array.isArray(parsed?.events) ? parsed.events : [];
        if (!events.length) log.warn('🎯 CONTROL ID — (no events in payload)');

        events.forEach((evt, i) => {
          const xdm = evt?.xdm ?? {};
          const data = evt?.data ?? {};
          const web = xdm.web ?? {};
          const interaction = web.webInteraction ?? {};
          const page = web.webPageDetails ?? {};
          const decisioning = xdm._experience?.decisioning;

          const controlId = interaction.name
            ?? interaction.URL
            ?? data?.__adobe?.target?.mbox
            ?? decisioning?.propositions?.[0]?.id;

          const cba = xdm._commonwealthbankau ?? {};
          const interactionName = cba?.interaction?.interactionName;
          const controlType = cba?.trackingDetails?.controlType;
          const bladeName = cba?.page?.bladeName;

          log.info(`🎯 CONTROL ID [event ${i}]`, controlId ?? '(none)');
          if (interactionName || controlType || bladeName) {
            log.info('   ↳', { interactionName, controlType, blade: bladeName });
          }

          log.debug(`event[${i}] full:`, {
            eventType: xdm.eventType,
            controlId,
            interactionName,
            interaction: {
              name: interaction.name,
              type: interaction.type,
              linkClicks: interaction.linkClicks?.value,
              URL: interaction.URL,
            },
            page: {
              name: page.name,
              URL: page.URL,
              siteSection: page.siteSection,
              pageViews: page.pageViews?.value,
            },
            timestamp: xdm.timestamp,
            propositions: decisioning?.propositions?.map((p: any) => p.id),
            customDataKeys: Object.keys(data),
          });
        });
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
  },
  {
    pattern: "/add-recipient\\.smtnbnxt\\.json($|\\?)",
    method: "GET",
    file: "aem/add.json",
    isRegex: true,
    enabled: true,
  },
  {
    pattern: "/edit-recipient\\.smtnbnxt\\.json($|\\?)",
    method: "GET",
    file: "aem/edit.json",
    isRegex: true,
    enabled: true,
  },
  {
    pattern: "/import-recipients\\.smtnbnxt\\.json($|\\?)",
    method: "GET",
    file: "aem/import.json",
    isRegex: true,
    enabled: true,
  }
] satisfies MockRule[];
