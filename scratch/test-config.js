import { getOrLoadSettings } from '../dist/config/loaded-settings.js';
import { resolveUserConfigDir } from '../dist/config/paths.js';
import { join } from 'path';

(async () => {
  const settings = await getOrLoadSettings(process.cwd(), process.env);
  const configDir = settings?.projectConfigDir ?? resolveUserConfigDir();
  const logDir = process.env.WASTELAND_LOG_DIR ?? join(configDir, 'logs');
  console.log('configDir:', configDir);
  console.log('logDir:', logDir);
})();
