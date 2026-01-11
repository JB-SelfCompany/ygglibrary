const fs = require('fs-extra');
const path = require('path');
const yazl = require('yazl');

const showdown = require('showdown');

const platform = process.argv[2];

const distDir = path.resolve(__dirname, '../dist');
const tmpDir = `${distDir}/tmp`;
const publicDir = `${tmpDir}/public`;
const outDir = `${distDir}/${platform}`;

async function build() {
    if (!platform)
        throw new Error(`Please set platform`);

    await fs.emptyDir(outDir);

    //добавляем readme в релиз
    let readme = await fs.readFile(path.resolve(__dirname, '../README.md'), 'utf-8');
    const converter = new showdown.Converter();
    readme = converter.makeHtml(readme);
    await fs.writeFile(`${outDir}/readme.html`, readme);

    // перемещаем public на место
    if (await fs.pathExists(publicDir)) {

        const zipFile = `${tmpDir}/public.zip`;
        const jsonFile = `${distDir}/public.json`;//distDir !!!

        await fs.remove(zipFile);

        // Create zip using yazl (cross-platform)
        await new Promise((resolve, reject) => {
            const zipArchive = new yazl.ZipFile();

            // Recursively add all files from publicDir
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

            addFilesToZip(publicDir).then(() => {
                zipArchive.end();

                const writeStream = fs.createWriteStream(zipFile);
                zipArchive.outputStream.pipe(writeStream);

                writeStream.on('close', () => resolve());
                writeStream.on('error', (err) => reject(err));
            }).catch(reject);
        });

        const data = (await fs.readFile(zipFile)).toString('base64');
        await fs.writeFile(jsonFile, JSON.stringify({data}));
    } else {
        throw new Error(`publicDir: ${publicDir} does not exist`);
    }
}

async function main() {
    try {
        await build();
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}

main();
