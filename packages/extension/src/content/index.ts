/**
 * Public stet extension entry point.
 * Registers the common pack and starts the checker.
 */

import { commonPack } from 'stet';
import { initChecker } from './checker.js';

// Register common pack
void commonPack;

// Start
initChecker();
