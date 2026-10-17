import { Command } from 'commander';
import { installSkill, listInstalledSkills, removeSkill } from '../skills/skill-installer.js';

export function createSkillsCommand(): Command {
  const skillsCmd = new Command('skills').description('Manage external skills');

  skillsCmd
    .command('install <source>')
    .description('Install a skill from local path or git repository')
    .option('-g, --global', 'Install globally to ~/.wasteland/skills')
    .action(async (source: string, options: { global?: boolean }) => {
      try {
        const result = await installSkill({ source, global: options.global });
        console.log(`Successfully installed skill "${result.name}" (${result.format}) at: ${result.targetPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to install skill: ${message}`);
        process.exitCode = 1;
      }
    });

  skillsCmd
    .command('list')
    .description('List installed external skills')
    .action(async () => {
      const list = await listInstalledSkills();
      if (list.length === 0) {
        console.log('No external skills installed.');
        return;
      }
      console.log('Installed external skills:');
      for (const item of list) {
        console.log(`- ${item.name} [${item.scope}] -> ${item.path}`);
      }
    });

  skillsCmd
    .command('remove <name>')
    .description('Remove an installed external skill')
    .option('-g, --global', 'Remove from global ~/.wasteland/skills')
    .action(async (name: string, options: { global?: boolean }) => {
      const removed = await removeSkill(name, { global: options.global });
      if (removed) {
        console.log(`Skill "${name}" removed.`);
      } else {
        console.log(`Skill "${name}" not found.`);
      }
    });

  return skillsCmd;
}
