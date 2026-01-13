const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');

const FileDownloader = require('./FileDownloader');
const WebSocketConnection = require('./WebSocketConnection');
const InpxHashCreator = require('./InpxHashCreator');
const log = new (require('./AppLogger'))().log;//singleton

//singleton
let instance = null;

class RemoteLib {
    constructor(config) {
        if (!instance) {
            this.config = config;

            // Используем режим Yggdrasil для увеличенных таймаутов
            this.wsc = new WebSocketConnection(
                config.remoteLib.url,
                10,
                30,
                {rejectUnauthorized: false},
                config.yggdrasil
            );

            this.remoteHost = config.remoteLib.url.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');

            this.down = new FileDownloader(config.maxPayloadSize*1024*1024);
            this.inpxHashCreator = new InpxHashCreator(config);
            this.inpxFileHash = '';

            instance = this;
        }

        return instance;
    }

    async wsRequest(query, recurse = false, timeout = null) {
        if (this.accessToken)
            query.accessToken = this.accessToken;

        // Увеличенный таймаут для Yggdrasil (60 сек вместо 30)
        const actualTimeout = timeout || (this.config.yggdrasil ? 60 : 30);

        const response = await this.wsc.message(
            await this.wsc.send(query),
            actualTimeout
        );

        if (!recurse && response && response.error == 'need_access_token' && this.config.remoteLib.accessPassword) {
            this.accessToken = utils.getBufHash(this.config.remoteLib.accessPassword + response.salt, 'sha256', 'hex');
            return await this.wsRequest(query, true, timeout);
        }

        if (response.error)
            throw new Error(response.error);

        return response;
    }

    async downloadInpxFile() {
        if (!this.inpxFileHash)
            this.inpxFileHash = await this.inpxHashCreator.getInpxFileHash();

        const response = await this.wsRequest({action: 'get-inpx-file', inpxFileHash: this.inpxFileHash});

        if (response.data) {
            await fs.writeFile(this.config.inpxFile, response.data, 'base64');
            this.inpxFileHash = '';
        }
    }

    async downloadBook(bookUid) {
        try {
            const response = await await this.wsRequest({action: 'get-book-link', bookUid});
            const link = response.link;

            const buf = await this.down.load(`${this.remoteHost}${link}`, {decompress: false});

            const hash = path.basename(link);
            const publicPath = `${this.config.bookDir}/${hash}`;

            await fs.writeFile(publicPath, buf);

            return path.basename(link);
        } catch (e) {
            log(LM_ERR, `RemoteLib.downloadBook: ${e.message}`);
            throw new Error('502 Bad Gateway');
        }
    }

    /**
     * Проверяет состояние сервера
     */
    async getServerState() {
        try {
            const response = await this.wsRequest({action: 'get-worker-state', workerId: 'server_state'}, false, 10);
            return response;
        } catch (e) {
            log(LM_WARN, `Failed to get server state: ${e.message}`);
            return null;
        }
    }

    /**
     * Проверяет готов ли сервер (не создает ли БД в данный момент)
     */
    async isServerReady() {
        const state = await this.getServerState();
        if (!state) return false;

        // Сервер готов если он в состоянии 'normal' или если состояние не указано
        return !state.state || state.state === 'normal';
    }

    /**
     * Проверяет, поддерживает ли сервер DB sharing
     */
    async supportsDbSharing() {
        try {
            const response = await this.wsRequest({action: 'get-config'}, false, 10);
            // Проверяем что сервер отвечает и allowRemoteLib включен
            return !!response;
        } catch (e) {
            return false;
        }
    }

    /**
     * Получает информацию о БД на сервере
     */
    async getDbInfo() {
        const response = await this.wsRequest({action: 'get-db-info'});
        return response;
    }

    /**
     * Получает hash локальной БД
     */
    async getLocalDbHash() {
        const dbHashFile = path.join(this.config.dataDir, 'db', 'db_hash.txt');
        if (await fs.pathExists(dbHashFile)) {
            return await fs.readFile(dbHashFile, 'utf8');
        }
        return null;
    }

    /**
     * Сохраняет hash БД локально
     */
    async saveLocalDbHash(hash) {
        const dbHashFile = path.join(this.config.dataDir, 'db', 'db_hash.txt');
        await fs.writeFile(dbHashFile, hash, 'utf8');
    }

    /**
     * Скачивает готовую БД с сервера
     */
    async downloadDb() {
        log(LM_INFO, 'Checking for DB updates on server...');

        // 1. Проверяем готов ли сервер
        const serverReady = await this.isServerReady();
        if (!serverReady) {
            log(LM_INFO, 'Server is not ready (creating DB), skipping update');
            return false;
        }

        // 2. Получаем информацию о БД на сервере
        let dbInfo;
        try {
            dbInfo = await this.getDbInfo();
        } catch (e) {
            log(LM_WARN, `Failed to get DB info: ${e.message}`);
            return false;
        }

        // 3. Сравниваем hash с локальной БД
        const localHash = await this.getLocalDbHash();
        if (localHash === dbInfo.hash) {
            log(LM_INFO, 'Local DB is up to date');
            return false; // Не нужно скачивать
        }

        log(LM_INFO, `DB hash changed, downloading... (${(dbInfo.size / 1024 / 1024).toFixed(2)} MB)`);

        // 4. Запрашиваем ссылку для скачивания
        const response = await this.wsRequest({action: 'get-db-archive'});
        const downloadUrl = `${this.remoteHost}${response.link}`;

        // 5. Скачиваем архив БД
        const archivePath = path.join(this.config.dataDir, 'db_temp.tar.gz');
        await fs.ensureDir(path.dirname(archivePath));

        log(LM_INFO, 'Downloading DB archive...');

        // Скачиваем с прогрессом
        await this.downloadFile(downloadUrl, archivePath, dbInfo.size);

        // 6. Распаковываем
        log(LM_INFO, 'Extracting DB...');
        await this.extractDb(archivePath);

        // 7. Сохраняем hash
        await this.saveLocalDbHash(dbInfo.hash);

        // 8. Применяем фильтр если есть
        if (await fs.pathExists(this.config.inpxFilterFile)) {
            log(LM_INFO, 'Applying local filter...');
            await this.applyFilter();
        }

        log(LM_INFO, 'DB download and setup complete!');
        return true;
    }

    /**
     * Скачивает файл с сервера с отображением прогресса
     */
    async downloadFile(url, outputPath, totalSize) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? require('https') : require('http');

            client.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                const fileStream = fs.createWriteStream(outputPath);
                let downloadedSize = 0;
                let lastLogTime = Date.now();

                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;

                    // Логируем прогресс каждую секунду
                    const now = Date.now();
                    if (now - lastLogTime > 1000) {
                        const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
                        log(LM_INFO, `Download progress: ${percent}%`);
                        lastLogTime = now;
                    }
                });

                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    log(LM_INFO, 'Download complete: 100%');
                    resolve();
                });

                fileStream.on('error', (err) => {
                    fs.unlink(outputPath, () => {});
                    reject(err);
                });
            }).on('error', reject);
        });
    }

    /**
     * Распаковывает БД из tar.gz архива
     */
    async extractDb(archivePath) {
        const tar = require('tar');
        const dbDir = path.join(this.config.dataDir, 'db');

        // Удаляем старую БД если существует
        if (await fs.pathExists(dbDir)) {
            await fs.remove(dbDir);
        }

        await fs.ensureDir(dbDir);

        // Распаковываем
        await tar.extract({
            file: archivePath,
            cwd: dbDir,
        });

        // Удаляем архив
        await fs.remove(archivePath);
    }

    /**
     * Применяет filter.json к скачанной БД
     */
    async applyFilter() {
        const DbFilter = require('./DbFilter');
        const { JembaDb } = require('jembadb');

        const db = new JembaDb();
        await db.lock({
            dbPath: path.join(this.config.dataDir, 'db'),
        });

        const dbFilter = new DbFilter(this.config, db);
        await dbFilter.filterExistingDb();

        await db.unlock();
    }
}

module.exports = RemoteLib;