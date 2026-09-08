const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');
const { minify } = require('html-minifier-terser');
const CleanCSS = require('clean-css');

const HTML_FILES = [
  'public/index.html',
  'public/super-admin.html',
  'public/admin.html',
  'public/guest-hub.html'
];

const CSS_FILES = [
  'public/style.css'
];

const JS_FILES = [
  'public/script.js'
];

const MANIFEST_SOURCE = 'manifest.json';
const MANIFEST_TARGET = 'public/manifest.json';

function obfuscateJavaScript(path) {
  if (!fs.existsSync(path)) {
    console.log(`⏭️  Skip (not found): ${path}`);
    return;
  }
  const jsCode = fs.readFileSync(path, 'utf8');
  const obfuscated = JavaScriptObfuscator.obfuscate(jsCode, {
    compact: true,
    controlFlowFlattening: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    identifierNamesGenerator: 'hexadecimal',
    selfDefending: false
  }).getObfuscatedCode();
  fs.writeFileSync(path, obfuscated);
  console.log(`✅ Obfuscated JavaScript: ${path}`);
}

async function obfuscateHtmlFile(path) {
  if (!fs.existsSync(path)) { console.log(`⏭️  Skip (not found): ${path}`); return; }
  let html = fs.readFileSync(path, 'utf8');

  const startTag = '<script>';
  const startIdx = html.indexOf(startTag);
  if (startIdx === -1) { console.log(`⏭️  No bare <script> in: ${path}`); return; }
  const contentStart = startIdx + startTag.length;
  const endIdx = html.indexOf('</script>', contentStart);
  if (endIdx === -1) { console.log(`⏭️  No closing </script> in: ${path}`); return; }

  const jsCode = html.slice(contentStart, endIdx);

  const obfuscated = JavaScriptObfuscator.obfuscate(jsCode, {
    compact: true,
    controlFlowFlattening: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    identifierNamesGenerator: 'hexadecimal',
    selfDefending: false
  }).getObfuscatedCode();

  html = html.slice(0, contentStart) + obfuscated + html.slice(endIdx);

  html = await minify(html, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: false
  });

  fs.writeFileSync(path, html);
  console.log(`✅ Obfuscated + Minified: ${path}`);
}

function minifyCssFile(path) {
  if (!fs.existsSync(path)) { console.log(`⏭️  Skip (not found): ${path}`); return; }
  const css = fs.readFileSync(path, 'utf8');
  const output = new CleanCSS({}).minify(css);
  fs.writeFileSync(path, output.styles);
  console.log(`✅ Minified CSS: ${path}`);
}

async function build() {
  for (const file of HTML_FILES) {
    await obfuscateHtmlFile(file);
  }
  for (const file of JS_FILES) {
    obfuscateJavaScript(file);
  }
  for (const file of CSS_FILES) {
    minifyCssFile(file);
  }
  if (fs.existsSync(MANIFEST_SOURCE)) {
    fs.copyFileSync(MANIFEST_SOURCE, MANIFEST_TARGET);
    console.log(`✅ Copied manifest: ${MANIFEST_TARGET}`);
  }
  console.log('🎉 Build complete');
}

build().catch(err => { console.error('❌ Build failed:', err.message); process.exit(1); });
