const fs = require('fs-extra');
const path = require('path');
const yazl = require('yazl');

const platform = process.argv[2];
const version = require('../package.json').version;
const projectName = require('../package.json').name;

const distDir = path.resolve(__dirname, '../dist');
const releaseDir = `${distDir}/release`;
const srcDir = `${distDir}/${platform}`;

async function createArchive() {
    if (!platform) {
        console.error('Platform argument is required');
        process.exit(1);
    }

    if (!await fs.pathExists(srcDir)) {
        console.error(`Directory ${srcDir} does not exist`);
        process.exit(1);
    }

    await fs.ensureDir(releaseDir);

    const archiveName = `${projectName}-${version}-${platform}.zip`;
    const archivePath = `${releaseDir}/${archiveName}`;

    return new Promise((resolve, reject) => {
        const zipArchive = new yazl.ZipFile();

        const addFilesToZip = async (dir, zipPath = '') => {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = zipPath ? `${zipPath}/${entry.name}` : entry.name;

                if (entry.isDirectory()) {
                    await addFilesToZip(fullPath, relativePath);
                } else {
                    zipArchive.addFile(fullPath, relativePath);
                }
            }
        };

        addFilesToZip(srcDir).then(() => {
            zipArchive.end();

            const writeStream = fs.createWriteStream(archivePath);
            zipArchive.outputStream.pipe(writeStream);

            writeStream.on('close', () => {
                const stats = fs.statSync(archivePath);
                const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                console.log(`✓ Created ${archiveName} (${sizeMB} MB)`);
                resolve();
            });
            writeStream.on('error', (err) => {
                console.error(`✗ Failed to create archive: ${err.message}`);
                reject(err);
            });
        }).catch(reject);
    });
}

createArchive().catch(err => {
    console.error(err);
    process.exit(1);
});
