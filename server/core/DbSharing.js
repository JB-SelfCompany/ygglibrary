const fs = require('fs-extra');
const path = require('path');
const tar = require('tar');
const crypto = require('crypto');

const utils = require('./utils');
const log = new (require('./AppLogger'))().log;//singleton

/**
 * DbSharing - модуль для создания и раздачи готовой БД клиентам
 * Автоматически работает при allowRemoteLib: true
 */
class DbSharing {
    constructor(config) {
        this.config = config;
        this.masterDbPath = path.join(config.dataDir, 'db_master');
        this.masterDbArchive = path.join(config.dataDir, 'db_master.tar.gz');
        this.dbInfoCache = null;
        this.downloadTokens = new Map(); // token -> timestamp
        this.tokenTTL = 5 * 60 * 1000; // 5 минут
    }

    /**
     * Проверяет, нужно ли создавать master БД
     * @returns {boolean}
     */
    async shouldCreateMasterDb() {
        // Если архив существует, проверяем его актуальность
        if (await fs.pathExists(this.masterDbArchive)) {
            const archiveStat = await fs.stat(this.masterDbArchive);
            const inpxStat = await fs.stat(this.config.inpx);

            // Если INPX новее архива - нужно пересоздать
            if (inpxStat.mtime > archiveStat.mtime) {
                log(LM_INFO, 'INPX file is newer than DB archive, will recreate');
                return true;
            }

            log(LM_INFO, 'DB archive is up to date');
            return false;
        }

        log(LM_INFO, 'DB archive does not exist, will create');
        return true;
    }

    /**
     * Создает master БД (без фильтра) и сжимает в архив
     * @param {Object} db - экземпляр БД
     * @param {Function} callback - коллбэк для прогресса
     */
    async createMasterDb(db, callback) {
        log(LM_INFO, 'Creating master DB for sharing...');

        // Убедимся что директория существует
        await fs.ensureDir(this.masterDbPath);

        // Создаем БД без фильтра - используем временный конфиг
        const DbCreator = require('./DbCreator');
        const masterConfig = {
            ...this.config,
            inpxFilterFile: '', // Отключаем фильтр
            dataDir: this.masterDbPath,
        };

        const dbCreator = new DbCreator(masterConfig);

        // Создаем master БД
        const { JembaDb } = require('jembadb');
        const masterDb = new JembaDb();
        await masterDb.lock({
            dbPath: this.masterDbPath,
        });

        await dbCreator.run(masterDb, callback);

        // Закрываем БД
        await masterDb.unlock();

        log(LM_INFO, 'Master DB created, compressing...');

        // Сжимаем БД в tar.gz
        await this.compressDb();

        // Сбрасываем кеш инфо
        this.dbInfoCache = null;

        log(LM_INFO, 'Master DB compressed and ready for sharing');
    }

    /**
     * Сжимает БД в tar.gz архив
     */
    async compressDb() {
        // Удаляем старый архив если существует
        if (await fs.pathExists(this.masterDbArchive)) {
            await fs.remove(this.masterDbArchive);
        }

        // Создаем tar.gz архив
        await tar.create(
            {
                gzip: true,
                file: this.masterDbArchive,
                cwd: this.masterDbPath,
            },
            ['.']
        );

        const stats = await fs.stat(this.masterDbArchive);
        log(LM_INFO, `DB compressed: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }

    /**
     * Загружает конфиг БД из db_config.json
     */
    async loadDbConfig() {
        const configPath = path.join(this.masterDbPath, 'db_config.json');
        if (await fs.pathExists(configPath)) {
            return await fs.readJson(configPath);
        }
        return {};
    }

    /**
     * Возвращает информацию о master БД
     * @returns {Object}
     */
    async getDbInfo() {
        // Используем кеш если доступен
        if (this.dbInfoCache) {
            return this.dbInfoCache;
        }

        if (!await fs.pathExists(this.masterDbArchive)) {
            throw new Error('Master DB archive does not exist');
        }

        const stats = await fs.stat(this.masterDbArchive);
        const dbConfig = await this.loadDbConfig();

        // Вычисляем hash файла
        const hash = await this.calculateFileHash(this.masterDbArchive);

        this.dbInfoCache = {
            hash,
            size: stats.size,
            version: dbConfig.dbVersion || this.config.dbVersion,
            bookCount: dbConfig.bookCount || 0,
            compressed: true,
            mtime: stats.mtime.getTime(),
        };

        return this.dbInfoCache;
    }

    /**
     * Вычисляет SHA256 hash файла
     */
    async calculateFileHash(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);

            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }

    /**
     * Генерирует одноразовый токен для скачивания БД
     * @returns {string}
     */
    generateDownloadToken() {
        const token = crypto.randomBytes(32).toString('hex');
        this.downloadTokens.set(token, Date.now());

        // Очищаем старые токены
        this.cleanupExpiredTokens();

        return token;
    }

    /**
     * Проверяет и удаляет токен (одноразовый)
     * @param {string} token
     * @returns {boolean}
     */
    verifyAndConsumeToken(token) {
        if (!this.downloadTokens.has(token)) {
            return false;
        }

        const timestamp = this.downloadTokens.get(token);
        const now = Date.now();

        // Проверяем что токен не истек
        if (now - timestamp > this.tokenTTL) {
            this.downloadTokens.delete(token);
            return false;
        }

        // Удаляем токен (одноразовый)
        this.downloadTokens.delete(token);
        return true;
    }

    /**
     * Очищает истекшие токены
     */
    cleanupExpiredTokens() {
        const now = Date.now();
        for (const [token, timestamp] of this.downloadTokens.entries()) {
            if (now - timestamp > this.tokenTTL) {
                this.downloadTokens.delete(token);
            }
        }
    }

    /**
     * Возвращает путь к архиву БД
     */
    getArchivePath() {
        return this.masterDbArchive;
    }
}

module.exports = DbSharing;
