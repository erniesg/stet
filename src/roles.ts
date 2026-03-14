import type { RolePreset } from './types.js';

export const JOURNALIST: RolePreset = {
  id: 'journalist',
  name: 'Journalist',
  description: 'Content accuracy and house style — readability checks off by default',
  enabledCategories: ['style', 'numbers', 'terminology', 'dictionary', 'currency', 'punctuation', 'contraction', 'capitalization', 'spelling'],
  disabledCategories: ['readability', 'objectivity'],
};

export const SUB_EDITOR: RolePreset = {
  id: 'subeditor',
  name: 'Sub-editor',
  description: 'Everything — readability, grammar, formatting, style',
  enabledCategories: [
    'style', 'numbers', 'terminology', 'dictionary', 'currency',
    'punctuation', 'readability', 'objectivity', 'contraction', 'wire',
    'capitalization', 'spelling',
  ],
  disabledCategories: [],
};

export const EDITOR: RolePreset = {
  id: 'editor',
  name: 'Editor',
  description: 'Focus on readability and content quality',
  enabledCategories: [
    'readability', 'objectivity', 'style', 'terminology', 'numbers',
  ],
  disabledCategories: ['dictionary', 'punctuation', 'wire', 'contraction'],
};

export const ONLINE: RolePreset = {
  id: 'online',
  name: 'Online',
  description: 'Quick checks for digital publishing',
  enabledCategories: ['style', 'terminology', 'dictionary', 'numbers'],
  disabledCategories: ['readability', 'objectivity', 'punctuation', 'contraction', 'wire'],
};

export const builtInRoles: RolePreset[] = [JOURNALIST, SUB_EDITOR, EDITOR, ONLINE];
