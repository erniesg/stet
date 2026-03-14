/**
 * Public stet extension entry point.
 * Registers the common pack and starts the shared runtime bootstrap.
 */

import { commonPack, loadCommonDictionary } from 'stet';
import { bootContentRuntime } from './runtime.js';

bootContentRuntime({
  registerPacks: () => {
    void commonPack;
  },
  onDictionaryLoaded: loadCommonDictionary,
});
