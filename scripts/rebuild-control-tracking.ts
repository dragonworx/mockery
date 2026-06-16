#!/usr/bin/env bun
/**
 * Rebuilds `tracking.controlTracking.controls` for every AEM mock file based
 * on the canonical control-id config (see address-book analytics constants).
 *
 * Source of truth: this script. Existing definitions are wiped and replaced
 * with a minimal scaffold per control id:
 *   { controlId, trigger, xdm: {}, webChat: {...}, linkName: {...} }
 *
 * Trigger inference: if a controlId contains "--" it is treated as a click
 * interaction, otherwise it is treated as a blade "load".
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCKS_DIR = join(__dirname, '..', 'mocks', 'aem');

const LANDING_CONTROL_IDS = [
  // Filter chips
  'address-book--filter-all',
  'address-book--filter-bsb',
  'address-book--filter-payid',
  'address-book--filter-bpay',
  'address-book--filter-international',
  // Recipient actions
  'address-book--add',
  'address-book--edit',
  'address-book--delete',
  // Toolbar actions
  'address-book--export',
  'address-book--import',
  // Success banners
  'add-recipient-success',
  'edit-recipient-success',
  'delete-recipient-success',
  'import-success',
  'export-success',
  // Delete recipient flow (originates from landing)
  'delete-recipient-confirm',
  'delete-recipient-confirm--delete',
  'delete-recipient-confirm--cancel',
  'delete-recipient-error',
  // Export flow (originates from landing)
  'export-confirm',
  'export-confirm--continue',
  'export-confirm--cancel',
  'export-error',
];

const ADD_RECIPIENT_CONTROL_IDS = [
  // Payee selection
  'add-recipient--select-bsb',
  'add-recipient--select-payid',
  'add-recipient--select-bpay',
  'add-recipient--select-international',
  // Close
  'add-recipient--close',
  // Unsaved changes modal
  'add-recipient-confirm-leave',
  'add-recipient-confirm-leave-unsaved--leave-button',
  'add-recipient-confirm-leave-unsaved--cancel-button',
  // Submit
  'add-recipient--check-recipient-details-button',
  // Add error
  'add-recipient-save-error',
  // Confirmation of Payee (BSB)
  'add-recipient-cop-success',
  'add-recipient-cop-fail',
  'add-recipient-cop--learn-more',
  'add-recipient-cop--continue',
  'add-recipient-cop--edit-recipient-details',
  'add-recipient-cop--close',
  // Alias Validation (PayID)
  'add-recipient-validate-payid',
  'add-recipient-validate-payid--continue',
  'add-recipient-validate-payid--edit-details',
];

const EDIT_RECIPIENT_CONTROL_IDS = [
  // Edit Recipient blade
  'edit-recipient--close',
  'edit-recipient--cancel',
  'edit-recipient--save',
  // Unsaved changes confirmation modal
  'edit-recipient-confirm-leave',
  'edit-recipient-confirm-leave--leave',
  'edit-recipient-confirm-leave--go-back',
  // No-changes warning modal
  'edit-recipient-warn-no-changes',
  'edit-recipient-warn-no-changes--cancel',
  'edit-recipient-warn-no-changes--go-back',
  // Edit error
  'edit-recipient-fail',
  // Confirmation of Payee (Edit BSB)
  'edit-recipient-cop-success',
  'edit-recipient-cop-fail',
  'edit-recipient-cop--learn-more',
  'edit-recipient-cop--continue',
  'edit-recipient-cop--edit-recipient-details',
  'edit-recipient-cop--close',
];

const IMPORT_RECIPIENTS_CONTROL_IDS = [
  'import-file-validation-success',
  'import-file-validation-error',
  'import-max-payee-error',
  'import-error',
];

const ADD_INTERNATIONAL_CONTROL_IDS = [
  'add-recipient-international-before-you-start',
  'add-recipient-international-recipient-details',
  'add-recipient-international-bank-code-selector',
  'add-recipient-international-bank-details',
  'add-recipient-international-recipient-address',
];

const EDIT_INTERNATIONAL_CONTROL_IDS = [
  'edit-recipient-international-recipient-details',
  'edit-recipient-international-bank-code-selector',
  'edit-recipient-international-bank-details',
  'edit-recipient-international-recipient-address',
];

interface FileSpec {
  file: string;
  ids: readonly string[];
  indent: number;
}

const FILES: FileSpec[] = [
  { file: 'landing.json',             ids: LANDING_CONTROL_IDS,             indent: 2 },
  { file: 'add.json',                 ids: ADD_RECIPIENT_CONTROL_IDS,       indent: 2 },
  { file: 'edit.json',                ids: EDIT_RECIPIENT_CONTROL_IDS,      indent: 2 },
  { file: 'import.json',              ids: IMPORT_RECIPIENTS_CONTROL_IDS,   indent: 2 },
  { file: 'add-international.json',   ids: ADD_INTERNATIONAL_CONTROL_IDS,   indent: 2 },
  { file: 'edit-international.json',  ids: EDIT_INTERNATIONAL_CONTROL_IDS,  indent: 4 },
];

function inferTrigger(controlId: string): 'click' | 'load' {
  return controlId.includes('--') ? 'click' : 'load';
}

function buildControl(controlId: string) {
  return {
    controlId,
    trigger: inferTrigger(controlId),
    xdm: {},
    webChat: { enabled: false, value: '', params: '' },
    linkName: { value: '', dynamic: false },
  };
}

/** Strip a `jsonCallback(...);` JSONP wrapper if present. */
function unwrapJsonp(text: string): { body: string; prefix: string; suffix: string } {
  const match = text.match(/^(\s*[A-Za-z_$][\w$]*\s*\()([\s\S]*?)(\)\s*;?\s*)$/);
  if (!match) return { body: text, prefix: '', suffix: '' };
  return { body: match[2], prefix: match[1], suffix: match[3] };
}

for (const { file, ids, indent } of FILES) {
  const path = join(MOCKS_DIR, file);
  const raw = readFileSync(path, 'utf8');
  const { body, prefix, suffix } = unwrapJsonp(raw);

  const data = JSON.parse(body);
  data.tracking ??= {};
  data.tracking.controlTracking = {
    controls: ids.map(buildControl),
  };

  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  const serialized = JSON.stringify(data, null, indent);
  const output = prefix
    ? `${prefix}${serialized}${suffix.replace(/\s+$/, '')}${trailingNewline}`
    : `${serialized}${trailingNewline}`;

  writeFileSync(path, output);
  console.log(`✓ ${file}: wrote ${ids.length} control${ids.length === 1 ? '' : 's'}`);
}
