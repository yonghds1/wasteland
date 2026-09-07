import { listSessions } from '../dist/core/logger/file-log-loader.js';
listSessions({ dir: '.wasteland/logs' }).then(console.log).catch(console.error);
