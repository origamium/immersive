import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, readdirSync, existsSync, writeFileSync, readFileSync, chmodSync, statSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
const copy = (source, destination) => {
  if (existsSync(destination)) chmodSync(destination, statSync(destination).mode | 0o200);
  copyFileSync(source, destination);
  chmodSync(destination, statSync(destination).mode | 0o200);
};
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' });
const root = resolve(import.meta.dirname, '..');
process.chdir(root);
execFileSync('swift', ['build', '--package-path', 'native', '-c', 'release'], { stdio: 'inherit' });
const bundle = resolve('native/build/Acoustic Lab.app');
const executable = join(bundle, 'Contents/MacOS/acoustic-lab');
for (const folder of ['MacOS', 'Frameworks', 'Resources/DenonControl', 'Resources/Licenses']) mkdirSync(join(bundle, 'Contents', folder), { recursive: true });
copy('native/.build/release/acoustic-lab', executable);
copy('native/Info-macOS.plist', join(bundle, 'Contents/Info.plist'));
copy('native/Sources/DenonControl/Resources/catalog.json', join(bundle, 'Contents/Resources/DenonControl/catalog.json'));
const libs = run('otool', ['-L', executable]).split('\n').slice(1).map(line => line.trim().split(' (')[0]).filter(path => path.startsWith('/opt/homebrew/') || path.startsWith('/usr/local/'));
let minimum = '14.0';
const versionNumber = value => value.split('.').reduce((sum, part, i) => sum + Number(part) * 100 ** (2-i), 0);
for (const library of libs) {
  const name = basename(library), destination = join(bundle, 'Contents/Frameworks', name);
  if (existsSync(destination)) chmodSync(destination, 0o755);
  copy(library, destination);
  chmodSync(destination, 0o755);
  const min = run('vtool', ['-show-build', destination]).match(/\bminos\s+([\d.]+)/)?.[1];
  if (min && versionNumber(min) > versionNumber(minimum)) minimum = min;
  const nested = run('otool', ['-L', destination]).split('\n').slice(2).map(line => line.trim().split(' (')[0]).filter(path => path.startsWith('/opt/homebrew/') || path.startsWith('/usr/local/'));
  if (nested.length) throw new Error(`Unpackaged dependency in ${name}`);
  run('install_name_tool', ['-id', `@rpath/${name}`, destination]);
  run('install_name_tool', ['-change', library, `@executable_path/../Frameworks/${name}`, executable]);
  run('codesign', ['--force', '--sign', '-', destination]);
}
run('/usr/libexec/PlistBuddy', ['-c', `Set :LSMinimumSystemVersion ${minimum}`, join(bundle, 'Contents/Info.plist')]);
const dependencies = ['native/Vendor/HAP', ...readdirSync('native/.build/checkouts').map(name => `native/.build/checkouts/${name}`)];
for (const directory of dependencies) for (const file of readdirSync(directory).filter(name => /^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(name))) {
  copy(join(directory, file), join(bundle, 'Contents/Resources/Licenses', `${basename(directory)}-${file}`));
}
const sodiumLicense = '/opt/homebrew/opt/libsodium/LICENSE';
if (existsSync(sodiumLicense)) copy(sodiumLicense, join(bundle, 'Contents/Resources/Licenses/libsodium-LICENSE'));
writeFileSync(join(bundle, 'Contents/Resources/build-info.json'), JSON.stringify({ minimumMacOS: minimum, nativeDependencies: libs.map(lib => basename(lib)), packageResolution: JSON.parse(readFileSync('native/Package.resolved', 'utf8')) }, null, 2));
run('codesign', ['--force', '--sign', '-', bundle]);
run('codesign', ['--verify', '--deep', '--strict', bundle]);
console.log(`Built ${bundle}; this dependency build requires macOS ${minimum} or later (local ad-hoc signature).`);
