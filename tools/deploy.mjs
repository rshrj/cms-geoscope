// Uploads the built dist/ folder to the linked Vercel project.
//   node tools/deploy.mjs             production
//   node tools/deploy.mjs --preview   preview deployment
// One-time setup: npx vercel login && npx vercel link --project <name>
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

if (!existsSync('dist/index.html')) {
  console.error('dist/ is missing: run `npm run build` first');
  process.exit(1);
}
if (!existsSync('.vercel/project.json')) {
  console.error('No linked project. Run: npx vercel login && npx vercel link --project cms-geoscope');
  process.exit(1);
}
// deploying dist/ on its own would otherwise create a project named "dist"
mkdirSync('dist/.vercel', { recursive: true });
copyFileSync('.vercel/project.json', 'dist/.vercel/project.json');

const args = ['vercel', 'deploy', 'dist', '--yes', ...(process.argv.includes('--preview') ? [] : ['--prod'])];
process.exit(spawnSync('npx', args, { stdio: 'inherit' }).status ?? 1);
