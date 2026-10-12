import { execSync } from 'child_process';
try {
  execSync('cd artifacts/infra-tracker && pnpm --package=tsx dlx tsx --test src/components/SendReportDialog.test.jsx', { stdio: 'inherit' });
} catch (e) {
  console.log('Error output available');
}
