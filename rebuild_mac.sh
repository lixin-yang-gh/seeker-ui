rm -rf node_modules
rm -rf dist
rm -rf release
npm install
npm run build
npm run package:mac_dist
