#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const TEST_FILE = path.join(__dirname, '..', 'mocks', 'aem', 'test.json');

function loadData() {
  return JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(TEST_FILE, JSON.stringify(data, null, 2) + '\n');
}

function getControls(data) {
  return data.tracking.controlTracking.controls;
}

function buildControl(controlId, trigger) {
  return {
    controlId,
    trigger,
    xdm: {
      eventType: "web.webinteraction.linkClicks",
      _commonwealthbankau: {
        Identities: { webTrackerID: "{SC_WEBTRACKER_ID}" },
        additionalpageinfo: {
          UAI: "{SC_UAI}",
          globalMaskingFieldCount: "{SC_globalMaskingFieldCount}",
          globalMaskingFieldName: "{SC_globalMaskingFieldName}",
          subSectionDetail: "",
          subSubSectionDetail: ""
        },
        customer: {
          UUIDv4: "{SC_UUIDv4}",
          UUIDv5: "{SC_UUIDv5}",
          authenticationState: "{SC_authstate}",
          customerProfileType: "",
          customerSubType: "",
          customerType: ""
        },
        error: { errorMessage: "", errorType: "" },
        form: {},
        interaction: { interactionName: controlId },
        marketing: {
          countingMethod: "select",
          enableGa4: "false",
          enableFloodLight: "false",
          enableConditionalTagging: "false",
          floodLightConfigID: "select",
          ga4Obj: "{\"send_to\":\"G-57YPC971CC\"}",
          ga4EventName: "page_view",
          flObj: "{\"uVariableMappings\":[{\"tag\":\"\",\"uvar\":\"u4\"},{\"tag\":\"\",\"uvar\":\"u8\"},{\"tag\":\"$location.href.split('?')[0]\",\"uvar\":\"u13\"},{\"tag\":\"\",\"uvar\":\"u14\"},{\"tag\":\"address-book\",\"uvar\":\"u19\"},{\"tag\":\"\",\"uvar\":\"u33\"}]}"
        },
        merchant: {},
        milestone: {},
        onlineApplication: {},
        page: {
          channel: "{SC_channel}",
          page: "address-book",
          pageType: "",
          pageURL: "{SC_pageurl}",
          previousPageName: "{SC_previouspagename}",
          section: "banking",
          site: "nb",
          subSection: "payments",
          subSubSection: "payment-settings",
          subSubSubsection: ""
        },
        personalisation: {},
        product: { featureId: "", productId: [] },
        tools: {},
        trackingDetails: {
          ECID: "{SC_ecid}",
          adobeAnalyticsVersion: "{SC_analyticsversion}",
          hourOfDay: "{SC_hourOfDay}",
          dayOfWeek: "{SC_dayOfWeek}",
          newVSrepeat: "{SC_newVSrepeat}",
          internalVSexternal: "{SC_internalVSexternal}"
        },
        webChat: { webChatEnabled: false }
      },
      commerce: {},
      web: {
        webInteraction: {
          URL: "{SC_interactionURL}",
          name: `nb:banking:payments:payment-settings:address-book:${controlId}`,
          type: "other",
          linkClicks: { value: 1 }
        },
        webPageDetails: { URL: "{SC_pageurl}", name: "nb:banking:address-book" },
        webReferrer: { URL: "{SC_referrerurl}" }
      }
    },
    webChat: { enabled: false, value: "", params: "" },
    linkName: { value: `nb:banking:payments:payment-settings:address-book:${controlId}`, dynamic: false }
  };
}

function listControls(controls) {
  if (controls.length === 0) {
    console.log('No controls found.');
    return;
  }
  console.log(`\n  ID${' '.repeat(43)}Event`);
  console.log(`  ${'-'.repeat(45)} ${'-'.repeat(15)}`);
  for (const c of controls) {
    const id = c.controlId.padEnd(45);
    console.log(`  ${id} ${c.trigger}`);
  }
  console.log(`\n  Total: ${controls.length} control(s)\n`);
}

function parseArgs(argv) {
  const args = { action: null, id: null, event: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '-a': args.action = 'add'; args.id = argv[++i]; break;
      case '-d': args.action = 'delete'; args.id = argv[++i]; break;
      case '-l': args.action = 'list'; break;
      case '-e': args.event = argv[++i]; break;
    }
  }
  return args;
}

function usage() {
  console.log(`
Usage:
  ./scripts/aem.js -a <controlId> -e <eventType>   Add a control
  ./scripts/aem.js -d <controlId>                  Delete a control by ID
  ./scripts/aem.js -l                              List all controls
`);
}

// --- Main ---
const args = parseArgs(process.argv.slice(2));

if (!args.action) {
  usage();
  process.exit(1);
}

const data = loadData();
const controls = getControls(data);

switch (args.action) {
  case 'list':
    listControls(controls);
    break;

  case 'add':
    if (!args.id || !args.event) {
      console.error('Error: -a requires an ID and -e requires an event type.');
      usage();
      process.exit(1);
    }
    if (controls.find(c => c.controlId === args.id)) {
      console.error(`Error: Control "${args.id}" already exists.`);
      process.exit(1);
    }
    controls.push(buildControl(args.id, args.event));
    saveData(data);
    console.log(`Added control "${args.id}" with trigger "${args.event}".`);
    break;

  case 'delete':
    if (!args.id) {
      console.error('Error: -d requires a control ID.');
      usage();
      process.exit(1);
    }
    const idx = controls.findIndex(c => c.controlId === args.id);
    if (idx === -1) {
      console.error(`Error: Control "${args.id}" not found.`);
      process.exit(1);
    }
    controls.splice(idx, 1);
    saveData(data);
    console.log(`Deleted control "${args.id}".`);
    break;
}
