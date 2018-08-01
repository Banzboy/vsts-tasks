/**
 * Run from the root of the vsts-tasks repo.
 * Usage: `node generate-third-party-notice.js <task name>`
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const log = {
    info(message) {
        console.log(`[INFO] ${message}`);
    },
    warning(message) {
        console.log(`[WARNING] ${message}`);
    },
    error(message) {
        console.error(`[ERROR] ${message}`)
    }
};

/** Log `label: ${value}` and pass the value through. */
function trace(label, value) {
    log.info(`${label}: ${value}`);
    return value;
}

/**
 * Read `packagePath`'s package.json and deserialize it.
 * @param packagePath Absolute path to the NPM package
 * @returns Package manifest information parsed from the package's package.json
 */
function readPackageJson(packagePath) {
    log.info(`Reading the package.json for ${packagePath} ...`);
    const contents = fs.readFileSync(path.join(packagePath, 'package.json'), { encoding: 'utf-8' });
    return JSON.parse(contents);
}

/**
 * Get the name of the file containing the license for `packagePath`.
 * @param packagePath Absolute path to the NPM package
 * @returns Absolute path to the license file, or `null` if the license file can't be found
 */
function findLicense(packagePath) {
    log.info(`Finding the license for ${packagePath}`);
    const children = fs.readdirSync(packagePath);
    const licenseNames = [
        'LICENSE',
        'LICENSE.md',
        'LICENSE.txt'
    ].map(x => x.toLowerCase());

    const candidates = children.filter(x => licenseNames.includes(x.toLowerCase()));
    if (candidates.length === 0) {
        log.warning(`Could not find a license for ${packagePath}`);
        return null;
    } else {
        if (candidates.length > 1) {
            log.warning(`Found multiple license files for ${packagePath}: ${candidates.join(', ')}`);
        }
        return trace('Found license', path.join(packagePath, candidates[0]));
    }
}

/**
 * Scan the contents of the 'node_modules' directory for license information.
 * @param modulesRoot NPM package installation directory to scan
 * @returns Iterable of objects: `name` x `url` x `licenseText`
 */
function* collectLicenseInfo(modulesRoot) {
    const packagePaths = fs.readdirSync(modulesRoot).map(x => path.join(modulesRoot, x));
    for (const absolutePath of packagePaths) {
        log.info(`Collecting license information from ${absolutePath} ...`);

        const basename = path.basename(absolutePath);
        if (basename.startsWith('@')) {
            // This is a scoped package: recurse into children
            yield* collectLicenseInfo(absolutePath);
            continue;
        }

        const parentDir = path.basename(path.dirname(absolutePath));
        const isScopedPackage = parentDir.startsWith('@');

        const name = (() => {
            if (isScopedPackage) {
                // "scoped package" -- parent directory is part of name (e.g. @types/node, @sinonjs/formatio)
                return `${parentDir}/${basename}`;
            } else {
                return basename;
            }
        })();

        if (name === '.bin') {
            continue;
        }

        const manifest = readPackageJson(absolutePath);
        const license = findLicense(absolutePath);
        const licenseText = license ? fs.readFileSync(license, { encoding: 'utf-8' }) : 'NO LICENSE FOUND';

        yield {
            name: name,
            url: manifest.repository.url,
            licenseText: licenseText
        };
    }
}

/** Generate the third party notice line-by-line. */
function* thirdPartyNotice(taskName, licenseInfo) {
    // Preamble
    yield '';
    yield 'THIRD-PARTY SOFTWARE NOTICES AND INFORMATION';
    yield 'Do Not Translate or Localize';
    yield '';
    yield `This Visual Studio Team Services extension (${taskName}) is based on or incorporates material from the projects listed below (Third Party IP). The original copyright notice and the license under which Microsoft received such Third Party IP, are set forth below. Such licenses and notices are provided for informational purposes only. Microsoft licenses the Third Party IP to you under the licensing terms for the Visual Studio Team Services extension. Microsoft reserves all other rights not expressly granted under this agreement, whether by implication, estoppel or otherwise.`;
    yield '';

    // Enumerated modules
    let num = 1;
    for (const item of licenseInfo) {
        if (item.url) {
            yield `${num}.\t${item.name} (${item.url})`;
        } else {
            yield `${num}.\t${item.name}`;
        }
        num += 1;
    }

    yield '';
    yield '';

    // Module licenses
    for (const item of licenseInfo) {
        yield `%% ${item.name} NOTICES, INFORMATION, AND LICENSE BEGIN HERE`;
        yield '=========================================';
        yield item.licenseText.trim();
        yield '=========================================';
        yield `END OF ${item.name} NOTICES, INFORMATION, AND LICENSE`;
        yield '';
    }
}

function writeLines(writeStream, lines) {
    const writeLine = (line) => {
        writeStream.write(line);
        writeStream.write(os.EOL);
    };

    for (let line of lines) {
        writeLine(line);
    }
}

/** Join zero or more iterables into a single iterable. */
function* concat(...iterables) {
    for (const it of iterables) {
        yield* it;
    }
}

function main(args) {
    try {
        if (!(args && args.length > 2)) {
            throw new Error(`Usage: node generate-third-party-notice.js <task name>`);
        }

        const taskName = args[2];
        const taskPath = path.join(__dirname, 'Tasks', taskName);
        trace('task path', taskPath);

        const nodeModuleDir = path.join(taskPath, 'node_modules');
        const testsNodeModuleDir = path.join(taskPath, 'Tests', 'node_modules');
        const licenseInfo = concat(collectLicenseInfo(nodeModuleDir), collectLicenseInfo(testsNodeModuleDir));

        function compareStrings(a, b) {
            if (a < b) {
                return -1;
            } else if (a > b) {
                return 1;
            } else {
                return 0;
            }
        }

        const sortedLicenseInfo = Array.from(licenseInfo).sort((x, y) => compareStrings(x.name, y.name));

        const writeStream = fs.createWriteStream(path.join(taskPath, 'ThirdPartyNotice.txt'));
        writeLines(writeStream, thirdPartyNotice(taskName, sortedLicenseInfo));
        writeStream.end();
    } catch (e) {
        log.error(e.message);
    }
}

main(process.argv);
