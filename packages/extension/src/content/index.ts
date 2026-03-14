/**
 * Public stet extension entry point.
 * Registers the common pack and starts the checker.
 */

import { commonPack } from 'stet';
import { loadCommonDictionary } from 'stet';
import { initChecker } from './checker.js';
import { initVersionHistory } from './version-history-manager.js';

// Register common pack
void commonPack;

// Start
initChecker(loadCommonDictionary);
initVersionHistory();
