import { loadSessionEntries } from '../dist/core/logger/file-log-loader.js';
loadSessionEntries({ dir: '.wasteland/logs', sessionId: '2026-09-06_151935_405131' }).then(e => console.log(e.length)).catch(console.error);
