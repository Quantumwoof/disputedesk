// Re-copies the AG Grid Community bundle (MIT) into the dashboard's static folder.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('src/web/public/vendor', { recursive: true });
copyFileSync('node_modules/ag-grid-community/dist/ag-grid-community.min.js', 'src/web/public/vendor/ag-grid-community.min.js');
console.log('vendored ag-grid-community.min.js');
