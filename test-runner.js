import { run } from 'node:test';
import { spec } from 'node:test/reporters';

run({ files: ['artifacts/infra-tracker/src/components/SendReportDialog.test.jsx'] })
  .compose(new spec())
  .pipe(process.stdout);
