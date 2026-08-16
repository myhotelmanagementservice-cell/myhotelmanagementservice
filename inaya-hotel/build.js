const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');
const { minify } = require('html-minifier-terser');

async function build() {
  let html = fs.readFileSync('public/index.html', 'utf8');

  const startTag = '<script>';
  const startIdx = html.indexOf(startTag);
  if (startIdx === -1) { console.log('No bare <script> found, skipping'); return; }
  const contentStart = startIdx + startTag.length;
  const endIdx = html.indexOf('</script>', contentStart);
  if (endIdx === -1) { console.log('No closing </script> found, skipping'); return; }

  const jsCode = html.slice(contentStart, endIdx);

  const obfuscated = JavaScriptObfuscator.obfuscate(jsCode, {
    compact: true,
    controlFlowFlattening: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    identifierNamesGenerator: 'hexadecimal',
    selfDefending: false
  }).getObfuscatedCode();

  // Index-based reconstruction — NEVER use .replace() with a huge string here
  html = html.slice(0, contentStart) + obfuscated + html.slice(endIdx);

  html = await minify(html, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: false // JS already obfuscated separately, don't touch again
  });

  fs.writeFileSync('public/index.html', html);
  console.log('✅ Obfuscated + Minified successfully');
}

build().catch(err => { console.error('❌ Build failed:', err.message); process.exit(1); });
