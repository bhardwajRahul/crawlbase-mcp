import { appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Debug configuration
const DEBUG = process.env.DEBUG === 'true';
const DEBUG_FILE = join(__dirname, '..', '..', 'debug.log');
const ERROR_FILE = join(__dirname, '..', '..', 'error.log');

export const debug = (...args) => {
  if (!DEBUG) return;

  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args
    .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
    .join(' ')}\n`;

  try {
    appendFileSync(DEBUG_FILE, message);
  } catch {
    // Fallback to stderr if file write fails
    console.error('[DEBUG]', ...args);
  }
};

export const error = (...args) => {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args
    .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
    .join(' ')}\n`;

  try {
    appendFileSync(ERROR_FILE, message);
  } catch {
    // Fallback to stderr if file write fails
    console.error('[ERROR]', ...args);
  }
};

export const isDebugEnabled = () => DEBUG;
export const getDebugFilePath = () => DEBUG_FILE;
