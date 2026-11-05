/* Optional: `node build.js` bundles everything into dist/index.html, one self-contained file
   (fonts inlined). Used for previews; the real site is deployed as plain static files. */
const fs = require('fs'), path = require('path');
let css = fs.readFileSync('css/styles.css', 'utf8');
css = css.replace(/url\("\.\.\/fonts\/([\w-]+\.woff2)"\)/g, (m, f) => `url("data:font/woff2;base64,${fs.readFileSync(path.join('fonts', f)).toString('base64')}")`);
let html = fs.readFileSync('index.html', 'utf8');
html = html.split('\n').filter((l) => !l.includes('data-standalone-only')).join('\n');
html = html.replace('<link rel="stylesheet" href="css/styles.css">', () => '<style>\n' + css + '\n</style>');
html = html.replace(/<script src="js\/([\w-]+)\.js"><\/script>\n/g, (m, name) => '<script>\n' + fs.readFileSync(path.join('js', name + '.js'), 'utf8') + '\n</script>\n');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('dist/index.html written', (html.length / 1024).toFixed(0) + ' kB');
