import { getOrLoadSettings } from '../dist/config/loaded-settings.js';
(async () => {
  const settings = await getOrLoadSettings(process.cwd(), process.env);
  console.log('projectConfigDir:', settings.projectConfigDir);
})();
